import { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import {
  X, Plane, TrainFront, Bus, Users, ArrowRight, Clock, CheckCircle2,
  AlertTriangle, Ticket, Printer, Undo2, Plus, Minus, ArrowLeftRight,
} from 'lucide-react';
import { money, fmtDuration, fmtTime, fmtDate, errorMessage, holdSecondsLeft, dayOffset } from '../utils/booking';

const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;
const EMAIL_KEY = 'travi_booking_email';

const MODE_META = {
  air: { label: 'Flight', Icon: Plane, color: 'var(--marker-blue)' },
  train: { label: 'Train', Icon: TrainFront, color: 'var(--marker-green)' },
  bus: { label: 'Bus', Icon: Bus, color: 'var(--marker-red)' },
};
const ID_TYPES = [
  ['passport', 'Passport'], ['aadhaar', 'Aadhaar'], ['pan', 'PAN'],
  ['driving_license', 'Driving licence'], ['voter_id', 'Voter ID'], ['national_id', 'National ID'],
];
const PAY_METHODS = [['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net banking'], ['wallet', 'Wallet']];

const ink = 'var(--ink-black)';
const box = { border: `2px solid ${ink}`, borderRadius: 8, background: 'var(--paper-white)', boxShadow: `3px 3px 0 ${ink}` };
const inputStyle = {
  padding: '0.5rem 0.6rem', border: `2px solid ${ink}`, borderRadius: 8, fontFamily: 'Nunito, sans-serif',
  fontSize: '0.95rem', background: 'white', color: ink, width: '100%', boxSizing: 'border-box',
};
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 'bold', fontSize: '0.8rem', color: ink };
const btn = (bg, color = ink, disabled = false) => ({
  padding: '0.55rem 1rem', border: `2px solid ${ink}`, borderRadius: 8, background: disabled ? '#ccc' : bg, color,
  fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.95rem', boxShadow: `2px 2px 0 ${ink}`,
  cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
});

async function api(path, { method = 'GET', body, email } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (email) headers['X-Contact-Email'] = email;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the booking service. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(data, `Request failed (${res.status})`));
  return data;
}

const emptyPassenger = (international) => ({
  name: '', age: '', gender: 'M', id_type: international ? 'passport' : 'aadhaar', id_number: '',
});

function Banner({ children, tone = 'info' }) {
  const bg = tone === 'error' ? 'var(--bg-red)' : tone === 'ok' ? 'var(--bg-green)' : 'var(--bg-yellow)';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} style={{ ...box, boxShadow: 'none', background: bg, padding: '0.5rem 0.75rem', fontSize: '0.9rem', color: ink }}>
      {children}
    </div>
  );
}
Banner.propTypes = { children: PropTypes.node, tone: PropTypes.string };

function ModeIcon({ mode, size = 18 }) {
  const { Icon } = MODE_META[mode];
  return <Icon size={size} aria-hidden="true" />;
}
ModeIcon.propTypes = { mode: PropTypes.string.isRequired, size: PropTypes.number };

