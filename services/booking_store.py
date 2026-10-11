"""SQLite persistence for prototype bookings.

Seat inventory is derived from the stored bookings (capacity comes from the catalog),
so every capacity-changing write runs inside a ``BEGIN IMMEDIATE`` transaction to
keep concurrent group bookings from overselling a class.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

ACTIVE_STATUSES = ("CONFIRMED", "PENDING_PAYMENT")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bookings (
    pnr TEXT PRIMARY KEY,
    user_id TEXT,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    option_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    travel_class TEXT NOT NULL,
    status TEXT NOT NULL,
    seat_count INTEGER NOT NULL,
    passengers_json TEXT NOT NULL,
    seats_json TEXT NOT NULL DEFAULT '[]',
    option_json TEXT NOT NULL,
    currency TEXT NOT NULL,
    subtotal TEXT NOT NULL,
    taxes TEXT NOT NULL,
    fee TEXT NOT NULL,
    total TEXT NOT NULL,
    refund_amount TEXT,
    payment_ref TEXT,
    payment_method TEXT,
    payment_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    hold_expires_at TEXT,
    confirmed_at TEXT,
    cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(contact_email);
CREATE INDEX IF NOT EXISTS idx_bookings_option ON bookings(option_id, travel_class);
"""

_JSON_COLUMNS = ("passengers_json", "seats_json", "option_json")


