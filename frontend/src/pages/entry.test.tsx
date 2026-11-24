// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { profileStore } from '@/lib/storage';
import { Entry } from '@/pages/Entry';

function Probe() {
  const l = useLocation();
  return <div data-testid="loc" data-path={l.pathname} />;
}
function renderEntry() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Entry />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  profileStore.reload();
});
afterEach(cleanup);

describe('entry screen', () => {
  it('shows the big app name in the centre, the tagline, three short points and an Enter button', () => {
    renderEntry();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('RouteRain');
    expect(screen.getByText('Know before you go: flood-aware routes for Gurugram')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enter' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'RouteRain' })).toBeTruthy();
    const points = within(screen.getByRole('list', { name: /what routerain does/i })).getAllByRole('listitem');
    expect(points.map((p) => p.textContent)).toEqual(['12 monitored hotspots', 'Risk explained in plain words', 'Flood-aware route advice']);
  });

  it('has no footer: no group or institute line and no caveat link', () => {
    const { container } = renderEntry();
    expect(container.querySelector('footer')).toBeNull();
    expect(container.textContent).not.toMatch(/group 6|mdi|guarantee/i);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('first-time visitors go to setup', async () => {
    renderEntry();
    await userEvent.click(screen.getByRole('button', { name: 'Enter' }));
    expect(screen.getByTestId('loc').dataset.path).toBe('/setup');
  });

  it('returning visitors go straight to trip planning, and are greeted by name', async () => {
    profileStore.update({ onboarded: true, name: 'Tanish' });
    renderEntry();
    expect(screen.getByText('Welcome back, Tanish')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Enter' }));
    expect(screen.getByTestId('loc').dataset.path).toBe('/plan');
  });

  it('the Enter key works from anywhere on the page', () => {
    profileStore.update({ onboarded: true });
    renderEntry();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('loc').dataset.path).toBe('/plan');
  });

  it('does not greet someone who has not finished setup, even if a name is typed in storage', () => {
    profileStore.update({ name: 'Ghost' }); // onboarded is still false
    renderEntry();
    expect(screen.queryByText(/welcome back/i)).toBeNull();
  });

  it('is not auto-skipped: it waits for the visitor', () => {
    renderEntry();
    expect(screen.queryByTestId('loc')).toBeNull();
  });
});
