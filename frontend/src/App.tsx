import { Navigate, Route, Routes } from 'react-router-dom';

import { BareLayout, Shell } from '@/components/Shell';
import { Entry } from '@/pages/Entry';
import { HotspotDetail } from '@/pages/HotspotDetail';
import { Hotspots } from '@/pages/Hotspots';
import { About } from '@/pages/About';
import { NotFound } from '@/pages/Placeholders';
import { Plan } from '@/pages/Plan';
import { Ready } from '@/pages/Ready';
import { RouteResult } from '@/pages/RouteResult';
import { Settings } from '@/pages/Settings';
import { Setup } from '@/pages/Setup';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Entry />} />
      <Route path="/welcome" element={<Navigate to="/setup" replace />} />
      <Route element={<BareLayout />}>
        <Route path="/setup" element={<Setup />} />
        <Route path="/ready" element={<Ready />} />
      </Route>
      <Route element={<Shell />}>
        <Route path="/hotspots" element={<Hotspots />} />
        <Route path="/hotspots/:id" element={<HotspotDetail />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/route/:routeId" element={<RouteResult />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
