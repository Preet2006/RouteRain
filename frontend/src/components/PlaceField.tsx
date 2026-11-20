import { useEffect, useId, useRef, useState } from 'react';

import { ApiError, geocodePlace, searchPlaces } from '@/api/client';
import type { Place } from '@/api/schemas';
import type { SavedPlace } from '@/lib/storage';

type Props = {
  label: string;
  value: SavedPlace | null;
  onChange: (place: SavedPlace | null) => void;
  placeholder?: string;
};

/**
 * Pick a place: instant suggestions from the curated list (never Nominatim while typing), and an explicit
 * "Search the full map" button that makes exactly one geocoding request.
 * Phase W6 adds "Use my location" and "Pick on map" around this same component.
 */
export function PlaceField({ label, value, onChange, placeholder }: Props) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Keep the box in step when the saved value changes from outside (e.g. "Clear my data").
  useEffect(() => {
    setText(value?.label ?? '');
  }, [value?.label]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value?.label) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      searchPlaces(q, controller.signal)
        .then((r) => {
          setResults(r.results);
          setError('');
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(e instanceof ApiError ? e.message : "Can't search places right now.");
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [text, open, value?.label]);

  function choose(p: Place) {
    onChange({ label: p.name, lat: p.lat, lon: p.lon });
    setText(p.name);
    setOpen(false);
    setResults([]);
  }

  async function searchFullMap() {
    const q = text.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError('');
    try {
      const g = await geocodePlace(q);
      onChange({ label: q, lat: g.lat, lon: g.lon });
      setOpen(false);
      setResults([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Can't search the map right now.");
    } finally {
      setBusy(false);
    }
  }

  const listId = `${id}-list`;
  const showFullMap = text.trim().length >= 2 && text.trim() !== value?.label;
  return (
    <div className="rr-field">
      <label htmlFor={id}>{label}</label>
      <div className="rr-field-row">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={120}
          value={text}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value) onChange(null); // typing again un-sets the chosen place
          }}
        />
        {value && (
          <button type="button" className="rr-btn" onClick={() => { onChange(null); setText(''); }} aria-label={`Clear ${label}`}>
            Clear
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="rr-suggest" aria-label={`${label} suggestions`}>
          {results.map((p) => (
            <li key={p.place_id} role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(p)}>
                <span>{p.name}</span>
                <small>{p.category}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showFullMap && (
        <button type="button" className="rr-link" onClick={searchFullMap} disabled={busy}>
          {busy ? 'Searching the map…' : `Search the full map for “${text.trim()}”`}
        </button>
      )}
      {value && <small className="rr-muted">Saved: {value.lat.toFixed(4)}, {value.lon.toFixed(4)}</small>}
      {error && <small role="alert" className="rr-field-error">{error}</small>}
    </div>
  );
}
