import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Firestore/Firebase and the heavy map/chat widgets are out of scope here.
vi.mock('../services/firestoreService', () => ({
  saveTrip: vi.fn(() => Promise.resolve('trip1')),
  subscribeToSavedTrips: vi.fn((uid, cb) => { cb([]); return () => {}; }),
  subscribeToSharedTrips: vi.fn((uid, cb) => { cb([]); return () => {}; }),
  deleteSavedTrip: vi.fn(),
  subscribeToFriends: vi.fn(() => () => {}),
  createSharedTrip: vi.fn(),
}));
vi.mock('../components/ItineraryMap', () => ({ default: () => <div data-testid="map" /> }));
vi.mock('../components/TripChatbot', () => ({ default: () => <div data-testid="chat" /> }));

import Dashboard from './Dashboard';
import { saveTrip } from '../services/firestoreService';

const user = { uid: 'u1', email: 'asha@example.com', displayName: 'Asha' };
const RANCHI = {
  name: 'Ranchi', label: 'Ranchi, Jharkhand, India', value: 'geo:RANCHI', kind: 'place', country_code: 'IN', lat: 23.3, lng: 85.3,
};
const ITINERARY = {
  destination: 'Mumbai, India', summary: 'Two sunny days.', weather_overview: 'Warm',
  origin: 'Ranchi, Jharkhand, India', total_estimated_cost_usd: 200,
  itinerary: [{ day: 1, date: '2026-11-15', theme: 'Arrival', weather_note: 'Sunny', activities: [], meals: [], daily_budget_estimate_usd: 50 }],
};

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
let planBodies;

beforeEach(() => {
  localStorage.clear();
  planBodies = [];
  vi.mocked(saveTrip).mockClear();
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/places/suggest') {
      const q = new URL(url, 'http://localhost').searchParams.get('q').toLowerCase();
      return ok({ places: q.startsWith('ran') ? [RANCHI] : [] });
    }
    if (path === '/api/plan') { planBodies.push(JSON.parse(opts.body)); return ok(ITINERARY); }
    if (path === '/api/replan') { planBodies.push(JSON.parse(opts.body)); return ok(ITINERARY); }
    if (path === '/api/maps-key') return ok({ key: '' });
    if (path === '/api/booking/search') return ok({
      origin: { code: '', name: 'Ranchi', country: 'India', country_code: 'IN' },
      destination: { code: 'BOM', name: 'Mumbai', country: 'India', country_code: 'IN' },
      date: '2026-11-15', available_modes: ['air'], results: [], prototype: true,
    });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
});

const fillTrip = () => {
  fireEvent.change(screen.getByLabelText(/Destination/), { target: { value: 'Mumbai, India' } });
  fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2026-11-15' } });
  fireEvent.change(screen.getByLabelText(/End Date/), { target: { value: '2026-11-17' } });
};

async function pickRanchi(u) {
  await u.type(screen.getByLabelText(/Starting from/), 'ranchi');
  await u.click(await screen.findByRole('option', { name: /Ranchi/ }));
}

describe('Dashboard origin field', () => {
  it('shows an optional Origin field above Destination in Trip Details', () => {
    render(<Dashboard user={user} />);
    const origin = screen.getByLabelText(/Starting from/);
    const destination = screen.getByLabelText(/Destination/);
    expect(origin).not.toBeRequired();
    expect(destination).toBeRequired();
    expect(origin.compareDocumentPosition(destination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('suggests places while typing and fills in the chosen one', async () => {
    const u = userEvent.setup();
    render(<Dashboard user={user} />);
    await pickRanchi(u);
    expect(screen.getByLabelText(/Starting from/)).toHaveValue('Ranchi, Jharkhand, India');
  });

  it('sends the origin with the plan request', async () => {
    const u = userEvent.setup();
    render(<Dashboard user={user} />);
    await pickRanchi(u);
    fillTrip();
    await u.click(screen.getByRole('button', { name: /Generate Itinerary/ }));
    await waitFor(() => expect(planBodies).toHaveLength(1));
    expect(planBodies[0]).toMatchObject({ origin: 'Ranchi, Jharkhand, India', destination: 'Mumbai, India' });
    expect(await screen.findByText(/Starting from Ranchi, Jharkhand, India/)).toBeInTheDocument();
  });

  it('omits the origin when it is left blank', async () => {
    const u = userEvent.setup();
    render(<Dashboard user={user} />);
    fillTrip();
    await u.click(screen.getByRole('button', { name: /Generate Itinerary/ }));
    await waitFor(() => expect(planBodies).toHaveLength(1));
    expect(planBodies[0].origin).toBeUndefined();
  });

  it('remembers the origin for next time', async () => {
    const u = userEvent.setup();
    const first = render(<Dashboard user={user} />);
    await pickRanchi(u);
    first.unmount();
    render(<Dashboard user={user} />);
    expect(screen.getByLabelText(/Starting from/)).toHaveValue('Ranchi, Jharkhand, India');
  });

  it('ignores corrupt remembered data', () => {
    localStorage.setItem('travi_origin', '{not json');
    render(<Dashboard user={user} />);
    expect(screen.getByLabelText(/Starting from/)).toHaveValue('');
  });

  it('prefills Book Travel with the origin and the exact picked place', async () => {
    const u = userEvent.setup();
    render(<Dashboard user={user} />);
    await pickRanchi(u);
    fillTrip();
    await u.click(screen.getByRole('button', { name: /Generate Itinerary/ }));
    await u.click(await screen.findByRole('button', { name: /Book Travel/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByLabelText('From').at(-1)).toHaveValue('Ranchi, Jharkhand, India');
    expect(screen.getAllByLabelText('To').at(-1)).toHaveValue('Mumbai, India');
    await u.click(screen.getByRole('button', { name: /search options/i }));
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([x]) => x.includes('/api/booking/search'))).toBe(true));
    const url = globalThis.fetch.mock.calls.map(([x]) => x).find((x) => x.includes('/api/booking/search'));
    expect(new URL(url, 'http://localhost').searchParams.get('origin')).toBe('geo:RANCHI');
  });

  it('stores the origin when saving a trip', async () => {
    const u = userEvent.setup();
    render(<Dashboard user={user} />);
    await pickRanchi(u);
    fillTrip();
    await u.click(screen.getByRole('button', { name: /Generate Itinerary/ }));
    await u.click(await screen.findByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(saveTrip).toHaveBeenCalled());
    expect(saveTrip.mock.calls[0][1]).toMatchObject({
      destination: 'Mumbai, India', origin: 'Ranchi, Jharkhand, India', originValue: 'geo:RANCHI',
    });
  });
});
