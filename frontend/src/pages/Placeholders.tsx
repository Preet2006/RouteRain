import { Link, useParams } from 'react-router-dom';

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

export function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p><Link to="/">Back to Home</Link></p>
    </>
  );
}
