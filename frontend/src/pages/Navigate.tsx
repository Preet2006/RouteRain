import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiError, getDirections, getRoute, narrate, type RouteLeg } from '@/api/client';
import type { Directions, RouteResponse } from '@/api/schemas';
import { useRrBody } from '@/components/Shell';
import { DriveController, type Hud } from '@/features/nav/driveController';
import { FallbackNavMap } from '@/features/nav/FallbackMap';
import { arrivalClock, formatDistance, formatKm, formatMinutes } from '@/features/nav/format';
import { ManeuverIcon } from '@/features/nav/ManeuverIcon';
import type { NavMapHandle } from '@/features/nav/mapTypes';
import { buildPrompts } from '@/features/nav/prompts';
import { SPEED_CHOICES } from '@/features/nav/simulation';
import { kmShort, minutesShort } from '@/features/route/format';
import { firstName } from '@/features/route/useAdvice';
import { replayDateLabel } from '@/lib/dates';
import { phrases, type NavLanguage } from '@/lib/navPhrases';
import { speech } from '@/lib/speech';
import { useHasHindi } from '@/lib/useHasHindi';
import { useProfile } from '@/lib/useProfile';
import { tierInfo } from '@/theme';

// MapLibre is large, so it is only fetched when a trip is started.
const NavigationMap = lazy(() => import('@/features/nav/NavigationMap').then((m) => ({ default: m.NavigationMap })));

/** How long Start waits for the AI-phrased summary (the route page has usually fetched it already). */
export const SUMMARY_WAIT_MS = 2500;

export function NavigationScreen() {
  useRrBody();
  const { routeId = '' } = useParams();
  const [params] = useSearchParams();
  const which: RouteLeg = params.get('which') === 'normal' ? 'normal' : 'flood_aware';
  const { profile } = useProfile();
  const hasHindi = useHasHindi();
  const wantsHindi = profile.language === 'hi';
  const languageKnown = !wantsHindi || hasHindi !== undefined;
  const language: NavLanguage = wantsHindi && hasHindi ? 'hi' : 'en';

  const route = useQuery({ queryKey: ['route', routeId], queryFn: () => getRoute(routeId), retry: false, staleTime: Infinity });
  const directions = useQuery({
    queryKey: ['directions', routeId, which],
    queryFn: () => getDirections(routeId, which),
    retry: false,
    staleTime: Infinity,
  });
  // Same key as the advice on the route page, so this is normally already cached.
  const narration = useQuery({
    queryKey: ['narrate', route.data?.route_id, language, firstName(profile.name)],
    queryFn: () => narrate({ route_id: route.data!.route_id, user_name: firstName(profile.name) || null, language }),
    enabled: !!route.data && languageKnown && which === 'flood_aware',
    staleTime: Infinity,
    retry: false,
  });
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), SUMMARY_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const summaryReady = which === 'normal' || narration.isSuccess || narration.isError || waited;

  const failure = route.error ?? directions.error;
  if (failure || (!route.isPending && !route.data)) {
    return (
      <div className="rr-drive rr-drive-message">
        <div className="rr-error" role="alert">
          <b>{failure instanceof ApiError ? failure.message : "Can't reach the RouteRain server."}</b>
          <p><Link to="/plan">Plan it again</Link></p>
        </div>
      </div>
    );
  }
  if (!route.data || !directions.data || !languageKnown || !summaryReady) {
    return (
      <div className="rr-drive rr-drive-message" aria-busy="true">
        <h1>Getting your directions…</h1>
        <p className="rr-muted">Preparing turn-by-turn guidance for this route.</p>
      </div>
    );
  }

  const summary =
    which === 'flood_aware' && narration.data && narration.data.language === language
      ? narration.data.text
      : which === 'flood_aware' && language === 'en'
        ? route.data.template_advice
        : '';
  return <DriveScreen route={route.data} directions={directions.data} which={which} language={language} summary={summary} />;
}

type ScreenProps = { route: RouteResponse; directions: Directions; which: RouteLeg; language: NavLanguage; summary: string };

