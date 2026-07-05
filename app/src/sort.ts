import { FuelCode, LatLon, SortMode, Station } from './types';
import { haversineMiles } from './geo';

// Stations without a price for the selected fuel sink to the bottom of a
// price sort but keep their place in a distance sort.
export function sortStations(
  stations: Station[],
  fuel: FuelCode,
  mode: SortMode,
  from: LatLon | null,
): Station[] {
  const sorted = [...stations];
  if (mode === 'price') {
    sorted.sort((a, b) => {
      const pa = a.prices[fuel];
      const pb = b.prices[fuel];
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      if (pa !== pb) return pa - pb;
      if (from) return haversineMiles(from, a) - haversineMiles(from, b);
      return 0;
    });
  } else if (from) {
    sorted.sort((a, b) => haversineMiles(from, a) - haversineMiles(from, b));
  }
  return sorted;
}

export function cheapestNear(
  stations: Station[],
  fuel: FuelCode,
  from: LatLon,
  radiusMiles: number,
): Station | null {
  let best: Station | null = null;
  for (const s of stations) {
    const p = s.prices[fuel];
    if (p == null) continue;
    if (haversineMiles(from, s) > radiusMiles) continue;
    if (!best || p < best.prices[fuel]!) best = s;
  }
  return best;
}
