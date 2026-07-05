// EV charging teaser (FF-7): data comes from the worker's /ev endpoint,
// which proxies and caches Open Charge Map's open data (successor to the
// National Chargepoint Registry, decommissioned November 2024).
// Pure helpers live here (no React Native imports) so tests can bundle them.
import { API_BASE } from './config';
import { LatLon } from './types';

export interface EvConnector {
  type: string;
  kw: number | null;
}

export interface Chargepoint {
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

// OCM connector names are verbose ("Type 2 (Socket Only)") — shorten to the
// labels drivers actually use.
export function prettyConnector(type: string): string {
  if (/chademo|jevs/i.test(type)) return 'CHAdeMO';
  if (/ccs|combo|62196-3/i.test(type)) return 'CCS';
  if (/type ?2|mennekes/i.test(type)) return 'Type 2';
  if (/type ?1|j1772|yazaki/i.test(type)) return 'Type 1';
  if (/3.?pin|bs ?1363|domestic/i.test(type)) return '3-pin';
  return type.replace(/\s*\(.*\)$/, '');
}

// "Type 2 ×2 7kW · CCS 50kW" — one segment per connector kind, count when
// more than one, fastest rated output for that kind.
export function connectorSummary(connectors: EvConnector[]): string {
  const byType = new Map<string, { count: number; kw: number | null }>();
  for (const c of connectors) {
    const label = prettyConnector(c.type);
    const cur = byType.get(label) ?? { count: 0, kw: null };
    cur.count += 1;
    if (c.kw != null && (cur.kw == null || c.kw > cur.kw)) cur.kw = c.kw;
    byType.set(label, cur);
  }
  return [...byType.entries()]
    .map(([label, { count, kw }]) => {
      const n = count > 1 ? ` ×${count}` : '';
      const power = kw != null ? ` ${kw % 1 ? kw.toFixed(1) : kw}kW` : '';
      return `${label}${n}${power}`;
    })
    .join(' · ');
}

export function maxKw(connectors: EvConnector[]): number | null {
  let max: number | null = null;
  for (const c of connectors) {
    if (c.kw != null && (max == null || c.kw > max)) max = c.kw;
  }
  return max;
}

export async function fetchChargepoints(center: LatLon, distMiles = 5): Promise<Chargepoint[]> {
  const res = await fetch(`${API_BASE}/ev?lat=${center.lat}&lon=${center.lon}&dist=${distMiles}`);
  if (!res.ok) throw new Error(`ev ${res.status}`);
  const json = (await res.json()) as { chargepoints?: Chargepoint[] };
  return json.chargepoints ?? [];
}
