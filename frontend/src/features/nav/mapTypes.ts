import type { Directions, RouteResponse } from '@/api/schemas';

import type { Frame } from './driveController';

/** What the screen can ask of either navigation map (MapLibre, or the Leaflet fallback). */
export type NavMapHandle = {
  /** Move the car and (while following) the camera. Called every animation frame, so it must not re-render React. */
  update(frame: Frame, nowMs: number): void;
  /** Follow the car again after the user dragged the map. */
  recenter(): void;
};

export type NavMapProps = {
  route: RouteResponse;
  directions: Directions;
  /** The user dragged the map, so the camera stopped following the car. */
  onDragged: () => void;
  /** The vector map could not start (style failed to load, no WebGL): the screen switches to the fallback map. */
  onFailed?: (reason: string) => void;
};

export const CAR_COLOR = '#2f81f7';
/** The route line: a strong blue that reads on the light OpenFreeMap / OpenStreetMap basemaps. */
export const ROUTE_BLUE = '#1f6feb';
export const DRIVEN_GREY = '#9aa5b1';
export const ROUTE_CASING = '#ffffff';