class BookingStore:
    """Thread-safe SQLite-backed booking repository."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._memory_conn: sqlite3.Connection | None = None
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        if self.path == ":memory:":
            if self._memory_conn is None:
                self._memory_conn = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
                self._memory_conn.row_factory = sqlite3.Row
            return self._memory_conn
        conn = sqlite3.connect(self.path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(_SCHEMA)  # runs its own statements, so it stays outside _tx
            finally:
                if self.path != ":memory:":
                    conn.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        """Serialize writers and wrap the block in an immediate transaction."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            finally:
                if self.path != ":memory:":
                    conn.close()

    # ---- helpers ----

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        for col in _JSON_COLUMNS:
            data[col.removesuffix("_json")] = json.loads(data.pop(col))
        return data

    @staticmethod
    def _held(row: sqlite3.Row, now: datetime) -> bool:
        """Is this row currently consuming inventory?"""
        if row["status"] == "CONFIRMED":
            return True
        expires = row["hold_expires_at"]
        return row["status"] == "PENDING_PAYMENT" and bool(expires) and datetime.fromisoformat(expires) > now

    def _taken(self, conn: sqlite3.Connection, option_id: str, travel_class: str, now: datetime,
               exclude_pnr: str | None = None) -> tuple[int, set[str]]:
        rows = conn.execute(
            "SELECT pnr, status, seat_count, seats_json, hold_expires_at FROM bookings "
            "WHERE option_id=? AND travel_class=? AND status IN (?, ?)",
            (option_id, travel_class, *ACTIVE_STATUSES),
        ).fetchall()
        taken, labels = 0, set()
        for row in rows:
            if row["pnr"] == exclude_pnr or not self._held(row, now):
                continue
            taken += row["seat_count"]
            labels.update(s["label"] for s in json.loads(row["seats_json"]) if s.get("label"))
        return taken, labels

    # ---- reads ----

    def seats_taken(self, option_id: str, travel_class: str, now: datetime) -> int:
        with self._tx() as conn:
            return self._taken(conn, option_id, travel_class, now)[0]

    def get(self, pnr: str) -> dict[str, Any] | None:
        with self._tx() as conn:
            return self._row(conn.execute("SELECT * FROM bookings WHERE pnr=?", (pnr,)).fetchone())

    def list_by_email(self, email: str) -> list[dict[str, Any]]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT * FROM bookings WHERE contact_email=? ORDER BY created_at DESC", (email,)
            ).fetchall()
            return [self._row(r) for r in rows]

    # ---- writes ----

    def create_pending(self, record: dict[str, Any], capacity: int, now: datetime) -> bool:
        """Insert a held booking if capacity allows. Returns False when sold out."""
        with self._tx() as conn:
            taken, _ = self._taken(conn, record["option_id"], record["travel_class"], now)
            if taken + record["seat_count"] > capacity:
                return False
            conn.execute(
                "INSERT INTO bookings (pnr, user_id, contact_email, contact_phone, option_id, mode, "
                "travel_class, status, seat_count, passengers_json, option_json, currency, subtotal, "
                "taxes, fee, total, created_at, hold_expires_at) "
                "VALUES (:pnr, :user_id, :contact_email, :contact_phone, :option_id, :mode, "
                ":travel_class, 'PENDING_PAYMENT', :seat_count, :passengers_json, :option_json, "
                ":currency, :subtotal, :taxes, :fee, :total, :created_at, :hold_expires_at)",
                {**record,
                 "passengers_json": json.dumps(record["passengers"]),
                 "option_json": json.dumps(record["option"])},
            )
            return True

    def record_failed_payment(self, pnr: str, method: str, max_attempts: int) -> dict[str, Any]:
        """Count a declined attempt; fail the booking (and free the seats) at the limit."""
        with self._tx() as conn:
            row = conn.execute("SELECT payment_attempts FROM bookings WHERE pnr=?", (pnr,)).fetchone()
            attempts = row["payment_attempts"] + 1
            status = "PAYMENT_FAILED" if attempts >= max_attempts else "PENDING_PAYMENT"
            conn.execute(
                "UPDATE bookings SET payment_attempts=?, payment_method=?, status=? WHERE pnr=?",
                (attempts, method, status, pnr),
            )
            return self._row(conn.execute("SELECT * FROM bookings WHERE pnr=?", (pnr,)).fetchone())

    def expire(self, pnr: str) -> None:
        with self._tx() as conn:
            conn.execute("UPDATE bookings SET status='EXPIRED' WHERE pnr=? AND status='PENDING_PAYMENT'", (pnr,))

    def confirm(self, pnr: str, capacity: int, now: datetime, payment_ref: str, method: str,
                label_for: Any) -> dict[str, Any] | None:
        """Confirm a pending booking and assign seats. Returns None if inventory is gone.

        ``label_for(index)`` yields the seat label for the Nth seat in the class.
        """
        with self._tx() as conn:
            row = conn.execute("SELECT * FROM bookings WHERE pnr=?", (pnr,)).fetchone()
            taken, used = self._taken(conn, row["option_id"], row["travel_class"], now, exclude_pnr=pnr)
            if taken + row["seat_count"] > capacity:
                conn.execute("UPDATE bookings SET status='EXPIRED' WHERE pnr=?", (pnr,))
                return None
            passengers = json.loads(row["passengers_json"])
            seats, cursor = [], 0
            for i, passenger in enumerate(passengers):
                if passenger["age"] < 2:
                    seats.append({"passenger_index": i, "name": passenger["name"], "label": None})
                    continue
                while label_for(cursor) in used:
                    cursor += 1
                label = label_for(cursor)
                used.add(label)
                seats.append({"passenger_index": i, "name": passenger["name"], "label": label})
            conn.execute(
                "UPDATE bookings SET status='CONFIRMED', seats_json=?, payment_ref=?, payment_method=?, "
                "payment_attempts=payment_attempts+1, confirmed_at=?, hold_expires_at=NULL WHERE pnr=?",
                (json.dumps(seats), payment_ref, method, now.isoformat(timespec="seconds"), pnr),
            )
            return self._row(conn.execute("SELECT * FROM bookings WHERE pnr=?", (pnr,)).fetchone())

    def cancel(self, pnr: str, refund_amount: str, now: datetime) -> dict[str, Any]:
        with self._tx() as conn:
            conn.execute(
                "UPDATE bookings SET status='CANCELLED', refund_amount=?, cancelled_at=?, hold_expires_at=NULL "
                "WHERE pnr=?",
                (refund_amount, now.isoformat(timespec="seconds"), pnr),
            )
            return self._row(conn.execute("SELECT * FROM bookings WHERE pnr=?", (pnr,)).fetchone())
