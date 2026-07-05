import { FuelCode, LatLon, Station } from './types';

// --- corridor geometry -----------------------------------------------------

const MILES_PER_DEG_LAT = 69;

// Local flat projection (fine at UK scale): degrees → miles around a
// reference latitude.
function toMiles(p: LatLon, refLatCos: number): { x: number; y: number } {
  return { x: p.lon * MILES_PER_DEG_LAT * refLatCos, y: p.lat * MILES_PER_DEG_LAT };
}

function pointToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = a.x + t * dx - p.x;
  const ny = a.y + t * dy - p.y;
  return Math.sqrt(nx * nx + ny * ny);
}

// Straight-line miles from a point to the nearest segment of the route.
export function distanceToRouteMiles(point: LatLon, route: LatLon[]): number {
  if (route.length === 0) return Infinity;
  const refLatCos = Math.cos((point.lat * Math.PI) / 180);
  const p = toMiles(point, refLatCos);
  if (route.length === 1) {
    const a = toMiles(route[0], refLatCos);
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let best = Infinity;
  let a = toMiles(route[0], refLatCos);
  for (let i = 1; i < route.length; i++) {
    const b = toMiles(route[i], refLatCos);
    const d = pointToSegment(p, a, b);
    if (d < best) best = d;
    a = b;
  }
  return best;
}

// --- detour model ------------------------------------------------------------

// Straight-line offset → real extra driving: roads meander (×1.4), and you
// drive it there and back (×2), at local-road speeds.
export const ROAD_FACTOR = 1.4;
export const DETOUR_SPEED_MPH = 25;

export function detourMilesFor(offRouteMiles: number): number {
  return 2 * offRouteMiles * ROAD_FACTOR;
}

export function detourMinutesFor(offRouteMiles: number): number {
  return (detourMilesFor(offRouteMiles) / DETOUR_SPEED_MPH) * 60;
}

// --- verdict maths -----------------------------------------------------------

// ≈40 mpg: 4.546 L/gal ÷ 40 mi/gal.
export const DEFAULT_LITRES_PER_MILE = 0.114;

export interface Verdict {
  savingPounds: number; // (baseline − station) price gap × litres
  detourFuelPounds: number; // extra fuel burned driving the detour
  netPounds: number;
  worthIt: boolean;
}

export function detourVerdict(input: {
  baselinePence: number;
  stationPence: number;
  litresToFill: number;
  detourMiles: number;
  litresPerMile?: number;
}): Verdict {
  const lpm = input.litresPerMile ?? DEFAULT_LITRES_PER_MILE;
  const savingPounds = ((input.baselinePence - input.stationPence) * input.litresToFill) / 100;
  const detourFuelPounds = (input.detourMiles * lpm * input.stationPence) / 100;
  const netPounds = savingPounds - detourFuelPounds;
  return { savingPounds, detourFuelPounds, netPounds, worthIt: netPounds > 0 };
}

// --- corridor assembly ---------------------------------------------------------

export interface CorridorStation {
  station: Station;
  offRouteMiles: number;
  detourMiles: number;
  detourMinutes: number;
  isBaseline: boolean;
  verdict: Verdict | null; // null on the baseline row
}

export const ON_ROUTE_MINUTES = 1;

// Stations within maxDetourMinutes of the route, each scored against the
// baseline: the cheapest station that is effectively on the route
// (≤1 min detour). With no on-route station, the smallest-detour station
// becomes the baseline — the honest "what you'd do by default" comparator.
export function buildCorridor(
  stations: Station[],
  route: LatLon[],
  fuel: FuelCode,
  maxDetourMinutes: number,
  litresToFill: number,
): CorridorStation[] {
  const candidates = stations
    .filter(s => s.prices[fuel] != null)
    .map(s => {
      const off = distanceToRouteMiles(s, route);
      return {
        station: s,
        offRouteMiles: off,
        detourMiles: detourMilesFor(off),
        detourMinutes: detourMinutesFor(off),
      };
    })
    .filter(c => c.detourMinutes <= maxDetourMinutes);

  if (candidates.length === 0) return [];

  const onRoute = candidates.filter(c => c.detourMinutes <= ON_ROUTE_MINUTES);
  const pool = onRoute.length ? onRoute : [...candidates].sort((a, b) => a.detourMinutes - b.detourMinutes).slice(0, 1);
  const baseline = pool.reduce((min, c) =>
    c.station.prices[fuel]! < min.station.prices[fuel]! ? c : min,
  );
  const baselinePence = baseline.station.prices[fuel]!;

  return candidates
    .map(c => ({
      ...c,
      isBaseline: c === baseline,
      verdict:
        c === baseline
          ? null
          : detourVerdict({
              baselinePence,
              stationPence: c.station.prices[fuel]!,
              litresToFill,
              detourMiles: c.detourMiles,
            }),
    }))
    .sort((a, b) => {
      if (a.isBaseline) return -1;
      if (b.isBaseline) return 1;
      return b.verdict!.netPounds - a.verdict!.netPounds;
    });
}
