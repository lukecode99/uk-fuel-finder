import { FuelCode, Station } from './types';
import { API_BASE } from './config';

// One point per day, straight from the worker's daily history snapshots.
export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  price: number; // pence per litre
}

interface HistoryDay {
  date: string;
  prices: Partial<Record<FuelCode, number>>;
  priceUpdatedAt: string;
}

export async function fetchHistory(stationId: string, fuel: FuelCode): Promise<HistoryPoint[]> {
  const res = await fetch(`${API_BASE}/history?station=${encodeURIComponent(stationId)}`);
  if (!res.ok) return [];
  const json: { days: HistoryDay[] } = await res.json();
  return (json.days ?? [])
    .filter(d => d.prices[fuel] != null)
    .map(d => ({ date: d.date, price: d.prices[fuel]! }));
}

// --- trend maths -------------------------------------------------------------

export interface Trend {
  direction: 'rising' | 'falling' | 'steady';
  slopePencePerDay: number; // least-squares slope
  changePence: number; // last price − first price over the window
  firstPrice: number;
  lastPrice: number;
  days: number; // span of the window in days (dates, not point count)
}

// Below this total drift across the window the honest answer is "steady" —
// UK pump prices move in 1p steps, so sub-0.5p noise isn't a trend.
export const STEADY_THRESHOLD_PENCE = 0.5;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// Least-squares slope over (dayIndex, price). Needs 2+ points on 2+ distinct
// days; returns null when there isn't enough history to say anything honest.
export function computeTrend(points: HistoryPoint[]): Trend | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span < 1) return null;

  const xs = sorted.map(p => daysBetween(first.date, p.date));
  const ys = sorted.map(p => p.price);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const changePence = last.price - first.price;
  const direction: Trend['direction'] =
    Math.abs(changePence) < STEADY_THRESHOLD_PENCE ? 'steady' : changePence > 0 ? 'rising' : 'falling';
  return {
    direction,
    slopePencePerDay: slope,
    changePence,
    firstPrice: first.price,
    lastPrice: last.price,
    days: span,
  };
}

// --- area trend ----------------------------------------------------------------

// Average the per-day prices across every station that has a point that day,
// then trend the averages. Days with fewer than 2 reporting stations are kept —
// with young history (the worker only stores 14 days) dropping them would
// often leave nothing.
export function areaSeries(histories: HistoryPoint[][]): HistoryPoint[] {
  const byDate = new Map<string, number[]>();
  for (const h of histories) {
    for (const p of h) {
      const arr = byDate.get(p.date) ?? [];
      arr.push(p.price);
      byDate.set(p.date, arr);
    }
  }
  return [...byDate.entries()]
    .map(([date, prices]) => ({
      date,
      price: prices.reduce((a, b) => a + b, 0) / prices.length,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// --- fill-now signal ------------------------------------------------------------

// A deliberately simple, explainable rule — no black box. Thresholds are in
// p/day of least-squares slope over the available window (≤14 days).
export const RISING_SLOPE = 0.15;
export const FALLING_SLOPE = -0.15;

export interface FillSignal {
  action: 'fill-now' | 'wait' | 'neutral';
  headline: string;
  explanation: string; // states the actual numbers the rule used
}

function p(n: number): string {
  return `${n.toFixed(1)}p`;
}

export function fillNowSignal(trend: Trend | null, fuelLabel: string): FillSignal {
  if (!trend) {
    return {
      action: 'neutral',
      headline: 'Not enough history yet',
      explanation:
        'Price history is still building (the service keeps 14 days) — check back in a couple of days.',
    };
  }
  const rate = trend.slopePencePerDay;
  const facts =
    `${fuelLabel} near you went ${p(trend.firstPrice)} → ${p(trend.lastPrice)} over ` +
    `${trend.days} day${trend.days === 1 ? '' : 's'} ` +
    `(${trend.changePence >= 0 ? '+' : '−'}${p(Math.abs(trend.changePence))}, ` +
    `${rate >= 0 ? '+' : '−'}${p(Math.abs(rate))}/day trend).`;
  if (rate >= RISING_SLOPE && trend.direction === 'rising') {
    return {
      action: 'fill-now',
      headline: 'Prices rising — filling up now looks smart',
      explanation: `${facts} Rising faster than ${RISING_SLOPE.toFixed(2)}p/day, so waiting is likely to cost you.`,
    };
  }
  if (rate <= FALLING_SLOPE && trend.direction === 'falling') {
    return {
      action: 'wait',
      headline: 'Prices falling — wait if you can',
      explanation: `${facts} Falling faster than ${Math.abs(FALLING_SLOPE).toFixed(2)}p/day, so a day or two's wait is likely to save a little.`,
    };
  }
  return {
    action: 'neutral',
    headline: 'Prices steady — fill whenever suits',
    explanation: `${facts} That's within the ±${p(STEADY_THRESHOLD_PENCE)} band we treat as flat.`,
  };
}

// --- helpers for the sparkline -----------------------------------------------------

// Normalise points to 0..1 heights for rendering. Flat series sit mid-height.
export function sparkHeights(points: HistoryPoint[]): number[] {
  if (!points.length) return [];
  const prices = points.map(pt => pt.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return prices.map(() => 0.5);
  return prices.map(v => (v - min) / (max - min));
}

// Nearest N stations with a price for the fuel — the area-trend sample set.
export function nearestWithFuel(
  stations: Station[],
  fuel: FuelCode,
  from: { lat: number; lon: number },
  n: number,
): Station[] {
  return stations
    .filter(s => s.prices[fuel] != null)
    .map(s => ({ s, d: (s.lat - from.lat) ** 2 + ((s.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180)) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(x => x.s);
}
