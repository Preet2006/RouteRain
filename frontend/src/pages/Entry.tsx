import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Logo } from '@/components/Logo';
import { useRrBody } from '@/components/Shell';
import { useProfile } from '@/lib/useProfile';

/**
 * The entry screen (route "/"): the app's name in the centre, the tagline and one big Enter button.
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
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 5.7 + 3) % 100}%`, animationDelay: `${(i % 9) * 0.35}s`, animationDuration: `${2.4 + (i % 5) * 0.5}s` }} />
        ))}
      </div>
      <div className="rr-entry-body">
        <Logo size={88} />
        <h1 className="rr-entry-name">Route<b>Rain</b></h1>
        <p className="rr-entry-tag">Know before you go: flood-aware routes for Gurugram</p>
        {name && <p className="rr-entry-back">Welcome back, {name}</p>}
        <button type="button" className="rr-btn primary rr-entry-btn" onClick={enter} autoFocus>
          Enter
        </button>
      </div>
      <footer className="rr-entry-foot">
        <span>Group 6 · MDI Gurgaon</span>
        <Link to="/about">A guide, not a guarantee</Link>
      </footer>
    </main>
  );
}
