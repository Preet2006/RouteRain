import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ApiError, getRoute } from '@/api/client';

/** Interim result page: loads the cached route and shows the advice sentence. The full page is phase W7. */
export function RouteResult() {
  const { routeId = '' } = useParams();
  const { data, error, isPending } = useQuery({ queryKey: ['route', routeId], queryFn: () => getRoute(routeId), retry: false });
  return (
    <>
      <h1>Route result</h1>
      {isPending && <div className="rr-skeleton" aria-busy="true" style={{ width: '60%' }} />}
      {error && (
        <div className="rr-error" role="alert">
          <b>{error instanceof ApiError ? error.message : 'The route could not be loaded.'}</b>
          <p><Link to="/plan">Plan it again</Link></p>
        </div>
      )}
      {data && (
        <div className="rr-card">
          <p><b>{data.template_advice}</b></p>
          <p className="rr-muted">The map, comparison card and spoken advice arrive in phase W7.</p>
        </div>
      )}
    </>
  );
}
