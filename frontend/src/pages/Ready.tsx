import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Logo } from '@/components/Splash';
import { useProfile } from '@/lib/useProfile';

/** Shown right after setup: "Welcome, <name>", what was saved, and one button into the app. */
export function Ready() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const enter = () => navigate('/', { replace: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile.onboarded) return <Navigate to="/welcome" replace />;
  const name = profile.name.trim();
  const saved = [
    profile.home ? `Home: ${profile.home.label}` : null,
    profile.work ? `Work: ${profile.work.label}` : null,
    `Voice advice: ${profile.voiceOn ? (profile.language === 'hi' ? 'on, Hindi' : 'on, English') : 'off'}`,
    `Caution: ${profile.caution === 'cautious' ? 'Cautious (avoid RED and YELLOW)' : 'Balanced (avoid RED only)'}`,
  ].filter((x): x is string => x !== null);

  return (
    <div className="rr-hero rr-ready">
      <div>
        <Logo size={72} />
        <h1 data-testid="welcome-name">{name ? `Welcome, ${name}` : 'Welcome'}</h1>
        <p className="rr-ready-sub">You&apos;re all set. RouteRain will use these:</p>
        <ul className="rr-ready-list" aria-label="Your settings">
          {saved.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <button type="button" className="rr-btn primary" onClick={enter} autoFocus>
          Enter RouteRain
        </button>
        <p className="rr-muted rr-ready-hint">You can change any of this later in Settings.</p>
      </div>
    </div>
  );
}