function DriveScreen({ route, directions, which, language, summary: liveSummary }: ScreenProps) {
  const navigate = useNavigate();
  const [summary] = useState(liveSummary); // frozen: a summary that arrives later must not restart the trip
  const { profile, store } = useProfile();
  const mapRef = useRef<NavMapHandle>(null);
  const controller = useRef<DriveController | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [muted, setMuted] = useState(!profile.voiceOn);
  const [multiplier, setMultiplier] = useState<number>(5);
  const [dragged, setDragged] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [arrived, setArrived] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);

  // The bottom bar's height (it wraps on a phone) is published as --rr-bar-h so the map credits and the floating
  // messages always sit just above it.
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const set = () => root.style.setProperty('--rr-bar-h', `${bar.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const say = useMemo(() => phrases(language), [language]);
  const leg = which === 'normal' ? route.normal_route : route.flood_aware_route;
  const destinationName = route.destination.label || '';
  const replay = route.scenario.mode === 'replay' && route.scenario.date ? route.scenario.date : null;

  useEffect(() => {
    const first = directions.steps[0];
    const startText = [which === 'normal' ? say.preview : summary, say.depart(first)].filter(Boolean).join(' ');
    const ctl = new DriveController(
      {
        directions,
        language,
        destinationName,
        startText,
        multiplier: 5,
        muted: mutedRef.current,
        speak: (text, lang) => speech.speakResult(text, lang),
        stopSpeech: () => speech.stop(),
        onFrame: (f) => mapRef.current?.update(f, performance.now()),
        onHud: setHud,
        onVoiceBlocked: () => setVoiceBlocked(true),
        onArrive: () => {
          setArrived(true);
          store.addRecentTrip(
            { label: route.origin.label || 'Start', lat: route.origin.lat, lon: route.origin.lon },
            { label: route.destination.label || 'Destination', lat: route.destination.lat, lon: route.destination.lon },
          );
        },
      },
      buildPrompts(directions, { language, destinationName, startText }),
    );
    controller.current = ctl;
    ctl.start();
    return () => {
      ctl.stop(); // leaving the page stops the car and any speech
      controller.current = null;
    };
  }, [directions, language, which, summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const endTrip = useCallback(() => {
    controller.current?.stop();
    navigate(`/route/${route.route_id}`);
  }, [navigate, route.route_id]);

  const togglePause = () => {
    const c = controller.current;
    if (!c) return;
    if (c.sim.paused) c.resume();
    else c.pause();
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    controller.current?.setMuted(next);
  };
  const pick = (m: number) => {
    setMultiplier(m);
    controller.current?.setMultiplier(m);
  };
  const enableVoice = () => {
    setVoiceBlocked(false);
    setMuted(false);
    controller.current?.setMuted(false);
    void speech.speakResult(say.depart(directions.steps[0]), language);
  };
  const recenter = () => {
    mapRef.current?.recenter();
    setDragged(false);
  };

  const mapProps = { route, directions, onDragged: () => setDragged(true) };
  const next = hud?.next ?? directions.steps[1] ?? directions.steps[0];
  const alertText = hud?.alert ? say.hotspot(hud.alert) : null;

  return (
    <div className="rr-drive" data-testid="nav-screen" ref={rootRef}>
      <div className="rr-drive-map">
        {fallback ? (
          <FallbackNavMap ref={mapRef} {...mapProps} />
        ) : (
          <Suspense fallback={<div className="rr-drive-canvas rr-drive-loading" aria-busy="true">Loading the map…</div>}>
            <NavigationMap ref={mapRef} {...mapProps} onFailed={setFallback} />
          </Suspense>
        )}
      </div>

      <section className="rr-drive-banner" aria-label="Next manoeuvre" data-testid="nav-banner">
        <ManeuverIcon step={next} size={64} />
        <div className="rr-drive-banner-text">
          <p className="rr-drive-dist" data-testid="nav-distance">{hud ? formatDistance(hud.distanceToNextM) : ''}</p>
          <p className="rr-drive-street" data-testid="nav-instruction">
            {next.maneuver === 'arrive' ? `Arrive at ${destinationName || 'your destination'}` : next.instruction_en}
          </p>
          {hud?.then && <p className="rr-drive-then" data-testid="nav-then">Then {hud.then.instruction_en.charAt(0).toLowerCase() + hud.then.instruction_en.slice(1)}</p>}
        </div>
      </section>

      <div className="rr-drive-badges">
        <span className="rr-drive-badge sim">Simulated drive</span>
        {hud?.starting && <span className="rr-drive-badge" data-testid="nav-starting">Starting your trip…</span>}
        {which === 'normal' && <span className="rr-drive-badge">Preview: usual route</span>}
        {replay && <span className="rr-drive-badge replay">Replay: {replayDateLabel(replay)} weather</span>}
      </div>

      {fallback && (
        <p className="rr-drive-notice" role="status" data-testid="nav-fallback-notice">
          The 3D map could not load, so you are seeing the simple north-up map. Directions work the same.
        </p>
      )}

      {hud?.alert && alertText && (
        <div className={`rr-drive-alert ${hud.alert.tier}`} role="status" data-testid="nav-alert">
          <span className={`rr-tier ${hud.alert.tier}`}><span aria-hidden="true">{tierInfo(hud.alert.tier).glyph}</span> {tierInfo(hud.alert.tier).word}</span> {alertText}
        </div>
      )}

      {voiceBlocked && (
        <button type="button" className="rr-btn primary rr-drive-voice" onClick={enableVoice}>Tap to enable voice</button>
      )}
      {dragged && !arrived && (
        <button type="button" className="rr-btn rr-drive-recenter" onClick={recenter}>Re-centre</button>
      )}

      <footer className="rr-drive-bar" aria-label="Trip controls" ref={barRef}>
        <dl className="rr-drive-stats">
          <div><dt>Arrive</dt><dd data-testid="nav-eta">{hud ? arrivalClock(new Date(), hud.remainingS) : '–'}</dd></div>
          <div><dt>Left</dt><dd data-testid="nav-minutes">{hud ? formatMinutes(hud.remainingS) : '–'}</dd></div>
          <div><dt>Distance</dt><dd data-testid="nav-km">{hud ? formatKm(hud.remainingM) : '–'}</dd></div>
        </dl>
        <div className="rr-drive-controls">
          <div className="rr-drive-seg" role="group" aria-label="Simulation speed">
            {SPEED_CHOICES.map((m) => (
              <button key={m} type="button" aria-pressed={multiplier === m} onClick={() => pick(m)}>{m}×</button>
            ))}
          </div>
          <button type="button" className="rr-btn" onClick={togglePause} aria-pressed={!!hud?.paused} disabled={arrived}>
            {hud?.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="rr-btn" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" className="rr-btn danger" onClick={endTrip}>End trip</button>
        </div>
      </footer>

      {arrived && (
        <div className="rr-drive-arrival" role="dialog" aria-modal="true" aria-labelledby="arrived-h" data-testid="nav-arrival">
          <div className="rr-card">
            <h1 id="arrived-h">You have arrived</h1>
            <p className="rr-muted">{route.origin.label || 'Start'} → {destinationName || 'Destination'}</p>
            <dl className="rr-arrival-stats">
              <div><dt>Trip time</dt><dd data-testid="arrival-time">{minutesShort(leg.drive_time_min)}</dd></div>
              <div><dt>Distance</dt><dd data-testid="arrival-km">{kmShort(leg.distance_km)}</dd></div>
              <div>
                <dt>Hotspots avoided</dt>
                <dd data-testid="arrival-avoided">{which === 'normal' || route.avoided_hotspots.length === 0 ? 'None' : route.avoided_hotspots.map((h) => h.name).join(', ')}</dd>
              </div>
            </dl>
            <p className="rr-muted rr-fine">
              This was a simulated drive{replay ? ` using ${replayDateLabel(replay)} weather` : ''}. Times are free-flow estimates without traffic.
            </p>
            <div className="rr-actions">
              <Link to="/plan" className="rr-btn primary">Plan another trip</Link>
              <Link to={`/route/${route.route_id}`} className="rr-btn">Back to the route</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
