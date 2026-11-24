import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Logo } from '@/components/Logo';
import { useRrBody } from '@/components/Shell';
import { useProfile } from '@/lib/useProfile';

const POINTS = ['12 monitored hotspots', 'Risk explained in plain words', 'Flood-aware route advice'];

/**
 * The entry screen (route "/"): the app's name in the centre, the tagline and one Enter button.
 * First-time visitors go on to setup, returning visitors straight to trip planning.
 */
export function Entry() {
  useRrBody();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const enter = () => navigate(profile.onboarded ? '/plan' : '/setup');
  const name = profile.onboarded ? profile.name.trim() : '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="rr-entry" id="main" aria-label="RouteRain">
      <div className="rr-rain" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 7.1 + 3) % 100}%`, animationDelay: `${(i % 9) * 0.45}s`, animationDuration: `${3 + (i % 5) * 0.6}s` }} />
        ))}
      </div>
      <div className="rr-entry-body">
        <Logo size={64} />
        <p className="rr-entry-eyebrow">Monsoon intelligence · Gurugram</p>
        <h1 className="rr-entry-name">Route<b>Rain</b></h1>
        <span className="rr-entry-rule" aria-hidden="true" />
        <p className="rr-entry-tag">Know before you go: flood-aware routes for Gurugram</p>
        <ul className="rr-entry-points" aria-label="What RouteRain does">
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {name && <p className="rr-entry-back">Welcome back, {name}</p>}
        <button type="button" className="rr-btn primary rr-entry-btn" onClick={enter} autoFocus>
          Enter <span aria-hidden="true">→</span>
        </button>
      </div>
    </main>
  );
}
