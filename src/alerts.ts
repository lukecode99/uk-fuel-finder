import type { Env, Snapshot, Station } from './types';

// Price-drop push alerts (FF-5). Subscriptions live one-per-KV-key
// (sub:<token>); the cron evaluates them right after ingest. KV write budget:
// subscribe/unsubscribe are user actions, and the cron only writes a sub back
// when its state actually changed (a drop reference moved, an alert fired, or
// quiet-hours mail was queued) — steady-state cron runs add zero writes.

export type FuelCode = 'E10' | 'E5' | 'B7' | 'SDV';

export const FAVOURITE_DROP_PENCE = 1;
export const AREA_DROP_PENCE = 2;
export const DEFAULT_QUIET = { start: '21:00', end: '07:00' };
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface AlertSub {
  token: string; // Expo push token — doubles as the subscription id
  fuel: FuelCode;
  favourites: string[]; // raw siteIds
  area?: { lat: number; lon: number; radiusMiles: number };
  quiet: { start: string; end: string }; // HH:MM, Europe/London
  // Drop references: the highest price seen since we last alerted. A drop is
  // measured against this, so slow slides accumulate instead of resetting
  // every 10-minute cron run, and one drop alerts exactly once.
  favouriteRefs: Record<string, number>;
  areaRef?: number;
  // Alerts suppressed by quiet hours, delivered as one batch in the morning.
  pending: { title: string; body: string }[];
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
}

const subKey = (token: string) => `sub:${token}`;