/** Booking confirmation / e-ticket. */
function Ticket_({ booking, onCancel, onReturn, cancelling }) {
  const s = booking.service;
  const confirmed = booking.status === 'CONFIRMED';
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cur = booking.pricing.currency;
  const statusColor = confirmed ? 'var(--marker-green)' : booking.status === 'CANCELLED' ? 'var(--marker-red)' : 'var(--marker-yellow)';
  return (
    <div className="travi-ticket" style={{ ...box, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>BOOKING REFERENCE (PNR)</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, letterSpacing: 2 }} data-testid="pnr">{booking.pnr}</div>
        </div>
        <span style={{ background: statusColor, color: confirmed ? 'white' : ink, border: `2px solid ${ink}`, borderRadius: 20, padding: '0.2rem 0.8rem', fontWeight: 'bold' }}>
          {booking.status.replace('_', ' ')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ModeIcon mode={booking.mode} size={24} />
        <div style={{ fontWeight: 'bold' }}>{s.operator} · {s.service_number} · {booking.travel_class}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{fmtTime(s.departure)}</div>
          <div style={{ fontWeight: 'bold' }}>{s.origin.name} ({s.origin.code})</div>
          <div style={{ fontSize: '0.85rem' }}>{fmtDate(s.departure)}</div>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.8rem' }}><ArrowRight /><div>{fmtDuration(s.duration_minutes)}</div></div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{fmtTime(s.arrival)}</div>
          <div style={{ fontWeight: 'bold' }}>{s.destination.name} ({s.destination.code})</div>
          <div style={{ fontSize: '0.85rem' }}>{fmtDate(s.arrival)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: `2px solid ${ink}` }}>
            <th>Traveller</th><th>Age</th><th>Seat / berth</th>
          </tr></thead>
          <tbody>
            {booking.passengers.map((p, i) => {
              const seat = booking.seats[i];
              return (
                <tr key={`${p.name}-${i}`} style={{ borderBottom: '1px dashed #999' }}>
                  <td style={{ padding: '4px 0' }}>{p.name}</td>
                  <td>{p.age}</td>
                  <td>{confirmed ? (seat?.label || 'Infant (on lap)') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.9rem', display: 'grid', gap: 2 }}>
        <div>Fare: {money(booking.pricing.subtotal, cur)} · Taxes: {money(booking.pricing.taxes, cur)} · Fee: {money(booking.pricing.fee, cur)}</div>
        <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>Total: {money(booking.pricing.total, cur)}</div>
        {booking.payment_reference && <div>Payment ref: {booking.payment_reference} ({booking.payment_method})</div>}
        {booking.status === 'CANCELLED' && booking.refund_amount != null && (
          <div style={{ fontWeight: 'bold' }}>Refund: {money(booking.refund_amount, cur)} (convenience fee is non-refundable)</div>
        )}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        Prototype ticket with sample data. Not valid for travel.
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {confirmed && <button style={btn('white')} onClick={() => window.print()}><Printer size={16} /> Print ticket</button>}
        {onReturn && confirmed && <button style={btn('var(--marker-yellow)')} onClick={onReturn}><ArrowLeftRight size={16} /> Book return trip</button>}
        {booking.cancellable && !confirmCancel && (
          <button style={btn('white')} onClick={() => setConfirmCancel(true)}><Undo2 size={16} /> Cancel booking</button>
        )}
      </div>
      {confirmCancel && booking.cancellable && (
        <Banner tone="error">
          <div style={{ marginBottom: 6 }}>
            {confirmed
              ? `Cancel this booking? You will be refunded ${money(booking.refund_if_cancelled_now ?? 0, cur)} under the cancellation policy.`
              : 'Release the held seats and cancel this booking?'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn('var(--marker-red)', 'white', cancelling)} disabled={cancelling} onClick={() => onCancel(booking.pnr)}>
              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button style={btn('white')} onClick={() => setConfirmCancel(false)}>Keep booking</button>
          </div>
        </Banner>
      )}
    </div>
  );
}
Ticket_.propTypes = {
  booking: PropTypes.object.isRequired, onCancel: PropTypes.func.isRequired,
  onReturn: PropTypes.func, cancelling: PropTypes.bool,
};

/**
 * TicketBooking — prototype bus / train / flight booking flow:
 * search → choose service → traveller details → (simulated) payment → ticket.
 */
export default function TicketBooking({ user, initial, onClose }) {
  const [tab, setTab] = useState('book'); // book | mine
  const [step, setStep] = useState('search'); // search | results | travellers | payment | done
  const [search, setSearch] = useState({
    origin: initial?.origin || '', destination: initial?.destination || '',
    date: initial?.date || '', passengers: 1, mode: '',
  });
  const [results, setResults] = useState(null);
  const [sort, setSort] = useState('departure');
  const [selected, setSelected] = useState(null); // { option, cls }
  const [travellers, setTravellers] = useState([emptyPassenger(false)]);
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(EMAIL_KEY) || user?.email || ''; } catch { return user?.email || ''; }
  });
  const [phone, setPhone] = useState('');
  const [booking, setBooking] = useState(null);
  const [payMethod, setPayMethod] = useState('upi');
  const [scenario, setScenario] = useState('success');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mine, setMine] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    api('/api/booking/locations').then((d) => setLocations(d.locations)).catch(() => {});
  }, []);

  // Seat-hold countdown.
  useEffect(() => {
    if (step !== 'payment') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  const holdLeft = useMemo(() => {
    return holdSecondsLeft(booking?.hold_expires_at, now);
  }, [booking, now]);

  const international = !!selected?.option.is_international && selected?.option.mode === 'air';

  const patch = (setter) => (key) => (e) => setter((prev) => ({ ...prev, [key]: e.target.value }));
  const setField = patch(setSearch);

  const run = useCallback(async (fn) => {
    setBusy(true); setError(''); setNotice('');
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
  }, []);

  const doSearch = (e) => {
    e?.preventDefault();
    if (!search.origin.trim() || !search.destination.trim() || !search.date) {
      setError('Enter origin, destination and travel date.'); return;
    }
    run(async () => {
      const qs = new URLSearchParams({
        origin: search.origin.trim(), destination: search.destination.trim(), date: search.date,
        passengers: String(search.passengers),
      });
      if (search.mode) qs.set('mode', search.mode);
      setResults(await api(`/api/booking/search?${qs}`));
      setStep('results');
    });
  };

  const sortedResults = useMemo(() => {
    if (!results) return [];
    const cheapest = (o) => Math.min(...Object.values(o.classes).map((c) => Number(c.fare)));
    const copy = [...results.results];
    if (sort === 'price') copy.sort((a, b) => cheapest(a) - cheapest(b));
    else if (sort === 'duration') copy.sort((a, b) => a.duration_minutes - b.duration_minutes);
    return copy;
  }, [results, sort]);

  const choose = (option, cls) => {
    const intl = option.is_international && option.mode === 'air';
    setSelected({ option, cls });
    setTravellers(Array.from({ length: search.passengers }, () => emptyPassenger(intl)));
    setStep('travellers');
    setError('');
  };

  const updateTraveller = (i, key, value) =>
    setTravellers((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));

  const changePassengerCount = (delta) =>
    setSearch((s) => ({ ...s, passengers: Math.min(9, Math.max(1, s.passengers + delta)) }));

  const createBooking = (e) => {
    e.preventDefault();
    run(async () => {
      const passengers = travellers.map((p) => ({
        name: p.name.trim(), age: Number(p.age), gender: p.gender,
        id_type: p.id_number.trim() ? p.id_type : null, id_number: p.id_number.trim() || null,
      }));
      if (travellers.some((t) => t.age === '')) {
        throw new Error('Enter an age for every traveller (0 for infants under 1).');
      }
      const created = await api('/api/bookings', {
        method: 'POST',
        body: {
          option_id: selected.option.option_id, travel_class: selected.cls, passengers,
          contact_email: email.trim(), contact_phone: phone.trim() || null, user_id: user?.uid || null,
        },
      });
      try { localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase()); } catch { /* storage unavailable */ }
      setBooking(created);
      setNow(Date.now());
      setStep('payment');
    });
  };

  const pay = () => run(async () => {
    const out = await api(`/api/bookings/${booking.pnr}/pay`, {
      method: 'POST', email: booking.contact_email, body: { method: payMethod, test_scenario: scenario },
    });
    setBooking(out);
    const outcome = out.payment?.outcome;
    if (outcome === 'success') { setStep('done'); setNotice(out.payment.message); }
    else if (out.status === 'PAYMENT_FAILED') { setError(out.payment.message); setStep('done'); }
    else setError(out.payment?.message || 'Payment did not complete.');
  });

  const cancel = (pnr) => run(async () => {
    const out = await api(`/api/bookings/${pnr}/cancel`, { method: 'POST', email: booking?.contact_email || email });
    setBooking(out);
    setMine((list) => list && list.map((b) => (b.pnr === out.pnr ? out : b)));
    setNotice(out.status === 'CANCELLED' ? 'Booking cancelled.' : '');
    return out;
  });

  const loadMine = () => run(async () => {
    if (!email.trim()) throw new Error('Enter the email you booked with.');
    const out = await api('/api/bookings', { email: email.trim() });
    setMine(out.bookings);
  });

  const bookReturn = () => {
    setSearch((s) => ({ ...s, origin: s.destination, destination: s.origin, date: initial?.returnDate || '' }));
    setBooking(null); setSelected(null); setResults(null); setStep('search'); setNotice(''); setError('');
  };

  const reset = () => { setStep('search'); setBooking(null); setSelected(null); setError(''); setNotice(''); };

  const intlTravellers = international;
  const mm = String(Math.floor(holdLeft / 60)).padStart(2, '0');
  const ss = String(holdLeft % 60).padStart(2, '0');

  return (
    <div role="dialog" aria-modal="true" aria-label="Book tickets" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '2rem 1rem',
    }}>
      <style>{`@media print { body * { visibility: hidden; } .travi-ticket, .travi-ticket * { visibility: visible; } .travi-ticket { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ ...box, width: 'min(860px, 100%)', padding: '1.25rem', color: ink }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 className="cartoon-font" style={{ margin: 0, fontSize: '2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ticket aria-hidden="true" /> Book Tickets
          </h2>
          <button aria-label="Close booking" onClick={onClose} style={{ ...btn('white'), padding: '0.3rem' }}><X size={18} /></button>
        </div>
        <Banner>
          Prototype: routes, schedules and prices are sample data and no real payment is taken. Live provider integrations are planned.
        </Banner>

        <div role="tablist" style={{ display: 'flex', gap: 8, margin: '0.75rem 0' }}>
          {[['book', 'New booking'], ['mine', 'My bookings']].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setError(''); setNotice(''); }}
              style={btn(tab === id ? 'var(--marker-yellow)' : 'white')}>{label}</button>
          ))}
        </div>

        {error && <div style={{ marginBottom: 8 }}><Banner tone="error">{error}</Banner></div>}
        {notice && <div style={{ marginBottom: 8 }}><Banner tone="ok">{notice}</Banner></div>}

        {tab === 'mine' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <form onSubmit={(e) => { e.preventDefault(); loadMine(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...labelStyle, flex: '1 1 240px' }}>Email used for booking
                <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <button type="submit" style={btn('var(--marker-blue)', 'white', busy)} disabled={busy}>Find bookings</button>
            </form>
            {mine && mine.length === 0 && <p>No bookings found for this email.</p>}
            {mine && mine.map((b) => (
              <Ticket_ key={b.pnr} booking={b} onCancel={cancel} cancelling={busy} />
            ))}
          </div>
        )}

        {tab === 'book' && step === 'search' && (
          <form onSubmit={doSearch} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <label style={labelStyle}>From
                <input list="travi-locations" style={inputStyle} value={search.origin} onChange={setField('origin')} placeholder="e.g. Delhi" required />
              </label>
              <label style={labelStyle}>To
                <input list="travi-locations" style={inputStyle} value={search.destination} onChange={setField('destination')} placeholder="e.g. Mumbai or Dubai" required />
              </label>
              <label style={labelStyle}>Date
                <input type="date" style={inputStyle} value={search.date} onChange={setField('date')} min={new Date().toISOString().slice(0, 10)} required />
              </label>
            </div>
            <datalist id="travi-locations">
              {locations.map((l) => <option key={l.code} value={l.name}>{l.country}</option>)}
            </datalist>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} aria-hidden="true" />
                <button type="button" aria-label="Fewer travellers" style={{ ...btn('white'), padding: '0.2rem 0.5rem' }} onClick={() => changePassengerCount(-1)}><Minus size={14} /></button>
                <strong aria-live="polite">{search.passengers} traveller{search.passengers > 1 ? 's' : ''}</strong>
                <button type="button" aria-label="More travellers" style={{ ...btn('white'), padding: '0.2rem 0.5rem' }} onClick={() => changePassengerCount(1)}><Plus size={14} /></button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['', 'Any'], ['air', 'Flight'], ['train', 'Train'], ['bus', 'Bus']].map(([v, l]) => (
                  <button key={v || 'any'} type="button" aria-pressed={search.mode === v}
                    onClick={() => setSearch((s) => ({ ...s, mode: v }))}
                    style={btn(search.mode === v ? 'var(--marker-yellow)' : 'white')}>{l}</button>
                ))}
              </div>
            </div>
            <div><button type="submit" style={btn('var(--marker-yellow)', ink, busy)} disabled={busy}>
              {busy ? 'Searching…' : 'Search options'}
            </button></div>
          </form>
        )}

        {tab === 'book' && step === 'results' && results && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 'bold' }}>
                {results.origin.name} → {results.destination.name} · {fmtDate(results.date)} · {search.passengers} traveller{search.passengers > 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center' }}>Sort
                  <select style={{ ...inputStyle, width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="departure">Earliest</option><option value="price">Cheapest</option><option value="duration">Fastest</option>
                  </select>
                </label>
                <button style={btn('white')} onClick={() => setStep('search')}>Edit search</button>
              </div>
            </div>
            {results.available_modes.length === 1 && (
              <Banner>Only flights connect these two places in the prototype catalog.</Banner>
            )}
            {sortedResults.length === 0 && <Banner>No services left for this date. Try another day.</Banner>}
            {sortedResults.map((o) => {
              const meta = MODE_META[o.mode];
              return (
                <div key={o.option_id} style={{ ...box, padding: '0.75rem', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'bold' }}>
                      <span style={{ background: meta.color, color: 'white', borderRadius: 6, padding: '2px 6px', display: 'inline-flex' }}><ModeIcon mode={o.mode} /></span>
                      {o.operator} <span style={{ fontWeight: 'normal' }}>{o.service_number}</span>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900 }}>
                      {fmtTime(o.departure)} → {fmtTime(o.arrival)}{dayOffset(o) > 0 && <sup title="Arrives next day"> +{dayOffset(o)}</sup>}
                      <span style={{ fontWeight: 'normal', fontSize: '0.85rem', marginLeft: 8 }}><Clock size={12} /> {fmtDuration(o.duration_minutes)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{o.amenities.join(' · ')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(o.classes).map(([cls, info]) => (
                      <button key={cls} disabled={!info.bookable} onClick={() => choose(o, cls)}
                        aria-label={`${o.operator} ${cls} ${money(info.fare, o.currency)} per adult, ${info.seats_available} seats left`}
                        style={{ ...btn(info.bookable ? 'white' : '#eee'), flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
                        <span style={{ fontSize: '0.8rem' }}>{cls}</span>
                        <span>{money(info.fare, o.currency)}</span>
                        <span style={{ fontSize: '0.7rem', color: info.seats_available <= 5 ? 'var(--marker-red)' : 'var(--text-secondary)' }}>
                          {info.seats_available === 0 ? 'Sold out' : !info.bookable ? `Only ${info.seats_available} left` : `${info.seats_available} left`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'book' && step === 'travellers' && selected && (
          <form onSubmit={createBooking} style={{ display: 'grid', gap: 12 }}>
            <div style={{ ...box, boxShadow: 'none', padding: '0.5rem 0.75rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <ModeIcon mode={selected.option.mode} />
              <strong>{selected.option.operator} {selected.option.service_number}</strong>
              {selected.option.origin.name} {fmtTime(selected.option.departure)} → {selected.option.destination.name} {fmtTime(selected.option.arrival)} · {selected.cls}
            </div>
            {intlTravellers && <Banner>International flight: a passport is required for every traveller aged 2 or over.</Banner>}
            {travellers.map((p, i) => (
              <fieldset key={i} style={{ ...box, boxShadow: 'none', padding: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <legend style={{ fontWeight: 'bold', padding: '0 6px' }}>Traveller {i + 1}</legend>
                <label style={labelStyle}>Full name
                  <input style={inputStyle} value={p.name} onChange={(e) => updateTraveller(i, 'name', e.target.value)} required minLength={2} maxLength={80} />
                </label>
                <label style={labelStyle}>Age
                  <input type="number" min="0" max="120" style={inputStyle} value={p.age} onChange={(e) => updateTraveller(i, 'age', e.target.value)} required />
                </label>
                <label style={labelStyle}>Gender
                  <select style={inputStyle} value={p.gender} onChange={(e) => updateTraveller(i, 'gender', e.target.value)}>
                    <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                  </select>
                </label>
                {selected.option.mode !== 'bus' && (
                  <>
                    <label style={labelStyle}>ID type
                      <select style={inputStyle} value={p.id_type} onChange={(e) => updateTraveller(i, 'id_type', e.target.value)} disabled={intlTravellers}>
                        {ID_TYPES.filter(([v]) => !intlTravellers || v === 'passport').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>ID number {Number(p.age) >= 18 || intlTravellers ? '' : '(optional)'}
                      <input style={inputStyle} value={p.id_number} onChange={(e) => updateTraveller(i, 'id_number', e.target.value)} maxLength={20} />
                    </label>
                  </>
                )}
              </fieldset>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <label style={labelStyle}>Contact email (ticket is tied to this)
                <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label style={labelStyle}>Phone (optional)
                <input type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
            </div>
            <div style={{ fontSize: '0.8rem' }}>Children 2–11 pay 75% of the adult fare. Infants under 2 travel on an adult's lap (flights charge 10%; trains and buses are free).</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={btn('white')} onClick={() => setStep('results')}>Back</button>
              <button type="submit" style={btn('var(--marker-yellow)', ink, busy)} disabled={busy}>
                {busy ? 'Holding seats…' : 'Hold seats & continue'}
              </button>
            </div>
          </form>
        )}

        {tab === 'book' && step === 'payment' && booking && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Banner tone={holdLeft > 0 ? 'info' : 'error'}>
              {holdLeft > 0
                ? <><Clock size={14} /> Seats held for {mm}:{ss}. Pay before the timer ends.</>
                : <><AlertTriangle size={14} /> Your seat hold expired. Start a new search to rebook.</>}
            </Banner>
            <div style={{ ...box, boxShadow: 'none', padding: '0.75rem', display: 'grid', gap: 4 }}>
              <div style={{ fontWeight: 'bold' }}>PNR {booking.pnr} · {booking.service.origin.name} → {booking.service.destination.name} · {booking.travel_class}</div>
              {booking.passengers.map((p, i) => (
                <div key={`${p.name}-${i}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.name} ({p.age})</span>
                  <span>{booking.pricing.lines ? money(booking.pricing.lines[i].fare, booking.pricing.currency) : ''}</span>
                </div>
              ))}
              <hr style={{ width: '100%', border: '1px dashed #999' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxes</span><span>{money(booking.pricing.taxes, booking.pricing.currency)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Convenience fee</span><span>{money(booking.pricing.fee, booking.pricing.currency)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '1.2rem' }}>
                <span>Total</span><span>{money(booking.pricing.total, booking.pricing.currency)}</span>
              </div>
            </div>
            <fieldset style={{ ...box, boxShadow: 'none', padding: '0.75rem' }}>
              <legend style={{ fontWeight: 'bold', padding: '0 6px' }}>Payment method (simulated)</legend>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {PAY_METHODS.map(([v, l]) => (
                  <label key={v} style={{ display: 'flex', gap: 4, alignItems: 'center', fontWeight: 'bold' }}>
                    <input type="radio" name="pay" value={v} checked={payMethod === v} onChange={() => setPayMethod(v)} /> {l}
                  </label>
                ))}
              </div>
              <p style={{ fontSize: '0.8rem', margin: '8px 0' }}>No card or bank details are collected in this prototype.</p>
              <label style={{ ...labelStyle, maxWidth: 320 }}>Prototype test outcome
                <select style={inputStyle} value={scenario} onChange={(e) => setScenario(e.target.value)}>
                  <option value="success">Payment succeeds</option>
                  <option value="decline">Payment is declined</option>
                  <option value="timeout">Gateway times out</option>
                </select>
              </label>
            </fieldset>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={btn('var(--marker-green)', 'white', busy || holdLeft === 0)} disabled={busy || holdLeft === 0} onClick={pay}>
                {busy ? 'Processing…' : `Pay ${money(booking.pricing.total, booking.pricing.currency)}`}
              </button>
              <button style={btn('white')} disabled={busy} onClick={() => cancel(booking.pnr).then((out) => { if (out) { reset(); setNotice('Seats released.'); } })}>Release seats & start over</button>
            </div>
          </div>
        )}

        {tab === 'book' && step === 'done' && booking && (
          <div style={{ display: 'grid', gap: 12 }}>
            {booking.status === 'CONFIRMED' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: '1.2rem' }}>
                <CheckCircle2 color="var(--marker-green)" /> Booking confirmed
              </div>
            )}
            <Ticket_ booking={booking} onCancel={cancel} cancelling={busy} onReturn={initial?.returnDate ? bookReturn : undefined} />
            <div className="no-print"><button style={btn('white')} onClick={reset}>Book another trip</button></div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

TicketBooking.propTypes = {
  user: PropTypes.shape({ email: PropTypes.string, uid: PropTypes.string }),
  initial: PropTypes.shape({
    origin: PropTypes.string, destination: PropTypes.string, date: PropTypes.string, returnDate: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};
