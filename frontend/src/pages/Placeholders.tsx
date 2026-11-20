import { Link, useParams } from 'react-router-dom';

import { useProfile } from '@/lib/useProfile';

export function Plan() {
  return (
    <>
      <h1>Plan a trip</h1>
      <p className="rr-muted">Pickup and drop selection arrives in phase W6.</p>
    </>
  );
}

export function RouteResult() {
  const { routeId } = useParams();
  return (
    <>
      <h1>Route result</h1>
      <p className="rr-muted">Route <code>{routeId}</code> will be shown here in phase W7.</p>
    </>
  );
}

export function Settings() {
  const { profile, store, persistent } = useProfile();
  return (
    <>
      <h1>Settings</h1>
      <div className="rr-card">
        <h2>Your data</h2>
        <p className="rr-muted">
          {persistent
            ? 'Your name, saved places and preferences are kept on this device only.'
            : 'This browser is blocking storage, so your settings only last until you close the tab.'}
        </p>
        <p>Signed in as: {profile.name || '(no name set)'}</p>
        <button className="rr-btn" onClick={() => store.clear()}>Clear my data</button>
      </div>
      <p className="rr-muted">The full settings page arrives in phase W4.</p>
    </>
  );
}

export function About() {
  return (
    <>
      <h1>About RouteRain</h1>
      <p className="rr-muted">Limitations, data sources and the flood-delay assumption are written up in a later phase.</p>
      <p><b>A guide, not a guarantee.</b></p>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p><Link to="/">Back to Home</Link></p>
    </>
  );
}
