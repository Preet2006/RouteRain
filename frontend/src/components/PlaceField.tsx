import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { ApiError, geocodePlace, searchPlaces } from '@/api/client';
import type { Place } from '@/api/schemas';
import { LocateError, locate, pinnedLabel } from '@/lib/geolocation';
import type { SavedPlace } from '@/lib/storage';

type Props = {
  label: string;
  value: SavedPlace | null;
  onChange: (place: SavedPlace | null) => void;
  placeholder?: string;
  /** Show a "Use my location" button (trip planning). */
  allowLocation?: boolean;
  /** Show a "Pick on map" toggle; the parent owns the map. */
  onTogglePick?: () => void;
  picking?: boolean;
  /** Called with true while text has been typed but no place has been chosen (so the form can refuse to save). */
  onPendingChange?: (pending: boolean) => void;
  /** An error message to show under the field. */
  error?: string;
};

/**
 * Pick a place:
 *  - instant suggestions from the curated list while typing (never Nominatim), with arrow keys / Enter / Escape,
 *  - an explicit "Search the full map" button that makes exactly one geocoding request,
 *  - optional "Use my location" and "Pick on map".
 */
export function PlaceField({ label, value, onChange, placeholder, allowLocation, onTogglePick, picking, onPendingChange, error: fieldError }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState<'map' | 'locate' | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Keep the box in step when the value changes from outside (swap, chips, map click, "Clear my data").
  useEffect(() => {
    setText(value?.label ?? '');
  }, [value?.label]);

  useEffect(() => {
    onPendingChange?.(text.trim() !== '' && value === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value?.label) {
      setResults([]);
      setActive(-1);
      return;
    }
    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      searchPlaces(q, controller.signal)
        .then((r) => {
          setResults(r.results);
          setActive(-1);
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
    setActive(-1);
    setError('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const listOpen = open && results.length > 0;
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && listOpen) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (listOpen && active >= 0) {
        e.preventDefault(); // choosing a suggestion must not submit the surrounding form
        choose(results[active]);
      } else if (listOpen && results.length === 1) {
        e.preventDefault();
        choose(results[0]);
      }
    } else if (e.key === 'Escape' && listOpen) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  async function searchFullMap() {
    const q = text.trim();
    if (q.length < 2) return;
    setBusy('map');
    setError('');
    try {
      const g = await geocodePlace(q);
      onChange({ label: q, lat: g.lat, lon: g.lon });
      setOpen(false);
      setResults([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Can't search the map right now.");
    } finally {
      setBusy(null);
    }
  }

  async function useMyLocation() {
    setBusy('locate');
    setError('');
    try {
      const p = await locate();
      onChange({ label: pinnedLabel(p.lat, p.lon, 'My location'), lat: p.lat, lon: p.lon });
      setOpen(false);
      setResults([]);
    } catch (e) {
      setError(e instanceof LocateError ? e.message : "Couldn't get your location.");
    } finally {
      setBusy(null);
    }
  }

  const showFullMap = text.trim().length >= 2 && text.trim() !== value?.label;
  const listVisible = open && results.length > 0;
  return (
    <div className="rr-field">
      <label htmlFor={id}>{label}</label>
      <div className="rr-field-row">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listVisible && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          maxLength={120}
          value={text}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
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

      {listVisible && (
        <ul id={listId} role="listbox" className="rr-suggest" aria-label={`${label} suggestions`}>
          {results.map((p, i) => (
            <li
              key={p.place_id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                choose(p);
              }}>
              <span>{p.name}</span>
              <small>{p.category}</small>
            </li>
          ))}
        </ul>
      )}

      {(allowLocation || onTogglePick || showFullMap) && (
        <div className="rr-field-actions">
          {allowLocation && (
            <button type="button" className="rr-link" onClick={useMyLocation} disabled={busy !== null}>
              {busy === 'locate' ? 'Finding your location…' : 'Use my location'}
            </button>
          )}
          {onTogglePick && (
            <button type="button" className="rr-link" onClick={onTogglePick} aria-pressed={!!picking}>
              {picking ? 'Cancel picking' : 'Pick on map'}
            </button>
          )}
          {showFullMap && (
            <button type="button" className="rr-link" onClick={searchFullMap} disabled={busy !== null}>
              {busy === 'map' ? 'Searching the map…' : `Search the full map for “${text.trim()}”`}
            </button>
          )}
        </div>
      )}
      {value && <small className="rr-muted">Saved: {value.lat.toFixed(4)}, {value.lon.toFixed(4)}</small>}
      {error && <small role="alert" className="rr-field-error">{error}</small>}
      {fieldError && <small role="alert" className="rr-field-error">{fieldError}</small>}
    </div>
  );
}
