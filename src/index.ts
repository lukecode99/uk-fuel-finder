import type { Env, Snapshot, Station } from './types';
import { RETAILER_FEEDS, dedupeStations, pullRetailerSource } from './sources';

export { RETAILER_FEEDS };
import { officialConfigured, pullOfficialSource } from './official';
import { evaluateAlerts, getSubscription, parseSubscribeBody, subscribe, unsubscribe } from './alerts';
export { evaluateAlerts, evaluateSub, inQuietHours, londonMinutes, parseSubscribeBody } from './alerts';
import { getChargepoints, parseEvQuery } from './ev';
export { normalizePois, parseEvQuery, getChargepoints, EV_CACHE_TTL_SECONDS } from './ev';

const LATEST_KEY = 'latest';
// Serve-time honesty filter: stations whose prices are older than this are
// excluded from /stations (they still appear in /status counts).
export const MAX_PRICE_AGE_DAYS = 14;
// Cron runs every 10 min; three missed runs in a row = mark responses stale.
const STALE_AFTER_MS = 30 * 60 * 1000;
const HISTORY_DAYS = 14;
// KV free tier allows 1,000 writes/day; ingest does 2 per run (latest + today's
// history key) at 144 runs/day = 288. Keep it that way — no per-station keys.
const HISTORY_TTL_SECONDS = (HISTORY_DAYS + 1) * 86_400;

export async function ingest(env: Env, now = new Date()): Promise<Snapshot> {
  const nowIso = now.toISOString();
  const prev = await env.FUEL_KV.get<Snapshot>(LATEST_KEY, 'json');

  const pulls = RETAILER_FEEDS.map((feed) => pullRetailerSource(feed, prev, nowIso));
  if (officialConfigured(env)) pulls.unshift(pullOfficialSource(env, prev, nowIso));
  const results = await Promise.all(pulls);

  // Official data wins dedup ties by ordering: dedupeStations keeps the fresher
  // record, and the official feed is statutory 30-min data so it is the fresher
  // one in practice; site_id geohashes collapse cross-feed duplicates.
  const stations = dedupeStations(results.flatMap((r) => r.stations));
  const snapshot: Snapshot = { ingestedAt: nowIso, sources: results.map((r) => r.status), stations };

  await env.FUEL_KV.put(LATEST_KEY, JSON.stringify(snapshot));
  await appendHistory(env, snapshot, now);
  try {
    await evaluateAlerts(env, snapshot, now);
  } catch {
    // Alerts must never break ingest — a failed push run just retries next cron.
  }
  return snapshot;
}

// One KV key per day: hist:YYYY-MM-DD -> { siteId: { p: prices, t: priceUpdatedAt } }.
// Last write of the day wins, which is the day's latest prices — enough
// granularity for FF-4's trend view without blowing KV write limits.
async function appendHistory(env: Env, snapshot: Snapshot, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const entry: Record<string, { p: Station['prices']; t: string }> = {};
  for (const s of snapshot.stations) entry[s.siteId] = { p: s.prices, t: s.priceUpdatedAt };
  await env.FUEL_KV.put(`hist:${day}`, JSON.stringify(entry), { expirationTtl: HISTORY_TTL_SECONDS });
}

export function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function stationsInBbox(
  snapshot: Snapshot,
  bbox: [number, number, number, number],
  now = new Date(),
): { fresh: Station[]; excludedStale: number } {
  const cutoff = new Date(now.getTime() - MAX_PRICE_AGE_DAYS * 86_400_000).toISOString();
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const fresh: Station[] = [];
  let excludedStale = 0;
  for (const s of snapshot.stations) {
    if (s.lng < minLng || s.lng > maxLng || s.lat < minLat || s.lat > maxLat) continue;
    if (s.priceUpdatedAt < cutoff) { excludedStale++; continue; }
    fresh.push(s);
  }
  return { fresh, excludedStale };
}

export function toGeoJson(snapshot: Snapshot, stations: Station[], excludedStale: number, now = new Date()) {
  return {
    type: 'FeatureCollection' as const,
    // Foreign members (allowed by RFC 7946) carry the freshness contract.
    dataUpdatedAt: snapshot.ingestedAt,
    stale: isStale(snapshot, now),
    count: stations.length,
    excludedStale,
    features: stations.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        brand: s.brand,
        address: s.address,
        postcode: s.postcode,
        prices: s.prices,
        priceUpdatedAt: s.priceUpdatedAt,
        source: s.source,
        ...(s.facilities?.length ? { facilities: s.facilities } : {}),
      },
    })),
  };
}

function isStale(snapshot: Snapshot, now = new Date()): boolean {
  if (now.getTime() - new Date(snapshot.ingestedAt).getTime() > STALE_AFTER_MS) return true;
  return !snapshot.sources.some((s) => s.ok);
}

