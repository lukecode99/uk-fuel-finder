import { LatLon } from './types';

// Free, key-less services: postcodes.io for UK postcodes, Nominatim for
// place names, OSRM demo server for the route itself. All fair-use — one
// request per user action, nothing polled.

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export interface GeocodeResult {
  point: LatLon;
  label: string;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  if (POSTCODE_RE.test(q)) {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q.replace(/\s+/g, ''))}`);
    if (res.ok) {
      const json = await res.json();
      const r = json.result;
      return { point: { lat: r.latitude, lon: r.longitude }, label: `${r.postcode}, ${r.admin_district}` };
    }
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=gb&format=json&limit=1`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.length) return null;
  return {
    point: { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) },
    label: String(json[0].display_name).split(',').slice(0, 2).join(','),
  };
}

export interface RouteResult {
  polyline: LatLon[];
  distanceMiles: number;
  durationMinutes: number;
}

export async function fetchRoute(from: LatLon, to: LatLon): Promise<RouteResult | null> {
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`,
  );
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) return null;
  const route = json.routes[0];
  return {
    polyline: (route.geometry.coordinates as [number, number][]).map(([lon, lat]) => ({ lat, lon })),
    distanceMiles: route.distance / 1609.34,
    durationMinutes: route.duration / 60,
  };
}

// Padded bbox covering the whole route, for the /stations fetch. Padding
// covers the widest corridor we offer (10 min ≈ 4.5 mi off-route).
export function routeBbox(polyline: LatLon[], padMiles: number): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polyline) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  const dLat = padMiles / 69;
  const midLat = (s + n) / 2;
  const dLon = padMiles / (69 * Math.cos((midLat * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}
