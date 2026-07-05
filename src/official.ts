import type { Env, Snapshot } from './types';
import { parseRetailerFeed, type SourceResult } from './sources';

// Official Fuel Finder API (developer.fuel-finder.service.gov.uk).
//
// DORMANT until app registration completes — the developer portal is in
// maintenance at the time of writing, so client credentials do not exist yet.
// The flow below implements standard OAuth2 client-credentials with a KV-cached
// token; endpoint paths and the response shape MUST be verified against the
// portal docs once registration is possible. Secrets live in worker secrets
// (FF_CLIENT_ID / FF_CLIENT_SECRET), never in this repo.

const TOKEN_KEY = 'oauth:token';
const DEFAULT_API_BASE = 'https://api.fuel-finder.service.gov.uk';
const DEFAULT_TOKEN_URL = 'https://api.fuel-finder.service.gov.uk/oauth2/token';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export function officialConfigured(env: Env): boolean {
  return Boolean(env.FF_CLIENT_ID && env.FF_CLIENT_SECRET);
}

async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.FUEL_KV.get<CachedToken>(TOKEN_KEY, 'json');
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.accessToken;

  const res = await fetch(env.FF_TOKEN_URL ?? DEFAULT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(`${env.FF_CLIENT_ID}:${env.FF_CLIENT_SECRET}`),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token endpoint HTTP ${res.status}`);
  const tok = (await res.json()) as { access_token: string; expires_in?: number };
  if (!tok.access_token) throw new Error('token endpoint returned no access_token');
  const expiresAt = Date.now() + (tok.expires_in ?? 300) * 1000;
  await env.FUEL_KV.put(TOKEN_KEY, JSON.stringify({ accessToken: tok.access_token, expiresAt }), {
    expirationTtl: Math.max(60, tok.expires_in ?? 300),
  });
  return tok.access_token;
}

// Pull the official station/price dataset. Falls back internally to the CSV
// bulk download (FF_CSV_URL, published twice daily) if the REST call fails.
export async function pullOfficialSource(env: Env, prev: Snapshot | null, now: string): Promise<SourceResult> {
  const prevStatus = prev?.sources.find((s) => s.name === 'fuel-finder') ?? null;
  try {
    const token = await getAccessToken(env);
    const res = await fetch(`${env.FF_API_BASE ?? DEFAULT_API_BASE}/v1/fuel-prices`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    // Placeholder assumption: scheme-standard feed shape (same as the interim
    // scheme retailer feeds). Verify and adjust once the API docs are readable.
    const { stations, feedUpdatedAt } = parseRetailerFeed('fuel-finder', await res.json(), now);
    return {
      stations,
      status: { name: 'fuel-finder', ok: true, stationCount: stations.length, feedUpdatedAt, lastFetchAt: now },
    };
  } catch (err) {
    if (env.FF_CSV_URL) {
      try {
        return await pullOfficialCsv(env, now);
      } catch {
        // fall through to the carried-forward failure result
      }
    }
    const carried = prev?.stations.filter((s) => s.source === 'fuel-finder') ?? [];
    return {
      stations: carried,
      status: {
        name: 'fuel-finder',
        ok: false,
        stationCount: carried.length,
        feedUpdatedAt: prevStatus?.feedUpdatedAt ?? null,
        lastFetchAt: prevStatus?.lastFetchAt ?? null,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// CSV fallback: expects a header row; column names matched case-insensitively.
// Wire FF_CSV_URL (and adjust COLUMN_ALIASES if needed) once the bulk-download
// spec is visible in the portal.
const COLUMN_ALIASES: Record<string, string[]> = {
  siteId: ['site_id', 'siteid', 'station_id'],
  brand: ['brand', 'trading_name'],
  address: ['address', 'site_address'],
  postcode: ['postcode', 'post_code'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'lon'],
  E10: ['e10'],
  E5: ['e5'],
  B7: ['b7', 'diesel'],
  SDV: ['sdv', 'super_diesel'],
  updated: ['price_updated_at', 'last_updated', 'updated_at'],
};

async function pullOfficialCsv(env: Env, now: string): Promise<SourceResult> {
  const res = await fetch(env.FF_CSV_URL!, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (key: string) => header.findIndex((h) => COLUMN_ALIASES[key]?.includes(h));
  const idx = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((k) => [k, col(k)]));
  if (idx.siteId < 0 || idx.lat < 0 || idx.lng < 0) throw new Error('CSV missing required columns');

  const stations = [];
  for (const row of rows.slice(1)) {
    const lat = Number(row[idx.lat]);
    const lng = Number(row[idx.lng]);
    const siteId = row[idx.siteId]?.trim();
    if (!siteId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const prices: Record<string, number> = {};
    for (const code of ['E10', 'E5', 'B7', 'SDV']) {
      const p = Number(row[idx[code]]);
      if (idx[code] >= 0 && Number.isFinite(p) && p > 0) prices[code] = p;
    }
    if (Object.keys(prices).length === 0) continue;
    stations.push({
      id: `fuel-finder:${siteId}`,
      siteId,
      brand: (idx.brand >= 0 && row[idx.brand]?.trim()) || 'Unknown',
      address: (idx.address >= 0 && row[idx.address]?.trim()) || '',
      postcode: (idx.postcode >= 0 && row[idx.postcode]?.trim()) || '',
      lat,
      lng,
      prices,
      priceUpdatedAt: (idx.updated >= 0 && new Date(row[idx.updated]).toISOString()) || now,
      source: 'fuel-finder',
    });
  }
  if (stations.length === 0) throw new Error('CSV parsed to 0 stations');
  return {
    stations,
    status: { name: 'fuel-finder', ok: true, stationCount: stations.length, feedUpdatedAt: null, lastFetchAt: now },
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
