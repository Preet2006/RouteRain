import { Link, Navigate } from 'react-router-dom';

import { ServerStatus } from '@/components/ServerStatus';
import { greeting } from '@/lib/storage';
import { useProfile } from '@/lib/useProfile';

/** Placeholder: the real map, hotspot panel and scenario switch are built in phase W5. */
export function Home() {
  const { profile } = useProfile();
  if (!profile.onboarded) return <Navigate to="/welcome" replace />;
  return (
    <>
      <h1>{greeting(profile.name)}</h1>
      <p className="rr-muted">The map and hotspot panel arrive in a later phase. The foundations are live:</p>
      <div className="rr-grid">
        <ServerStatus />
        <div className="rr-card">
          <h2>Where to?</h2>
          <p>Trip planning is built in phase W6.</p>
          <Link to="/plan" className="rr-btn primary">Plan a trip</Link>
        </div>
        <div className="rr-card">
          <h2>Original dashboard</h2>
          <p>The current dashboard stays available until the new Home replaces it.</p>
          <Link to="/legacy" className="rr-btn">Open dashboard</Link>
        </div>
      </div>
    </>
  );
}
