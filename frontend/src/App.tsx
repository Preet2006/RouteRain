import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { BareLayout, Shell } from '@/components/Shell';
import { Home } from '@/pages/Home';
import { About, NotFound, Plan, RouteResult, Settings } from '@/pages/Placeholders';
import { Setup } from '@/pages/Setup';
import { Welcome } from '@/pages/Welcome';

// The original dashboard stays reachable at /legacy until phase W5 replaces it. It is loaded lazily so its
// global stylesheet and the whole map bundle only load when someone opens that page.
const LegacyApp = lazy(() => import('@/legacy/LegacyApp'));

export function App() {
  return (
    <Routes>
      <Route element={<BareLayout />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/setup" element={<Setup />} />
      </Route>
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/route/:routeId" element={<RouteResult />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route
        path="/legacy"
        element={
          <Suspense fallback={<p style={{ color: '#8593a0', padding: 24 }}>Loading dashboard…</p>}>
            <LegacyApp />
          </Suspense>
        }
      />
    </Routes>
  );
}
