import { useState, useEffect, useRef, useId } from 'react';
import PropTypes from 'prop-types';
import { MapPin } from 'lucide-react';
import { API_BASE } from '../utils/api';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/**
 * PlaceInput — text field with worldwide place suggestions (GET /api/places/suggest).
 *
 * Controlled: `value` is the text; `onChange(text, place)` fires on every keystroke with
 * `place = null` (free text), and again with the chosen suggestion when one is picked.
 * Free text is always allowed, so a failing suggestion service never blocks the form.
 *
 * The list renders in normal flow (not absolutely positioned) so it is not clipped by
 * `overflow: hidden` containers such as the Trip Details accordion.
 */
export default function PlaceInput({
  id, value, onChange, placeholder, required = false, style, maxLength = 200, autoFocus = false,
}) {
  const reactId = useId();
  const inputId = id || reactId;
  const listId = `${inputId}-listbox`;
  const [byQuery, setByQuery] = useState({}); // trimmed query -> suggestions (doubles as a session cache)
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef(null);
  const controller = useRef(null);
  const [pickedLabel, setPickedLabel] = useState(null); // text set by a selection: don't search for it again

  const q = (value || '').trim();
  const searchable = q.length >= MIN_CHARS && q !== pickedLabel;
  const results = searchable ? byQuery[q] : undefined;
  const places = results || [];
  const status = !searchable ? 'idle' : results === undefined ? 'loading' : 'done';

  useEffect(() => () => { clearTimeout(timer.current); controller.current?.abort(); }, []);

  // Fetch suggestions for a new query (debounced; the previous request is aborted).
  useEffect(() => {
    clearTimeout(timer.current);
    controller.current?.abort();
    if (!searchable || byQuery[q] !== undefined) return undefined;
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      controller.current = ctrl;
      let list = [];
      try {
        const res = await fetch(`${API_BASE}/api/places/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        list = Array.isArray(data.places) ? data.places : [];
      } catch (err) {
        if (err.name === 'AbortError') return;
        // any other failure: degrade to free text
      }
      setByQuery((prev) => {
        const keys = Object.keys(prev);
        const next = keys.length >= 50 ? Object.fromEntries(keys.slice(-25).map((k) => [k, prev[k]])) : prev;
        return { ...next, [q]: list };
      });
    }, DEBOUNCE_MS);
    return undefined;
  }, [q, searchable, byQuery]);

  const choose = (place) => {
    setPickedLabel(place.label);
    onChange(place.label, place);
    setOpen(false); setActive(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!places.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        return (i + step + places.length) % places.length;
      });
    } else if (e.key === 'Enter' && open && active >= 0 && places[active]) {
      e.preventDefault(); // pick the suggestion instead of submitting the form
      choose(places[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && places.length > 0;
  const showEmpty = open && status === 'done' && places.length === 0;

  return (
    <div>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${inputId}-opt-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        required={required}
        aria-required={required || undefined}
        maxLength={maxLength}
        value={value}
        style={style}
        onChange={(e) => { setPickedLabel(null); setActive(-1); onChange(e.target.value, null); setOpen(true); }}
        onFocus={() => { if (searchable) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <div aria-live="polite" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minHeight: open && status === 'loading' ? '1rem' : 0 }}>
        {open && status === 'loading' ? 'Searching places…' : ''}
        {showEmpty ? 'No suggestions. You can still type any place.' : ''}
      </div>
      <ul
        id={listId}
        role="listbox"
        hidden={!showList}
        style={{
          listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 220, overflowY: 'auto',
          border: '2px solid var(--ink-black)', borderRadius: 8, background: 'white',
          boxShadow: '2px 2px 0 var(--ink-black)',
        }}
      >
        {places.map((p, i) => (
          <li
            key={p.value}
            id={`${inputId}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown (not click) so the input keeps focus and the blur handler doesn't swallow the pick
            onMouseDown={(e) => { e.preventDefault(); choose(p); }}
            onMouseEnter={() => setActive(i)}
            style={{
              padding: '0.5rem 0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              background: i === active ? 'var(--bg-yellow)' : 'white',
              borderBottom: i < places.length - 1 ? '1px dashed #bbb' : 'none',
              fontFamily: 'Nunito, sans-serif', fontSize: '0.92rem', color: 'var(--ink-black)',
            }}
          >
            <MapPin size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <strong>{p.name}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>{p.label.slice(p.name.length)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

PlaceInput.propTypes = {
  id: PropTypes.string,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  style: PropTypes.object,
  maxLength: PropTypes.number,
  autoFocus: PropTypes.bool,
};
