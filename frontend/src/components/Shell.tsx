import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { useStopSpeechOnNavigate } from '@/lib/useStopSpeechOnNavigate';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/plan', label: 'Plan a trip', end: false },
  { to: '/settings', label: 'Settings', end: false },
  { to: '/about', label: 'About', end: false },
];

/** Marks <body> so base.css only styles the new pages (the legacy dashboard has its own styles). */
export function useRrBody() {
  useEffect(() => {
    document.body.classList.add('rr');
    return () => document.body.classList.remove('rr');
  }, []);
}

export function Shell() {
  useRrBody();
  useStopSpeechOnNavigate();
  return (
    <div className="rr-shell">
      <a className="rr-skip" href="#main">Skip to content</a>
      <header className="rr-header">
        <Link to="/" className="rr-brand">Route<b>Rain</b></Link>
        <nav className="rr-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
          ))}
        </nav>
      </header>
      <main id="main" className="rr-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="rr-footer">
        <span>A guide, not a guarantee.</span>
        <span>RouteRain · Gurugram</span>
      </footer>
    </div>
  );
}

/** Layout for the first-run pages (welcome, setup): no navigation, just the content. */
export function BareLayout() {
  useRrBody();
  useStopSpeechOnNavigate();
  return <Outlet />;
}
