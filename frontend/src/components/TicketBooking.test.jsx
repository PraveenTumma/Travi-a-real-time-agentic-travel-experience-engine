import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketBooking from './TicketBooking';

const loc = (code, name, cc = 'IN') => ({ code, name, country: 'X', country_code: cc });

const option = {
  option_id: 'air-DEL-BOM-2026-11-15-0', mode: 'air', operator: 'Indus Air', service_number: 'IA123',
  origin: loc('DEL', 'Delhi'), destination: loc('BOM', 'Mumbai'),
  departure: '2026-11-15T09:00', arrival: '2026-11-15T11:10', duration_minutes: 130, distance_km: 1150,
  currency: 'INR', is_international: false, amenities: ['Meal', 'Wi-Fi', 'Power outlet'],
  classes: {
    Economy: { fare: '5000', seats_available: 40, bookable: true },
    Business: { fare: '16000', seats_available: 0, bookable: false },
  },
};

const pricing = { currency: 'INR', subtotal: '5000', taxes: '600', fee: '75', total: '5675', lines: [{ category: 'adult', fare: '5000' }] };
const pending = {
  pnr: 'TRVABCD234', status: 'PENDING_PAYMENT', mode: 'air', travel_class: 'Economy', contact_email: 'a@b.co',
  service: option, passengers: [{ name: 'Asha Rao', age: 30 }], seats: [], pricing,
  hold_expires_at: new Date(Date.now() + 600000).toISOString().slice(0, 19), cancellable: true,
  payment_reference: null, payment_method: null, refund_amount: null,
};
const confirmed = {
  ...pending, status: 'CONFIRMED', hold_expires_at: null, seats: [{ passenger_index: 0, label: '15A' }],
  payment_reference: 'PAYXYZ', payment_method: 'upi', refund_if_cancelled_now: '5040',
  payment: { outcome: 'success', message: 'Payment received. Your booking is confirmed.' },
};

let routes;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  routes = {
    'GET /api/booking/locations': () => json(200, { locations: [loc('DEL', 'Delhi'), loc('BOM', 'Mumbai')] }),
    'GET /api/booking/search': () => json(200, {
      origin: option.origin, destination: option.destination, date: '2026-11-15',
      available_modes: ['air', 'train', 'bus'], results: [option], prototype: true,
    }),
    'POST /api/bookings': () => json(201, pending),
    'POST /api/bookings/TRVABCD234/pay': () => json(200, confirmed),
    'POST /api/bookings/TRVABCD234/cancel': () => json(200, { ...confirmed, status: 'CANCELLED', cancellable: false, refund_amount: '5040' }),
    'GET /api/bookings': () => json(200, { bookings: [confirmed] }),
    'GET /api/places/suggest': () => json(200, { places: [] }),
  };
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    const handler = routes[`${opts.method || 'GET'} ${path}`];
    return handler ? handler(opts) : json(404, { detail: `no route ${path}` });
  });
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

const setup = (props = {}) => render(
  <TicketBooking user={{ email: 'a@b.co', uid: 'u1' }} onClose={() => {}} {...props} />,
);

async function searchFlow(user) {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Delhi' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Mumbai' } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-15' } });
  await user.click(screen.getByRole('button', { name: /search options/i }));
}

async function fillTraveller(user) {
  await user.click(await screen.findByRole('button', { name: /Indus Air Economy/i }));
  await user.type(await screen.findByLabelText('Full name'), 'Asha Rao');
  await user.type(screen.getByLabelText('Age'), '30');
  await user.type(screen.getByLabelText(/ID number/), '123412341234');
}