export function normalizeSiteId(id: string): string {
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

// --- quiet hours (Europe/London, so BST just works) --------------------------

export function londonMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function inQuietHours(now: Date, quiet: { start: string; end: string }): boolean {
  const t = londonMinutes(now);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  // Overnight window (21:00–07:00) wraps midnight; same-day windows don't.
  return start > end ? t >= start || t < end : t >= start && t < end;
}

// --- subscription endpoints ---------------------------------------------------

export function parseSubscribeBody(body: unknown, snapshot: Snapshot | null): AlertSub | null {
  const b = body as Record<string, unknown>;
  if (!b || typeof b.token !== 'string' || !b.token.trim()) return null;
  const fuel = b.fuel as FuelCode;
  if (!['E10', 'E5', 'B7', 'SDV'].includes(fuel)) return null;
  const favourites = Array.isArray(b.favourites)
    ? b.favourites.filter((f): f is string => typeof f === 'string').map(normalizeSiteId)
    : [];
  const area =
    b.area && typeof b.area === 'object'
      ? (() => {
          const a = b.area as Record<string, unknown>;
          if (
            typeof a.lat !== 'number' ||
            typeof a.lon !== 'number' ||
            typeof a.radiusMiles !== 'number'
          )
            return undefined;
          return { lat: a.lat, lon: a.lon, radiusMiles: Math.min(20, Math.max(1, a.radiusMiles)) };
        })()
      : undefined;
  const quiet =
    b.quiet && typeof b.quiet === 'object' && /^\d{2}:\d{2}$/.test(String((b.quiet as any).start)) && /^\d{2}:\d{2}$/.test(String((b.quiet as any).end))
      ? { start: String((b.quiet as any).start), end: String((b.quiet as any).end) }
      : { ...DEFAULT_QUIET };

  const sub: AlertSub = {
    token: b.token.trim(),
    fuel,
    favourites,
    area,
    quiet,
    favouriteRefs: {},
    pending: [],
  };
  // Seed references from the current snapshot so a new subscriber is measured
  // from today's prices, not alerted for history.
  if (snapshot) seedRefs(sub, snapshot);
  return sub;
}

function stationsBySiteId(snapshot: Snapshot): Map<string, Station> {
  return new Map(snapshot.stations.map((s) => [s.siteId, s]));
}

function areaCheapest(sub: AlertSub, snapshot: Snapshot): { price: number; station: Station } | null {
  if (!sub.area) return null;
  const { lat, lon, radiusMiles } = sub.area;
  const latMi = 69;
  const lonMi = 69 * Math.cos((lat * Math.PI) / 180);
  let best: { price: number; station: Station } | null = null;
  for (const s of snapshot.stations) {
    const p = (s.prices as Record<string, number | undefined>)[sub.fuel];
    if (p == null) continue;
    const d = Math.hypot((s.lat - lat) * latMi, (s.lng - lon) * lonMi);
    if (d > radiusMiles) continue;
    if (!best || p < best.price) best = { price: p, station: s };
  }
  return best;
}

function seedRefs(sub: AlertSub, snapshot: Snapshot): void {
  const byId = stationsBySiteId(snapshot);
  for (const fav of sub.favourites) {
    const st = byId.get(fav);
    const p = st ? (st.prices as Record<string, number | undefined>)[sub.fuel] : undefined;
    if (p != null) sub.favouriteRefs[fav] = p;
  }
  const cheap = areaCheapest(sub, snapshot);
  if (cheap) sub.areaRef = cheap.price;
}

export async function subscribe(env: Env, sub: AlertSub): Promise<void> {
  await env.FUEL_KV.put(subKey(sub.token), JSON.stringify(sub));
}

export async function unsubscribe(env: Env, token: string): Promise<boolean> {
  const existing = await env.FUEL_KV.get(subKey(token));
  if (existing === null) return false;
  await env.FUEL_KV.delete(subKey(token));
  return true;
}

export async function getSubscription(env: Env, token: string): Promise<AlertSub | null> {
  return env.FUEL_KV.get<AlertSub>(subKey(token), 'json');
}

// --- evaluation (runs on every cron, right after ingest) -----------------------

function fmt(p: number): string {
  return `${p.toFixed(1)}p`;
}

// Evaluate one sub against the fresh snapshot. Mutates the sub's references /
// pending queue; returns push messages to send now and whether the sub changed.
export function evaluateSub(
  sub: AlertSub,
  snapshot: Snapshot,
  now: Date,
): { toSend: PushMessage[]; changed: boolean } {
  const byId = stationsBySiteId(snapshot);
  const alerts: { title: string; body: string }[] = [];
  let changed = false;

  for (const fav of sub.favourites) {
    const st = byId.get(fav);
    const price = st ? (st.prices as Record<string, number | undefined>)[sub.fuel] : undefined;
    if (price == null) continue;
    const ref = sub.favouriteRefs[fav];
    if (ref == null || price > ref) {
      // First sighting, or price rose: the new high becomes the reference.
      if (sub.favouriteRefs[fav] !== price) {
        sub.favouriteRefs[fav] = price;
        changed = true;
      }
      continue;
    }
    if (ref - price >= FAVOURITE_DROP_PENCE) {
      alerts.push({
        title: `${st!.brand} dropped to ${fmt(price)}`,
        // Bodies must stand alone: the morning batch joins them without titles.
        body: `${sub.fuel} at ${st!.brand} ${st!.postcode} is down ${fmt(ref - price)} to ${fmt(price)}.`,
      });
      sub.favouriteRefs[fav] = price;
      changed = true;
    }
  }

  const cheap = areaCheapest(sub, snapshot);
  if (cheap) {
    if (sub.areaRef == null || cheap.price > sub.areaRef) {
      if (sub.areaRef !== cheap.price) {
        sub.areaRef = cheap.price;
        changed = true;
      }
    } else if (sub.areaRef - cheap.price >= AREA_DROP_PENCE) {
      alerts.push({
        title: `Cheapest ${sub.fuel} near you: ${fmt(cheap.price)}`,
        body: `${cheap.station.brand} ${cheap.station.postcode} is the cheapest near you at ${fmt(cheap.price)}, down ${fmt(sub.areaRef - cheap.price)}.`,
      });
      sub.areaRef = cheap.price;
      changed = true;
    }
  }

  const toSend: PushMessage[] = [];
  if (inQuietHours(now, sub.quiet)) {
    if (alerts.length) {
      sub.pending.push(...alerts);
      changed = true;
    }
  } else {
    // Morning batch first: everything quiet hours held back goes as one push.
    if (sub.pending.length) {
      const held = sub.pending;
      toSend.push({
        to: sub.token,
        title: held.length === 1 ? held[0].title : `${held.length} price drops overnight`,
        body: held.map((a) => a.body).join('\n'),
      });
      sub.pending = [];
      changed = true;
    }
    for (const a of alerts) toSend.push({ to: sub.token, ...a });
  }

  return { toSend, changed };
}

export async function sendPushes(messages: PushMessage[]): Promise<void> {
  if (!messages.length) return;
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default' }))),
  });
}

export async function evaluateAlerts(env: Env, snapshot: Snapshot, now = new Date()): Promise<number> {
  const list = await env.FUEL_KV.list({ prefix: 'sub:' });
  const outbox: PushMessage[] = [];
  for (const key of list.keys) {
    const sub = await env.FUEL_KV.get<AlertSub>(key.name, 'json');
    if (!sub) continue;
    const { toSend, changed } = evaluateSub(sub, snapshot, now);
    outbox.push(...toSend);
    if (changed) await env.FUEL_KV.put(key.name, JSON.stringify(sub));
  }
  await sendPushes(outbox);
  return outbox.length;
}
