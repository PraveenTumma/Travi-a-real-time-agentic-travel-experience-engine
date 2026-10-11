// Pure helpers for the ticket-booking UI.

export const money = (amount, currency) =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: currency === 'INR' ? 0 : 2,
  }).format(Number(amount));

export const fmtDuration = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export const fmtTime = (iso) => iso.slice(11, 16);

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Turn a FastAPI error body (string or validation list) into a readable message. */
export function errorMessage(body, fallback) {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d.map((e) => `${(e.loc || []).filter((p) => p !== 'body').join(' › ')}: ${e.msg}`).join('; ');
  }
  return fallback;
}

/** Seconds left on a seat hold. `holdExpiresAt` is a naive UTC ISO string from the API. */
export function holdSecondsLeft(holdExpiresAt, nowMs) {
  if (!holdExpiresAt) return 0;
  return Math.max(0, Math.floor((new Date(`${holdExpiresAt}Z`).getTime() - nowMs) / 1000));
}

/** Whole days between departure and arrival (0 for same-day services). */
export const dayOffset = (option) =>
  Math.round((new Date(`${option.arrival.slice(0, 10)}T00:00`) - new Date(`${option.departure.slice(0, 10)}T00:00`)) / 86400000);
