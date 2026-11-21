/** "Use my location": a thin promise wrapper over the browser Geolocation API with plain-language errors. */

export type Position = { lat: number; lon: number; accuracyM: number };

export class LocateError extends Error {
  constructor(readonly kind: 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout', message: string) {
    super(message);
    this.name = 'LocateError';
  }
}

const MESSAGES = {
  unsupported: "This browser can't share your location. Type a place or pick it on the map instead.",
  insecure: 'Your location can only be used on a secure (https) page or on localhost. Type a place or pick it on the map instead.',
  denied:
    'Location is blocked for this site. Allow it from the lock icon next to the address, or type a place or pick it on the map instead.',
  unavailable: "Your device couldn't work out where you are. Try again, or type a place or pick it on the map.",
  timeout: 'Finding your location took too long. Try again, or type a place or pick it on the map.',
} as const;

export function locate(
  geo: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
  secure: boolean = typeof window === 'undefined' ? true : window.isSecureContext,
): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new LocateError('unsupported', MESSAGES.unsupported));
    if (!secure) return reject(new LocateError('insecure', MESSAGES.insecure));
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) => {
        // GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout
        const kind = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
        reject(new LocateError(kind, MESSAGES[kind]));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** Label for a point chosen by clicking the map or by GPS. */
export function pinnedLabel(lat: number, lon: number, prefix = 'Pinned location'): string {
  return `${prefix} (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}
