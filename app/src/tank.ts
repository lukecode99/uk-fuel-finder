import { formatPrice } from './format';

// Map price display (FF-11): station prices render either as pence per litre
// (the default) or as the cost to fill the user's tank. Pure module — no
// storage or Expo imports — so the unit tests can bundle it; MainScreen owns
// persistence, same split as alerts.ts.

export type PriceDisplay = 'ppl' | 'fill';

// UK tank sizes: small hatchback (Fiesta/Corsa class) ~40 L, mid-size family
// car (Focus/Golf/Astra) ~55 L, large saloon/SUV ~70 L.
export const TANK_PRESETS = [
  { key: 'S', label: 'Small', litres: 40 },
  { key: 'M', label: 'Medium', litres: 55 },
  { key: 'L', label: 'Large', litres: 70 },
] as const;

// Slider range: mopeds/city cars down at 10 L, long-range SUVs and vans up at
// 120 L. Whole litres only — finer granularity is false precision here.
export const MIN_TANK_LITRES = 10;
export const MAX_TANK_LITRES = 120;
export const DEFAULT_TANK_LITRES = 55;

export const DISPLAY_KEY = 'ff:priceDisplay';
export const TANK_KEY = 'ff:tankLitres';

export function clampLitres(litres: number): number {
  if (!isFinite(litres)) return DEFAULT_TANK_LITRES;
  return Math.min(MAX_TANK_LITRES, Math.max(MIN_TANK_LITRES, Math.round(litres)));
}

/** Litres from the editable field. Null (not a fallback) for junk, so the UI
 * can leave the last good value in place while the user is mid-edit. */
export function parseLitres(text: string): number | null {
  const n = Number(text.trim());
  if (!isFinite(n) || n <= 0) return null;
  return clampLitres(n);
}

/** The preset the current litres value corresponds to, if any — keeps the
 * matching chip highlighted after a restart or a slider stop on 40/55/70. */
export function presetKeyFor(litres: number): 'S' | 'M' | 'L' | null {
  return TANK_PRESETS.find(p => p.litres === litres)?.key ?? null;
}

// Slider position ↔ litres. The track maps linearly over the whole range.
export function litresFromFraction(frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  return clampLitres(MIN_TANK_LITRES + f * (MAX_TANK_LITRES - MIN_TANK_LITRES));
}

export function fractionForLitres(litres: number): number {
  return (clampLitres(litres) - MIN_TANK_LITRES) / (MAX_TANK_LITRES - MIN_TANK_LITRES);
}

/** Cost in pounds to put `litres` in at this price, or null when the station
 * doesn't price the selected fuel. */
export function fillCostPounds(pencePerLitre: number | undefined, litres: number): number | null {
  if (pencePerLitre == null) return null;
  return (pencePerLitre * clampLitres(litres)) / 100;
}

export function formatFillCost(pencePerLitre: number | undefined, litres: number): string {
  const cost = fillCostPounds(pencePerLitre, litres);
  return cost == null ? '—' : `£${cost.toFixed(2)}`;
}

/** Every station price on map, list, and route views renders through this, so
 * the toggle flips all of them at once. */
export function stationPriceText(
  display: PriceDisplay,
  pencePerLitre: number | undefined,
  litres: number,
): string {
  return display === 'fill' ? formatFillCost(pencePerLitre, litres) : formatPrice(pencePerLitre);
}
