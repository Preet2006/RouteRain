import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { profileStore } from '@/lib/storage';

const KEY = 'routerain.splash';
export const SPLASH_MS = 2400;

function seen(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    /* blocked storage: the splash simply shows again next load */
  }
}

/** The RouteRain mark: a raindrop with a route running through it. */
export function Logo({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="RouteRain logo" className="rr-logo">
      <path d="M32 4C32 4 12 26 12 40a20 20 0 0 0 40 0C52 26 32 4 32 4Z" fill="#5ed6ff" />
      <path d="M22 44c6 0 6-10 12-10s5 8 10 8" fill="none" stroke="#06101a" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 6.5" />
      <circle cx="22" cy="44" r="3.6" fill="#06101a" />
      <circle cx="44" cy="42" r="3.6" fill="#fff" stroke="#06101a" strokeWidth="2" />
    </svg>
  );
}

/** Full-screen entry screen with the app's name. Shown once per browser session; any key, click or tap skips it. */
export function SplashGate({ children }: { children: ReactNode }) {
  const [done, setDone] = useState(seen);
  const finish = useCallback(() => {
    markSeen();
    setDone(true);
  }, []);

  useEffect(() => {
    if (done) return;
    document.body.classList.add('rr');
    const timer = setTimeout(finish, SPLASH_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [done, finish]);

  if (done) return <>{children}</>;
  const returning = profileStore.get().onboarded ? profileStore.get().name.trim() : '';
  return (
    <main className="rr-splash" aria-label="RouteRain" onClick={finish}>
      <div className="rr-rain" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 7.3 + 4) % 100}%`, animationDelay: `${(i % 7) * 0.22}s`, animationDuration: `${1.5 + (i % 4) * 0.3}s` }} />
        ))}
      </div>
      <div className="rr-splash-body">
        <Logo />
        <h1 className="rr-wordmark">Route<b>Rain</b></h1>
        <p className="rr-splash-tag">Know before you go.</p>
        <p className="rr-splash-sub">Flood-aware routes for Gurugram</p>
        {returning && <p className="rr-splash-back">Welcome back, {returning}</p>}
        <button type="button" className="rr-btn primary rr-splash-btn" onClick={finish} autoFocus>
          Enter
        </button>
        <p className="rr-splash-hint">Press Enter or tap anywhere to continue</p>
      </div>
    </main>
  );
}
