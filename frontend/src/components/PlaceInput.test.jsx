import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlaceInput from './PlaceInput';

const place = (name, region, country, value) => ({
  name, label: [name, region, country].filter(Boolean).join(', '), value, kind: value.startsWith('geo:') ? 'place' : 'city',
  country_code: 'IN', lat: 1, lng: 2,
});
const RANCHI = place('Ranchi', 'Jharkhand', 'India', 'geo:abc');
const DELHI = place('Delhi', '', 'India', 'DEL');

let suggestions;
let onChange;

// Mock fetch that honours AbortSignal like the real one does.
const mockFetch = () => vi.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
  const q = new URL(url, 'http://localhost').searchParams.get('q');
  const respond = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ places: suggestions(q) }) });
  signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  setTimeout(respond, 0);
}));

function Harness({ initial = '' }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="p">Place</label>
      <PlaceInput id="p" value={value} onChange={(t, p) => { onChange(t, p); setValue(t); }} placeholder="type" />
    </>
  );
}

beforeEach(() => {
  suggestions = (q) => (q.toLowerCase().startsWith('ran') ? [RANCHI] : q.toLowerCase().startsWith('del') ? [DELHI] : []);
  onChange = vi.fn();
  globalThis.fetch = mockFetch();
});

const calls = () => globalThis.fetch.mock.calls.map(([u]) => new URL(u, 'http://localhost').searchParams.get('q'));

describe('PlaceInput', () => {
  it('is an accessible combobox that starts closed', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Place' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('does not search for fewer than 2 characters', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'r');
    await new Promise((r) => setTimeout(r, 350));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('debounces typing into a single request and lists suggestions', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    const option = await screen.findByRole('option');
    expect(option).toHaveTextContent('Ranchi, Jharkhand, India');
    expect(calls()).toEqual(['ranchi']); // not one request per keystroke
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('picks a suggestion with the mouse', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    await user.click(await screen.findByRole('option'));
    expect(onChange).toHaveBeenLastCalledWith('Ranchi, Jharkhand, India', RANCHI);
    expect(screen.getByRole('combobox')).toHaveValue('Ranchi, Jharkhand, India');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 350));
    expect(calls()).toEqual(['ranchi']); // choosing must not trigger another search
  });

  it('supports keyboard selection (arrows + Enter) and Escape', async () => {
    suggestions = () => [DELHI, RANCHI];
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'de');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('-opt-0'));
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowUp}'); // wraps to the last item
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('-opt-1'));
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('Ranchi, Jharkhand, India', RANCHI);

    await user.clear(input);
    await user.type(input, 'de');
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('Enter without a highlighted suggestion leaves the typed text alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    await screen.findByRole('option');
    onChange.mockClear();
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing after a pick clears the picked place (free text again)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    await user.click(await screen.findByRole('option'));
    await user.type(screen.getByRole('combobox'), 'x');
    expect(onChange).toHaveBeenLastCalledWith('Ranchi, Jharkhand, Indiax', null);
  });

  it('says so when nothing matches and still allows free text', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'qqqq');
    expect(await screen.findByText(/No suggestions/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('qqqq');
  });

  it('degrades to free text when the service fails', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    expect(await screen.findByText(/No suggestions/)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('ranchi');
  });

  it('survives a network error', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ranchi');
    expect(await screen.findByText(/No suggestions/)).toBeInTheDocument();
  });

  it('ignores a slow response for an older query', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'ranchi');
    await screen.findByRole('option', { name: /Ranchi/ });
    await user.clear(input);
    await user.type(input, 'delhi');
    expect(await screen.findByRole('option', { name: /Delhi/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ranchi/ })).not.toBeInTheDocument();
  });

  it('reuses results for a repeated query', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'ranchi');
    await screen.findByRole('option');
    await user.clear(input);
    await user.type(input, 'ranchi');
    await screen.findByRole('option');
    expect(calls().filter((q) => q === 'ranchi')).toHaveLength(1);
  });

  it('encodes the query safely', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'a&b=c d');
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch.mock.calls[0][0]).toContain('q=a%26b%3Dc%20d');
  });

  it('does not open for a prefilled value until focused', async () => {
    render(<Harness initial="Ranchi, Jharkhand, India" />);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('Ranchi, Jharkhand, India');
  });
});
