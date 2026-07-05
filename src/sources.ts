import type { Snapshot, SourceStatus, Station, StationPrices } from './types';

// Retailer direct feeds from the (closed) CMA interim open-data scheme. Several
// retailers still publish them; each carries its own last_updated stamp which we
// surface as priceUpdatedAt. Feeds that have gone stale are age-filtered at
// serve time, not here — ingest keeps everything so /status can report honestly.
export const RETAILER_FEEDS: { name: string; url: string }[] = [
  { name: 'applegreen', url: 'https://applegreenstores.com/fuel-prices/data.json' },
  { name: 'ascona', url: 'https://fuelprices.asconagroup.co.uk/newfuel.json' },
  { name: 'asda', url: 'https://storelocator.asda.com/fuel_prices_data.json' },
  { name: 'esso', url: 'https://fuelprices.esso.co.uk/latestdata.json' },
  { name: 'jet', url: 'https://jetlocal.co.uk/fuel_prices_data.json' },
  { name: 'moto', url: 'https://moto-way.com/fuel-price/fuel_prices.json' },
  { name: 'mfg', url: 'https://fuel.motorfuelgroup.com/fuel_prices_data.json' },
  { name: 'rontec', url: 'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json' },
  { name: 'sgn', url: 'https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json' },
  // Shell publishes via an HTML redirect to a SAS-signed blob; follow redirects.
  { name: 'shell', url: 'https://www.shell.co.uk/fuel-prices-data.html' },
];

const FUEL_CODES = ['E10', 'E5', 'B7', 'SDV'] as const;

// Feed stamps are "dd/MM/yyyy HH:mm:ss" UK local time with no offset; we parse
// as UTC and accept the ±1h BST skew — price age is display-grade, not billing.
export function parseFeedDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, MM, yyyy, hh, mm, ss] = m;
  const t = Date.UTC(+yyyy, +MM - 1, +dd, +hh, +mm, +ss);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseRetailerFeed(
  name: string,
  body: unknown,
  fetchedAt: string,
): { stations: Station[]; feedUpdatedAt: string | null } {
  const feed = body as { last_updated?: string; stations?: unknown[] };
  if (!Array.isArray(feed?.stations)) throw new Error('no stations array');
  const feedUpdatedAt = parseFeedDate(feed.last_updated) ?? null;
  const priceUpdatedAt = feedUpdatedAt ?? fetchedAt;
  const stations: Station[] = [];
  for (const raw of feed.stations) {
    const s = raw as Record<string, any>;
    const lat = Number(s.location?.latitude);
    const lng = Number(s.location?.longitude);
    if (!s.site_id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Some feeds have left test rows behind (e.g. Gibraltar "GX11 1AA")
    if (lat < 49 || lat > 61.5 || lng < -8.7 || lng > 2.2) continue;
    const prices: StationPrices = {};
    for (const code of FUEL_CODES) {
      const p = Number(s.prices?.[code]);
      // Prices are pence/litre; a few feeds have published pounds by mistake.
      if (Number.isFinite(p) && p > 0) prices[code] = p < 10 ? Math.round(p * 1000) / 10 : p;
    }
    if (Object.keys(prices).length === 0) continue;
    stations.push({
      id: `${name}:${s.site_id}`,
      siteId: String(s.site_id),
      brand: String(s.brand ?? name).trim(),
      address: String(s.address ?? '').trim(),
      postcode: String(s.postcode ?? '').trim(),
      lat,
      lng,
      prices,
      priceUpdatedAt,
      source: name,
    });
  }
  return { stations, feedUpdatedAt };
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchFeed(url: string): Promise<unknown> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'uk-fuel-finder/1.0 (+https://github.com/lukecode99/uk-fuel-finder)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface SourceResult {
  status: SourceStatus;
  stations: Station[];
}

// Pull one retailer feed; on failure fall back to the stations this source
// contributed to the previous snapshot so one dead feed never blanks the map.
export async function pullRetailerSource(
  feed: { name: string; url: string },
  prev: Snapshot | null,
  now: string,
): Promise<SourceResult> {
  const prevStatus = prev?.sources.find((s) => s.name === feed.name) ?? null;
  try {
    const body = await fetchFeed(feed.url);
    const { stations, feedUpdatedAt } = parseRetailerFeed(feed.name, body, now);
    if (stations.length === 0) throw new Error('feed parsed to 0 stations');
    return {
      stations,
      status: { name: feed.name, ok: true, stationCount: stations.length, feedUpdatedAt, lastFetchAt: now },
    };
  } catch (err) {
    const carried = prev?.stations.filter((s) => s.source === feed.name) ?? [];
    return {
      stations: carried,
      status: {
        name: feed.name,
        ok: false,
        stationCount: carried.length,
        feedUpdatedAt: prevStatus?.feedUpdatedAt ?? null,
        lastFetchAt: prevStatus?.lastFetchAt ?? null,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// site_ids are location geohashes, so the same forecourt appearing in two feeds
// (e.g. an Esso site in both the Esso and MFG feeds) collides here — keep the
// fresher record.
export function dedupeStations(stations: Station[]): Station[] {
  const bySite = new Map<string, Station>();
  for (const s of stations) {
    const existing = bySite.get(s.siteId);
    if (!existing || s.priceUpdatedAt > existing.priceUpdatedAt) bySite.set(s.siteId, s);
  }
  return [...bySite.values()];
}