export function statusBody(snapshot: Snapshot, now = new Date()) {
  const cutoff = new Date(now.getTime() - MAX_PRICE_AGE_DAYS * 86_400_000).toISOString();
  const freshStations = snapshot.stations.filter((s) => s.priceUpdatedAt >= cutoff).length;
  return {
    ingestedAt: snapshot.ingestedAt,
    stale: isStale(snapshot, now),
    officialApi: snapshot.sources.some((s) => s.name === 'fuel-finder' && s.ok),
    coverage: {
      stations: snapshot.stations.length,
      freshStations,
      sources: snapshot.sources.filter((s) => s.ok).length,
      totalSources: snapshot.sources.length,
      note:
        'Major-retailer direct feeds only (roughly a quarter of ~8,300 UK forecourts) ' +
        'until Fuel Finder API registration completes. Stations with prices older than ' +
        `${MAX_PRICE_AGE_DAYS} days are excluded from /stations.`,
    },
    sources: snapshot.sources,
  };
}

async function readHistory(env: Env, station: string, now = new Date()) {
  // History entries are keyed by raw siteId (stable across source changes),
  // but /stations exposes the source-qualified id — accept either form.
  const siteId = station.includes(':') ? station.slice(station.indexOf(':') + 1) : station;
  const days: string[] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    days.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const entries = await Promise.all(
    days.map((day) => env.FUEL_KV.get<Record<string, { p: Station['prices']; t: string }>>(`hist:${day}`, 'json')),
  );
  const series = days
    .map((day, i) => ({ day, rec: entries[i]?.[siteId] ?? entries[i]?.[station] }))
    .filter((e) => e.rec)
    .map((e) => ({ date: e.day, prices: e.rec!.p, priceUpdatedAt: e.rec!.t }))
    .reverse();
  return { siteId, days: series };
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'public, max-age=60', ...CORS_HEADERS },
  });
}

export async function handleRequest(req: Request, env: Env, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (req.method === 'POST' && url.pathname === '/alerts/subscribe') {
    const body = await req.json().catch(() => null);
    const snapshot = await env.FUEL_KV.get<Snapshot>(LATEST_KEY, 'json');
    const sub = parseSubscribeBody(body, snapshot);
    if (!sub) return json({ error: 'token and a valid fuel are required' }, 400);
    await subscribe(env, sub);
    return json({ ok: true, favourites: sub.favourites.length, area: Boolean(sub.area), quiet: sub.quiet });
  }
  if (req.method === 'POST' && url.pathname === '/alerts/unsubscribe') {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token) return json({ error: 'token required' }, 400);
    const removed = await unsubscribe(env, body.token);
    return json({ ok: true, removed });
  }
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  if (url.pathname === '/alerts/status') {
    const token = url.searchParams.get('token');
    if (!token) return json({ error: 'token required' }, 400);
    const sub = await getSubscription(env, token);
    return json(
      sub
        ? { subscribed: true, fuel: sub.fuel, favourites: sub.favourites, area: sub.area ?? null, quiet: sub.quiet }
        : { subscribed: false },
    );
  }

  if (url.pathname === '/') {
    return json({
      service: 'uk-fuel-finder',
      endpoints: [
        '/stations?bbox=minLng,minLat,maxLng,maxLat',
        '/status',
        '/history?station=<siteId>',
        'POST /alerts/subscribe',
        'POST /alerts/unsubscribe',
        '/alerts/status?token=<pushToken>',
        '/ev?lat=<lat>&lon=<lon>&dist=<miles>',
      ],
    });
  }

  if (url.pathname === '/stations') {
    const bbox = parseBbox(url.searchParams.get('bbox'));
    if (!bbox) return json({ error: 'bbox required: minLng,minLat,maxLng,maxLat' }, 400);
    const snapshot = await env.FUEL_KV.get<Snapshot>(LATEST_KEY, 'json');
    if (!snapshot) return json({ error: 'no data ingested yet' }, 503);
    const { fresh, excludedStale } = stationsInBbox(snapshot, bbox, now);
    return json(toGeoJson(snapshot, fresh, excludedStale, now), 200, 'application/geo+json');
  }

  if (url.pathname === '/status') {
    const snapshot = await env.FUEL_KV.get<Snapshot>(LATEST_KEY, 'json');
    if (!snapshot) return json({ error: 'no data ingested yet' }, 503);
    return json(statusBody(snapshot, now));
  }

  if (url.pathname === '/ev') {
    const q = parseEvQuery(url.searchParams);
    if (!q) return json({ error: 'lat and lon required' }, 400);
    const result = await getChargepoints(env, q);
    if (!result) return json({ error: 'chargepoint registry unavailable' }, 502);
    return json({ query: q, count: result.chargepoints.length, cached: result.cached, chargepoints: result.chargepoints });
  }

  if (url.pathname === '/history') {
    const siteId = url.searchParams.get('station');
    if (!siteId) return json({ error: 'station required' }, 400);
    return json(await readHistory(env, siteId, now));
  }

  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handleRequest(req, env),
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> => {
    ctx.waitUntil(ingest(env));
  },
};
