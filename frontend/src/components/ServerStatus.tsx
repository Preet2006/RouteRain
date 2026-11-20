import { useQuery } from '@tanstack/react-query';

import { ApiError, getHealth } from '@/api/client';

const yesNo = (v: boolean) => (v ? '✓ Yes' : '✕ No');

/** Calls /api/v2/health. Colour is paired with a glyph and a word. */
export function ServerStatus() {
  const { data, error, isPending, refetch, isFetching } = useQuery({ queryKey: ['health'], queryFn: getHealth });

  if (isPending) {
    return (
      <div className="rr-card" aria-busy="true" aria-label="Checking server">
        <h2>Server</h2>
        <div className="rr-skeleton" style={{ width: '70%' }} />
        <div className="rr-skeleton" style={{ width: '45%' }} />
      </div>
    );
  }
  if (error || !data) {
    const message = error instanceof ApiError ? error.message : "Can't reach the RouteRain server.";
    return (
      <div className="rr-card">
        <h2>Server</h2>
        <p className="rr-status bad" role="alert">✕ {message}</p>
        <p className="rr-muted">Check that the backend is running, then try again.</p>
        <button className="rr-btn" onClick={() => refetch()} disabled={isFetching}>Retry</button>
      </div>
    );
  }
  return (
    <div className="rr-card">
      <h2>Server</h2>
      <p className={`rr-status ${data.ok ? 'ok' : 'wait'}`}>{data.ok ? '✓ Ready' : '! Not fully ready'}</p>
      <ul className="rr-rows">
        <li><span>Risk model</span><span>{yesNo(data.model_loaded)}</span></li>
        <li><span>Road network</span><span>{yesNo(data.graph_loaded)}</span></li>
        <li><span>AI narration</span><span>{yesNo(data.llm_available)}</span></li>
        <li><span>Places</span><span>{data.places.count} ({data.places.verified} verified)</span></li>
      </ul>
    </div>
  );
}
