import { Link, Navigate } from 'react-router-dom';

import { useProfile } from '@/lib/useProfile';

export function Welcome() {
  const { profile } = useProfile();
  if (profile.onboarded) return <Navigate to="/" replace />;
  return (
    <div className="rr-hero">
      <div>
        <h1>Know before you go: flood-aware routes for Gurugram</h1>
        <p>RouteRain scores waterlogging risk at 12 known hotspots and plans a route around the ones at risk.</p>
        <Link to="/setup" className="rr-btn primary">Get started</Link>
        <p className="rr-muted" style={{ marginTop: 16, fontSize: 14 }}>A guide, not a guarantee.</p>
      </div>
    </div>
  );
}
