import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError, createRoute } from '@/api/client';
import { PlaceField } from '@/components/PlaceField';
import { PickMap, type PickTarget } from '@/features/plan/PickMap';
import { pinnedLabel } from '@/lib/geolocation';
import { useScenario } from '@/lib/scenario';
import type { SavedPlace } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';

import { replayDateLabel } from './Home';

const same = (a: SavedPlace | null, b: SavedPlace | null) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;

/** Home, Work and places from recent trips, without duplicates. */
export function quickPlaces(profile: ReturnType<typeof useProfile>['profile']): { label: string; place: SavedPlace }[] {
  const out: { label: string; place: SavedPlace }[] = [];
  const add = (label: string, place: SavedPlace | null) => {
    if (place && !out.some((o) => same(o.place, place))) out.push({ label, place });
  };
  add('Home', profile.home);
  add('Work', profile.work);
  profile.recentTrips.forEach((t) => {
    add(t.destination.label, t.destination);
    add(t.origin.label, t.origin);
  });
  return out.slice(0, 7);
}

export function Plan() {
  const { profile } = useProfile();
  const { scenario } = useScenario();
  const navigate = useNavigate();
  const location = useLocation();
  const [from, setFrom] = useState<SavedPlace | null>(null);
  const [to, setTo] = useState<SavedPlace | null>((location.state as { destination?: SavedPlace } | null)?.destination ?? null);
  const [picking, setPicking] = useState<PickTarget>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const quick = useMemo(() => quickPlaces(profile), [profile]);

  // A route is always planned for the weather on screen: stop picking and clear old errors when it changes.
  useEffect(() => setError(''), [from, to, scenario.mode, scenario.date]);

  function pick(lat: number, lon: number) {
    const place = { label: pinnedLabel(lat, lon), lat, lon };
    if (picking === 'from') setFrom(place);
    if (picking === 'to') setTo(place);
    setPicking(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!from || !to) return;
    if (same(from, to)) {
      setError('Pickup and drop are the same place. Choose two different places.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const route = await createRoute({
        origin: { lat: from.lat, lon: from.lon, label: from.label },
        destination: { lat: to.lat, lon: to.lon, label: to.label },
        caution: profile.caution,
        mode: scenario.mode,
        date: scenario.date,
      });
      navigate(`/route/${route.route_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong while planning the route.');
    } finally {
      setBusy(false);
    }
  }

  const chips = (setter: (p: SavedPlace) => void, current: SavedPlace | null, label: string) =>
    quick.length > 0 && (
      <div className="rr-chips" role="group" aria-label={`Saved places for ${label}`}>
        {quick.map((q) => (
          <button key={q.label + q.place.lat} type="button" className="rr-chip" aria-pressed={same(current, q.place)} onClick={() => setter(q.place)}>
            {q.label}
          </button>
        ))}
      </div>
    );

  return (
    <div className="rr-plan">
      <form onSubmit={submit} className="rr-plan-form" aria-label="Plan a trip" noValidate>
        <h1>Plan a trip</h1>
        <p className={scenario.mode === 'replay' ? 'rr-banner' : 'rr-muted'} role="status">
          {scenario.mode === 'replay' ? (
            <>
              <b>Replay: {replayDateLabel(scenario.date)} weather.</b> This route is planned for that past day, not today.
            </>
          ) : (
            'Using today’s live forecast.'
          )}{' '}
          <Link to="/">Change</Link>
        </p>

        <PlaceField
          label="From"
          value={from}
          onChange={setFrom}
          placeholder="e.g. Sector 29 or Cyber Hub"
          allowLocation
          picking={picking === 'from'}
          onTogglePick={() => setPicking(picking === 'from' ? null : 'from')}
        />
        {chips(setFrom, from, 'From')}

        <div className="rr-swap">
          <button
            type="button"
            className="rr-btn"
            aria-label="Swap From and To"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}>
            <span aria-hidden="true">⇅</span> Swap
          </button>
        </div>

        <PlaceField
          label="To"
          value={to}
          onChange={setTo}
          placeholder="e.g. Medanta or Golf Course Road"
          allowLocation
          picking={picking === 'to'}
          onTogglePick={() => setPicking(picking === 'to' ? null : 'to')}
        />
        {chips(setTo, to, 'To')}

        {error && (
          <div className="rr-error" role="alert">
            <b>{error}</b>
          </div>
        )}
        <button className="rr-btn primary rr-find" type="submit" disabled={!from || !to || busy}>
          {busy ? 'Finding routes…' : 'Find routes'}
        </button>
        {(!from || !to) && <p className="rr-muted">Choose both a pickup and a drop to continue.</p>}
      </form>

      <PickMap from={from} to={to} picking={picking} onPick={pick} />
    </div>
  );
}
