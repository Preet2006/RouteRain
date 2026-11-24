import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { ScenarioSwitch } from '@/components/ScenarioSwitch';
import { greeting } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';
import { useStopSpeechOnNavigate } from '@/lib/useStopSpeechOnNavigate';

const NAV = [
  { to: '/plan', label: 'Plan trip' },
  { to: '/hotspots', label: 'Hotspots' },
  { to: '/settings', label: 'Settings' },
  { to: '/about', label: 'About' },
];

/** Marks <body> so base.css styles apply to the app pages. */
export function useRrBody() {
  useEffect(() => {
    document.body.classList.add('rr');
    return () => document.body.classList.remove('rr');
  }, []);
}

/**
 * The full-screen app shell: a slim top bar (wordmark, tabs, Live/Replay selector, greeting) on desktop that becomes
 * a bottom tab bar under 768 px, and a content area that fills everything else. Pages decide how to use the area.
 */
export function Shell() {
  useRrBody();
  useStopSpeechOnNavigate();
  const { profile } = useProfile();
  return (
    <div className="rr-shell">
      <a className="rr-skip" href="#main">Skip to content</a>
      <header className="rr-header">
        <Link to="/" className="rr-brand" aria-label="RouteRain, back to the start screen">Route<b>Rain</b></Link>
        <nav className="rr-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
          ))}
        </nav>
        <div className="rr-header-tools">
          <ScenarioSwitch />
          <span className="rr-greeting">{greeting(profile.name)}</span>
        </div>
      </header>
      <main id="main" className="rr-main" tabIndex={0}>
        <Outlet />
      </main>
    </div>
  );
}

/** Layout for the first-run pages (setup, welcome): no navigation, just the content. */
export function BareLayout() {
  useRrBody();
  useStopSpeechOnNavigate();
  return (
    <main id="main">
      <Outlet />
    </main>
  );
}
