// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profileStore } from '@/lib/storage';

import { SPLASH_MS, SplashGate } from './Splash';

const Inside = () => <div>app content</div>;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  profileStore.reload();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('entry screen', () => {
  it('shows the app name first, with its tagline, and does not render the app underneath', () => {
    render(<SplashGate><Inside /></SplashGate>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('RouteRain');
    expect(screen.getByText('Know before you go.')).toBeTruthy();
    expect(screen.getByRole('img', { name: /routerain logo/i })).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
  });

  it('continues by itself after a short time', () => {
    render(<SplashGate><Inside /></SplashGate>);
    act(() => void vi.advanceTimersByTime(SPLASH_MS + 10));
    expect(screen.getByText('app content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'RouteRain' })).toBeNull();
  });

  it.each([
    ['the Enter button', () => fireEvent.click(screen.getByRole('button', { name: 'Enter' }))],
    ['a click anywhere', () => fireEvent.click(screen.getByLabelText('RouteRain'))],
    ['the Enter key', () => fireEvent.keyDown(window, { key: 'Enter' })],
    ['the Space key', () => fireEvent.keyDown(window, { key: ' ' })],
    ['the Escape key', () => fireEvent.keyDown(window, { key: 'Escape' })],
  ])('can be skipped with %s', (_name, act_) => {
    render(<SplashGate><Inside /></SplashGate>);
    act_();
    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('shows only once per browser session', () => {
    const first = render(<SplashGate><Inside /></SplashGate>);
    fireEvent.keyDown(window, { key: 'Enter' });
    first.unmount();
    render(<SplashGate><Inside /></SplashGate>);
    expect(screen.getByText('app content')).toBeTruthy();
    expect(screen.queryByText('Know before you go.')).toBeNull();
  });

  it('still works when session storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<SplashGate><Inside /></SplashGate>);
    expect(screen.getByRole('heading', { name: 'RouteRain' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('stops listening for keys after it has gone', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    render(<SplashGate><Inside /></SplashGate>);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('greets a returning visitor by name, and shows no greeting to a new one', () => {
    const fresh = render(<SplashGate><Inside /></SplashGate>);
    expect(screen.queryByText(/welcome back/i)).toBeNull();
    fresh.unmount();
    profileStore.update({ name: 'Tanish', onboarded: true });
    render(<SplashGate><Inside /></SplashGate>);
    expect(screen.getByText('Welcome back, Tanish')).toBeTruthy();
  });
});
