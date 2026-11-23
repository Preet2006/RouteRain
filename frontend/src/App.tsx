import { Route, Routes } from 'react-router-dom';

import { BareLayout, Shell } from '@/components/Shell';
import { Home } from '@/pages/Home';
import { About } from '@/pages/About';
import { NotFound } from '@/pages/Placeholders';
import { Plan } from '@/pages/Plan';
import { Ready } from '@/pages/Ready';
import { RouteResult } from '@/pages/RouteResult';
import { Settings } from '@/pages/Settings';
import { Setup } from '@/pages/Setup';
import { Welcome } from '@/pages/Welcome';

export function App() {
  return (
    <Routes>
      <Route element={<BareLayout />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/ready" element={<Ready />} />
      </Route>
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/route/:routeId" element={<RouteResult />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
