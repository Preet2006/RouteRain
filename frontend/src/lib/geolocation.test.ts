import { describe, expect, it } from 'vitest';

import { LocateError, locate, pinnedLabel } from './geolocation';

const fakeGeo = (result: 'ok' | 1 | 2 | 3) => ({
  getCurrentPosition: (ok: PositionCallback, err?: PositionErrorCallback | null) => {
    if (result === 'ok') ok({ coords: { latitude: 28.46, longitude: 77.03, accuracy: 25 } } as GeolocationPosition);
    else err?.({ code: result, message: 'x' } as GeolocationPositionError);
  },
});

describe('locate', () => {
  it('resolves with the position', async () => {
    expect(await locate(fakeGeo('ok'), true)).toEqual({ lat: 28.46, lon: 77.03, accuracyM: 25 });
  });

  it.each([
    [1, 'denied', /blocked for this site/i],
    [2, 'unavailable', /couldn't work out where you are/i],
    [3, 'timeout', /took too long/i],
  ] as const)('maps browser error %s to a plain message', async (code, kind, message) => {
    const err = await locate(fakeGeo(code), true).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.kind).toBe(kind);
    expect(err.message).toMatch(message);
    expect(err.message).toMatch(/type a place|pick/i); // always offers another way
  });

  it('explains that location needs https or localhost', async () => {
    const err = await locate(fakeGeo('ok'), false).catch((e) => e);
    expect(err.kind).toBe('insecure');
    expect(err.message).toMatch(/https.*localhost/i);
  });

  it('handles browsers without geolocation', async () => {
    expect((await locate(undefined, true).catch((e) => e)).kind).toBe('unsupported');
  });
});

describe('pinnedLabel', () => {
  it('rounds to 4 decimals', () => {
    expect(pinnedLabel(28.459512, 77.026599)).toBe('Pinned location (28.4595, 77.0266)');
    expect(pinnedLabel(28.4, 77, 'My location')).toBe('My location (28.4000, 77.0000)');
  });
});
