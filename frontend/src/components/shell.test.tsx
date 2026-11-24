// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  getScenarios: vi.fn().mockResolvedValue({
    default_mode: 'live',
    scenarios: [{ date: '2026-08-07', label: '7 August 2026' }, { date: '2026-07-08', label: '8 July 2026' }],
  }),
}));

import { Shell } from '@/components/Shell';
import { ScenarioProvider, useScenario } from '@/lib/scenario';
import { profileStore } from '@/lib/storage';

function Show() {
  const { scenario } = useScenario();
  return <div data-testid="scenario">{scenario.mode === 'live' ? 'live' : scenario.date}</div>;
}
function renderShell(path = '/plan', initial?: import('@/lib/scenario').ScenarioChoice) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ScenarioProvider initial={initial}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/plan" element={<div>plan page <Show /></div>} />
              <Route path="/hotspots" element={<div>hotspots page</div>} />
            </Route>
            <Route path="/" element={<div>entry</div>} />
          </Routes>
        </ScenarioProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  profileStore.reload();
  profileStore.update({ onboarded: true, name: 'Tanish' });
});
afterEach(cleanup);

describe('full-screen shell', () => {
  it('has the four tabs, the wordmark, the weather selector and the greeting in the top bar', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Plan trip', 'Hotspots', 'Settings', 'About']);
    expect(within(nav).getByRole('link', { name: 'Plan trip' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Hotspots' }).getAttribute('aria-current')).toBeNull();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: /routerain, back to the start screen/i }).getAttribute('href')).toBe('/');
    expect(within(header).getByLabelText('Weather to show')).toBeTruthy();
    expect(header.textContent).toMatch(/Good (morning|afternoon|evening), Tanish/);
  });

  it('has one main landmark with a skip link, and no boxed container or footer', () => {
    const { container } = renderShell();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(container.querySelector('a.rr-skip')!.getAttribute('href')).toBe('#main');
    expect(container.querySelector('footer')).toBeNull();
    expect(container.querySelector('.rr-main')).toBeTruthy();
  });

  it('switches tabs', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('link', { name: 'Hotspots' }));
    expect(screen.getByText('hotspots page')).toBeTruthy();
  });
});

describe('Live / Replay selector in the top bar', () => {
  it('lists Live plus every replay day, and starts on Live', async () => {
    renderShell();
    const select = (await screen.findByLabelText('Weather to show')) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Replay: 7 August 2026' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['Live forecast', 'Replay: 7 August 2026', 'Replay: 8 July 2026']);
    expect(select.value).toBe('live');
    expect(select.className).toBe('');
  });

  it('choosing a replay day changes the scenario for the whole site and is marked as a replay', async () => {
    renderShell();
    const select = (await screen.findByLabelText('Weather to show')) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Replay: 7 August 2026' });
    await userEvent.selectOptions(select, '2026-07-08');
    expect(screen.getByTestId('scenario').textContent).toBe('2026-07-08');
    expect(select.className).toBe('replay');
    await userEvent.selectOptions(select, 'live');
    expect(screen.getByTestId('scenario').textContent).toBe('live');
    expect(select.className).toBe('');
  });

  it('starts on Live every time: nothing is remembered between visits', async () => {
    window.sessionStorage.setItem('routerain.scenario', JSON.stringify({ mode: 'replay', date: '2026-08-07' }));
    window.localStorage.setItem('routerain.scenario', JSON.stringify({ mode: 'replay', date: '2026-08-07' }));
    renderShell();
    expect((screen.getByLabelText('Weather to show') as HTMLSelectElement).value).toBe('live');
    expect(screen.getByTestId('scenario').textContent).toBe('live');
  });

  it('a replay can be asked for in the address (?replay=date), for demo links', () => {
    window.history.pushState({}, '', '/plan?replay=2026-08-07');
    renderShell();
    expect((screen.getByLabelText('Weather to show') as HTMLSelectElement).value).toBe('2026-08-07');
    window.history.pushState({}, '', '/');
  });

  it('ignores a malformed replay date in the address', () => {
    window.history.pushState({}, '', '/plan?replay=yesterday');
    renderShell();
    expect(screen.getByTestId('scenario').textContent).toBe('live');
    window.history.pushState({}, '', '/');
  });

  it('shows a replay day even before the list of days has loaded', () => {
    renderShell('/plan', { mode: 'replay', date: '2026-08-07' });
    expect((screen.getByLabelText('Weather to show') as HTMLSelectElement).value).toBe('2026-08-07');
  });
});
