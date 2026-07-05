// EV charging teaser (FF-7): proxies Open Charge Map's open-data API,
// normalised to the few fields the app renders. (The National Chargepoint
// Registry this feature was scoped against was decommissioned in November
// 2024 — OCM is its community-run successor.) Responses are cached in KV
// per rounded query.
import type { Env } from './types';

export interface EvConnector {
  type: string;
  kw: number | null;
}

export interface EvChargepoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  postcode: string | null;
  network: string | null;
  status: string | null;
  operational: boolean | null;
  connectors: EvConnector[];
}

export const OCM_BASE = 'https://api.openchargemap.io/v3/poi';
export const EV_CACHE_TTL_SECONDS = 6 * 3600;
export const EV_MAX_DIST_MILES = 15;
export const EV_MAX_RESULTS = 100;

// OCM POI, loosely typed: coords are numbers but PowerKW is occasionally a
// string, and every nested structure can be null.
interface OcmPoi {
  ID?: number | string;
  AddressInfo?: {
    Title?: string | null;
    Latitude?: string | number | null;
    Longitude?: string | number | null;
    Postcode?: string | null;
  } | null;
  OperatorInfo?: { Title?: string | null } | null;
  StatusType?: { Title?: string | null; IsOperational?: boolean | null } | null;
  Connections?: Array<{
    ConnectionType?: { Title?: string | null } | null;
    PowerKW?: string | number | null;
  }> | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizePois(raw: unknown): EvChargepoint[] {
  if (!Array.isArray(raw)) return [];
  const out: EvChargepoint[] = [];
  for (const p of raw as OcmPoi[]) {
    const lat = num(p?.AddressInfo?.Latitude);
    const lon = num(p?.AddressInfo?.Longitude);
    const id = p?.ID;
    if (lat == null || lon == null || id == null) continue;
    out.push({
      id: String(id),
      name: String(p.AddressInfo?.Title || 'Chargepoint'),
      lat,
      lon,
      postcode: p.AddressInfo?.Postcode ?? null,
      network: p.OperatorInfo?.Title ?? null,
      status: p.StatusType?.Title ?? null,
      operational: p.StatusType?.IsOperational ?? null,
      connectors: (p.Connections ?? [])
        .filter((c) => c?.ConnectionType?.Title)
        .map((c) => ({ type: String(c.ConnectionType!.Title), kw: num(c.PowerKW) })),
    });
    if (out.length >= EV_MAX_RESULTS) break;
  }
  return out;
}

export interface EvQuery {
  lat: number;
  lon: number;
  dist: number;
}

// lat/lon rounded to 3 dp (~100 m) so nearby queries share a cache entry
// and the cache key always matches what was actually fetched.
export function parseEvQuery(params: URLSearchParams): EvQuery | null {
  const lat = num(params.get('lat'));
  const lon = num(params.get('lon'));
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const dist = Math.min(EV_MAX_DIST_MILES, Math.max(1, num(params.get('dist')) ?? 5));
  return {
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    dist: Math.round(dist),
  };
}

export async function getChargepoints(
  env: Env,
  q: EvQuery,
): Promise<{ chargepoints: EvChargepoint[]; cached: boolean } | null> {
  const cacheKey = `ev:${q.lat},${q.lon},${q.dist}`;
  const hit = await env.FUEL_KV.get<EvChargepoint[]>(cacheKey, 'json');
  if (hit) return { chargepoints: hit, cached: true };

  const url =
    `${OCM_BASE}?latitude=${q.lat}&longitude=${q.lon}&distance=${q.dist}` +
    `&distanceunit=miles&maxresults=${EV_MAX_RESULTS}&countrycode=GB&verbose=false`;
  let raw: unknown;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': env.OCM_API_KEY ?? '' },
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }
  const chargepoints = normalizePois(raw);
  await env.FUEL_KV.put(cacheKey, JSON.stringify(chargepoints), {
    expirationTtl: EV_CACHE_TTL_SECONDS,
  });
  return { chargepoints, cached: false };
}
