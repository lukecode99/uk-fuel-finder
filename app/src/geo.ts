import { LatLon } from './types';

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

// Bounding box (west,south,east,north) around a point, for the /stations API.
export function bboxAround(center: LatLon, radiusMiles: number): [number, number, number, number] {
  const dLat = radiusMiles / 69; // ~69 miles per degree latitude
  const dLon = radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
  return [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
}