describe('TicketBooking', () => {
  it('shows the prototype disclaimer', () => {
    setup();
    expect(screen.getByText(/routes, schedules and prices are sample data/i)).toBeInTheDocument();
  });

  it('prefills the search from an itinerary', () => {
    setup({ initial: { destination: 'Mumbai, India', date: '2026-11-15' } });
    expect(screen.getByLabelText('To')).toHaveValue('Mumbai, India');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-15');
  });

  it('searches and lists services with prices and seats', async () => {
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    expect(await screen.findByText('Indus Air')).toBeInTheDocument();
    expect(screen.getByText(/09:00 → 11:10/)).toBeInTheDocument();
    const calls = globalThis.fetch.mock.calls.map(([u]) => u);
    expect(calls.some((u) => u.includes('/api/booking/search?') && u.includes('origin=Delhi') && u.includes('passengers=1'))).toBe(true);
    // Sold-out class cannot be selected
    expect(screen.getByRole('button', { name: /Business/ })).toBeDisabled();
  });

  it('shows the backend error when a city is unknown', async () => {
    routes['GET /api/booking/search'] = () => json(404, { detail: "Unknown origin 'Atlantis'. Try a major city." });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("Unknown origin 'Atlantis'");
  });

  it('does not search without the required fields', async () => {
    const user = userEvent.setup();
    setup({ initial: { destination: 'Mumbai' } });
    await user.click(screen.getByRole('button', { name: /search options/i }));
    expect(globalThis.fetch.mock.calls.some(([u]) => u.includes('/search'))).toBe(false);
  });

  it('adjusts traveller count within 1-9', async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getByRole('button', { name: /more travellers/i });
    const fewer = screen.getByRole('button', { name: /fewer travellers/i });
    await user.click(fewer);
    expect(screen.getByText('1 traveller')).toBeInTheDocument();
    for (let i = 0; i < 12; i += 1) await user.click(more);
    expect(screen.getByText('9 travellers')).toBeInTheDocument();
  });

  it('completes a booking end to end and shows the ticket', async () => {
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await fillTraveller(user);
    await user.click(screen.getByRole('button', { name: /hold seats/i }));

    // payment step shows the quote and the hold timer
    expect(await screen.findByText(/Seats held for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay/ })).toHaveTextContent('5,675');
    const createCall = globalThis.fetch.mock.calls.find(([u, o]) => u.endsWith('/api/bookings') && o.method === 'POST');
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      option_id: option.option_id, travel_class: 'Economy', contact_email: 'a@b.co', user_id: 'u1',
      passengers: [{ name: 'Asha Rao', age: 30, id_number: '123412341234' }],
    });

    await user.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByTestId('pnr')).toHaveTextContent('TRVABCD234');
    expect(screen.getByText('Booking confirmed')).toBeInTheDocument();
    expect(screen.getByText('15A')).toBeInTheDocument();
    const payCall = globalThis.fetch.mock.calls.find(([u]) => u.endsWith('/pay'));
    expect(JSON.parse(payCall[1].body)).toEqual({ method: 'upi', test_scenario: 'success' });
    expect(payCall[1].headers['X-Contact-Email']).toBe('a@b.co');
    expect(localStorage.getItem('travi_booking_email')).toBe('a@b.co');
  });

  it('shows a declined payment and keeps the booking payable', async () => {
    routes['POST /api/bookings/TRVABCD234/pay'] = () => json(200, {
      ...pending, payment_attempts: 1, payment: { outcome: 'declined', message: 'Payment declined. 2 attempt(s) left.' },
    });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await fillTraveller(user);
    await user.click(screen.getByRole('button', { name: /hold seats/i }));
    await user.selectOptions(await screen.findByLabelText('Prototype test outcome'), 'decline');
    await user.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment declined. 2 attempt(s) left.');
    expect(screen.getByRole('button', { name: /Pay/ })).toBeEnabled();
    expect(screen.queryByTestId('pnr')).not.toBeInTheDocument();
  });

  it('surfaces a sold-out conflict when holding seats', async () => {
    routes['POST /api/bookings'] = () => json(409, { detail: 'Not enough seats left in that class. Pick another class or service.' });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await fillTraveller(user);
    await user.click(screen.getByRole('button', { name: /hold seats/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough seats left');
  });

  it('formats server validation errors', async () => {
    routes['POST /api/bookings'] = () => json(422, { detail: [{ loc: ['body', 'passengers', 0, 'name'], msg: 'Name must be 2-80 letters' }] });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await fillTraveller(user);
    await user.click(screen.getByRole('button', { name: /hold seats/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('passengers › 0 › name: Name must be 2-80 letters');
  });

  it('requires a passport for international flights', async () => {
    const intl = { ...option, is_international: true, currency: 'USD', classes: { Economy: { fare: '300.00', seats_available: 20, bookable: true } } };
    routes['GET /api/booking/search'] = () => json(200, {
      origin: option.origin, destination: loc('DXB', 'Dubai', 'AE'), date: '2026-11-15',
      available_modes: ['air'], results: [intl], prototype: true,
    });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await user.click(await screen.findByRole('button', { name: /Indus Air Economy/i }));
    expect(screen.getByText(/passport is required/i)).toBeInTheDocument();
    const idType = screen.getByLabelText('ID type');
    expect(idType).toBeDisabled();
    expect(idType).toHaveValue('passport');
  });

  it('hides ID fields for buses', async () => {
    const bus = {
      ...option, mode: 'bus', option_id: 'bus-DEL-BOM-2026-11-15-0', operator: 'RoadRunner Travels',
      classes: { Seater: { fare: '900', seats_available: 20, bookable: true } },
    };
    routes['GET /api/booking/search'] = () => json(200, {
      origin: option.origin, destination: option.destination, date: '2026-11-15', available_modes: ['air', 'bus'], results: [bus], prototype: true,
    });
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    await user.click(await screen.findByRole('button', { name: /RoadRunner Travels Seater/i }));
    expect(screen.queryByLabelText('ID type')).not.toBeInTheDocument();
  });

  it('lists bookings by email and cancels with a confirmation step', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: /my bookings/i }));
    await user.click(screen.getByRole('button', { name: /find bookings/i }));
    expect(await screen.findByTestId('pnr')).toHaveTextContent('TRVABCD234');

    await user.click(screen.getByRole('button', { name: /cancel booking/i }));
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('5,040');
    await user.click(within(warning).getByRole('button', { name: /yes, cancel/i }));
    await waitFor(() => expect(screen.getByText('CANCELLED')).toBeInTheDocument());
    expect(screen.getByText(/Refund:/)).toHaveTextContent('5,040');
  });

  it('offers a return trip when the itinerary has an end date', async () => {
    const user = userEvent.setup();
    setup({ initial: { origin: 'Delhi', destination: 'Mumbai', date: '2026-11-15', returnDate: '2026-11-20' } });
    await searchFlow(user);
    await fillTraveller(user);
    await user.click(screen.getByRole('button', { name: /hold seats/i }));
    await user.click(await screen.findByRole('button', { name: /Pay/ }));
    await user.click(await screen.findByRole('button', { name: /book return trip/i }));
    expect(screen.getByLabelText('From')).toHaveValue('Mumbai');
    expect(screen.getByLabelText('To')).toHaveValue('Delhi');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20');
  });

  it('reports a network failure', async () => {
    globalThis.fetch = vi.fn((url) => (String(url).includes('locations') ? json(200, { locations: [] }) : Promise.reject(new Error('down'))));
    const user = userEvent.setup();
    setup();
    await searchFlow(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the booking service');
  });

  describe('places', () => {
    const RANCHI = { name: 'Ranchi', label: 'Ranchi, Jharkhand, India', value: 'geo:RANCHI', kind: 'place', country_code: 'IN' };
    const searchUrls = () => globalThis.fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/api/booking/search'));

    it('suggests places while typing in From and sends the picked place to the search', async () => {
      routes['GET /api/places/suggest'] = () => json(200, { places: [RANCHI] });
      const user = userEvent.setup();
      setup();
      await user.type(screen.getByLabelText('From'), 'ranchi');
      await user.click(await screen.findByRole('option', { name: /Ranchi/ }));
      expect(screen.getByLabelText('From')).toHaveValue('Ranchi, Jharkhand, India');
      fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Mumbai' } });
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-15' } });
      await user.click(screen.getByRole('button', { name: /search options/i }));
      await screen.findByText('Indus Air');
      const params = new URL(searchUrls()[0], 'http://localhost').searchParams;
      expect(params.get('origin')).toBe('geo:RANCHI'); // the structured pick, not the label
      expect(params.get('destination')).toBe('Mumbai'); // free text still works
    });

    it('sends typed text when no suggestion was picked', async () => {
      const user = userEvent.setup();
      setup();
      await searchFlow(user);
      await screen.findByText('Indus Air');
      expect(new URL(searchUrls()[0], 'http://localhost').searchParams.get('origin')).toBe('Delhi');
    });

    it('typing again after a pick drops the structured place', async () => {
      routes['GET /api/places/suggest'] = () => json(200, { places: [RANCHI] });
      const user = userEvent.setup();
      setup();
      await user.type(screen.getByLabelText('From'), 'ranchi');
      await user.click(await screen.findByRole('option'));
      await user.type(screen.getByLabelText('From'), ' Station');
      fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Mumbai' } });
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-15' } });
      await user.click(screen.getByRole('button', { name: /search options/i }));
      await screen.findByText('Indus Air');
      expect(new URL(searchUrls()[0], 'http://localhost').searchParams.get('origin')).toBe('Ranchi, Jharkhand, India Station');
    });

    it('uses the origin place handed over from the trip form', async () => {
      const user = userEvent.setup();
      setup({ initial: { origin: 'Ranchi, Jharkhand, India', originPlace: RANCHI, destination: 'Mumbai, India', date: '2026-11-15' } });
      expect(screen.getByLabelText('From')).toHaveValue('Ranchi, Jharkhand, India');
      await user.click(screen.getByRole('button', { name: /search options/i }));
      await screen.findByText('Indus Air');
      expect(new URL(searchUrls()[0], 'http://localhost').searchParams.get('origin')).toBe('geo:RANCHI');
    });

    it('swaps the picked places for the return trip', async () => {
      const user = userEvent.setup();
      setup({ initial: { origin: 'Ranchi, Jharkhand, India', originPlace: RANCHI, destination: 'Mumbai', date: '2026-11-15', returnDate: '2026-11-20' } });
      await user.click(screen.getByRole('button', { name: /search options/i }));
      await fillTraveller(user);
      await user.click(screen.getByRole('button', { name: /hold seats/i }));
      await user.click(await screen.findByRole('button', { name: /Pay/ }));
      await user.click(await screen.findByRole('button', { name: /book return trip/i }));
      expect(screen.getByLabelText('To')).toHaveValue('Ranchi, Jharkhand, India');
      await user.click(screen.getByRole('button', { name: /search options/i }));
      await waitFor(() => expect(searchUrls()).toHaveLength(2));
      const params = new URL(searchUrls()[1], 'http://localhost').searchParams;
      expect(params.get('destination')).toBe('geo:RANCHI');
      expect(params.get('origin')).toBe('Mumbai');
    });

    it('shows a ticket without an empty "()" for places that have no code', async () => {
      const placeOption = { ...option, origin: { code: '', name: 'Ranchi', country: 'India', country_code: 'IN' } };
      routes['GET /api/booking/search'] = () => json(200, {
        origin: placeOption.origin, destination: option.destination, date: '2026-11-15',
        available_modes: ['air'], results: [placeOption], prototype: true,
      });
      routes['POST /api/bookings/TRVABCD234/pay'] = () => json(200, { ...confirmed, service: placeOption });
      const user = userEvent.setup();
      setup();
      await searchFlow(user);
      await fillTraveller(user);
      await user.click(screen.getByRole('button', { name: /hold seats/i }));
      await user.click(await screen.findByRole('button', { name: /Pay/ }));
      await screen.findByTestId('pnr');
      expect(screen.getByText('Ranchi')).toBeInTheDocument();
      expect(screen.queryByText(/Ranchi \(\)/)).not.toBeInTheDocument();
      expect(screen.getByText('Mumbai (BOM)')).toBeInTheDocument();
    });
  });
});
