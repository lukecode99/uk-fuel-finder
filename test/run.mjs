// Integration test: bundles the worker, runs a real ingest against the live
// retailer feeds with an in-memory KV, then checks the API surface against
// values read straight from the source feeds.
//
//   node test/run.mjs
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const outDir = mkdtempSync(join(tmpdir(), 'ff-test-'));
const bundle = join(outDir, 'worker.mjs');
execSync(`npx esbuild src/index.ts --bundle --format=esm --platform=node --outfile=${bundle}`, {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'inherit',
});
const worker = await import(bundle);
const { RETAILER_FEEDS } = worker;

class MockKV {
  store = new Map();
  async get(key, type) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

const env = { FUEL_KV: new MockKV() };

// --- unit checks that need no network ---
check('parseBbox valid', String(worker.parseBbox('-1,50,1,52')) === '-1,50,1,52');
check('parseBbox rejects inverted', worker.parseBbox('1,52,-1,50') === null);
check('parseBbox rejects junk', worker.parseBbox('a,b,c,d') === null);

// --- live ingest ---
const snapshot = await worker.ingest(env);
const okSources = snapshot.sources.filter((s) => s.ok);
console.log('\nsources:', snapshot.sources.map((s) => `${s.name}:${s.ok ? s.stationCount : 'FAIL(' + s.error + ')'}`).join(' '));
check('ingest produced stations', snapshot.stations.length > 1000, `${snapshot.stations.length} stations`);
check('most sources ok', okSources.length >= 5, `${okSources.length}/${snapshot.sources.length}`);
check('every station has priceUpdatedAt', snapshot.stations.every((s) => /^\d{4}-\d{2}-\d{2}T/.test(s.priceUpdatedAt)));
check('every station has at least one price', snapshot.stations.every((s) => Object.keys(s.prices).length > 0));
check('no duplicate siteIds', new Set(snapshot.stations.map((s) => s.siteId)).size === snapshot.stations.length);

// --- verify 3 known forecourts against their source feeds, via the HTTP API ---
// Pick 3 stations from distinct fresh sources out of the snapshot, then re-fetch
// each source feed independently and compare the API's prices for a tight bbox.
// Only feeds updated inside the serve-time age window can appear in /stations,
// so verify against those (frozen feeds are correctly filtered out).
const freshCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
const freshSources = okSources
  .filter((s) => s.name !== 'fuel-finder' && s.feedUpdatedAt && s.feedUpdatedAt >= freshCutoff)
  .slice(0, 3);
check('at least 3 fresh sources to verify against', freshSources.length === 3, freshSources.map((s) => s.name).join(','));
for (const src of freshSources) {
  const st = snapshot.stations.find((s) => s.source === src.name);
  const d = 0.0005;
  const bbox = `${st.lng - d},${st.lat - d},${st.lng + d},${st.lat + d}`;
  const res = await worker.handleRequest(new Request(`https://x/stations?bbox=${bbox}`), env);
  const geo = await res.json();
  const feat = geo.features.find((f) => f.properties.id === st.id);
  const feed = RETAILER_FEEDS.find((f) => f.name === src.name);
  const raw = await (await fetch(feed.url, { redirect: 'follow' })).json();
  const rawStation = raw.stations.find((s) => String(s.site_id) === st.siteId);
  const pricesMatch =
    feat && rawStation && Object.entries(feat.properties.prices).every(([k, v]) => Number(rawStation.prices[k]) === v || Math.round(Number(rawStation.prices[k]) * 1000) / 10 === v);
  check(
    `known forecourt matches source feed [${src.name}]`,
    Boolean(pricesMatch),
    st ? `${st.brand} ${st.postcode} ${JSON.stringify(feat?.properties.prices)}` : 'no station',
  );
  check(`geo+json content type [${src.name}]`, res.headers.get('content-type') === 'application/geo+json');
}

// --- /status coverage honesty ---
const statusRes = await worker.handleRequest(new Request('https://x/status'), env);
const status = await statusRes.json();
check('/status has coverage block', status.coverage && status.coverage.stations > 0 && typeof status.coverage.note === 'string');
check('/status not stale right after ingest', status.stale === false);
check('/status officialApi false until registration', status.officialApi === false);
console.log('coverage:', JSON.stringify(status.coverage));

// --- stale flag: pretend the last ingest was 40 minutes ago ---
const future = new Date(Date.now() + 40 * 60 * 1000);
const staleRes = await worker.handleRequest(new Request('https://x/status'), env, future);
check('stale:true when ingest >30min old', (await staleRes.json()).stale === true);

// --- per-source failure degrades gracefully ---
const realFetch = globalThis.fetch;
const deadSource = freshSources[0];
const deadUrl = RETAILER_FEEDS.find((f) => f.name === deadSource.name).url;
globalThis.fetch = (url, opts) => {
  if (String(url) === deadUrl) return Promise.reject(new Error('simulated outage'));
  return realFetch(url, opts);
};
const snap2 = await worker.ingest(env);
globalThis.fetch = realFetch;
const deadStatus = snap2.sources.find((s) => s.name === deadSource.name);
const before = snapshot.stations.filter((s) => s.source === deadSource.name).length;
check(
  `dead feed carries forward last-good [${deadSource.name}]`,
  deadStatus.ok === false && deadStatus.stationCount === before,
  `carried ${deadStatus.stationCount}/${before}, error: ${deadStatus.error}`,
);
check('other sources unaffected by one outage', snap2.sources.filter((s) => s.ok).length >= okSources.length - 1);

// --- history ---
const histRes = await worker.handleRequest(new Request(`https://x/history?station=${snapshot.stations[0].siteId}`), env);
const hist = await histRes.json();
check('history returns today\'s point', hist.days.length >= 1 && hist.days[hist.days.length - 1].prices);
// The app only ever sees the source-qualified id from /stations — /history
// must accept that form too.
const histByIdRes = await worker.handleRequest(new Request(`https://x/history?station=${encodeURIComponent(snapshot.stations[0].id)}`), env);
const histById = await histByIdRes.json();
check('history accepts source-qualified id', histById.days.length === hist.days.length && histById.days.length >= 1);

// --- FF-5: price-drop alerts -------------------------------------------------
// Synthetic snapshots + a fetch mock on the Expo push endpoint, so every
// success criterion is asserted on actual push traffic, not internals.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const mkStation = (siteId, e10, lat, lng, brand = 'Testco') => ({
  id: `test:${siteId}`,
  siteId,
  brand,
  address: '1 Test St',
  postcode: 'TE5 7ST',
  lat,
  lng,
  prices: { E10: e10 },
  priceUpdatedAt: new Date().toISOString(),
  source: 'test',
});
const mkSnap = (stations) => ({
  ingestedAt: new Date().toISOString(),
  sources: [{ name: 'test', ok: true, stationCount: stations.length }],
  stations,
});
// July = BST (UTC+1): 11:00Z = noon London, 22:00Z = 23:00 London, 06:30Z = 07:30 London.
const DAY = new Date('2026-07-05T11:00:00Z');
const NIGHT = new Date('2026-07-05T22:00:00Z');
const NIGHT2 = new Date('2026-07-06T00:30:00Z'); // 01:30 London — quiet, past midnight
const MORNING = new Date('2026-07-06T06:30:00Z');

check('quiet hours: 23:00 London inside 21:00–07:00', worker.inQuietHours(NIGHT, { start: '21:00', end: '07:00' }) === true);
check('quiet hours: 01:30 London inside overnight window', worker.inQuietHours(NIGHT2, { start: '21:00', end: '07:00' }) === true);
check('quiet hours: noon London outside', worker.inQuietHours(DAY, { start: '21:00', end: '07:00' }) === false);
check('quiet hours: 07:30 London outside', worker.inQuietHours(MORNING, { start: '21:00', end: '07:00' }) === false);

const HOME = { lat: 51.5, lon: -0.1 };
const snapA = mkSnap([
  mkStation('aaa', 150.0, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
]);

const envA = { FUEL_KV: new MockKV() };
await envA.FUEL_KV.put('latest', JSON.stringify(snapA));

const pushLog = [];
globalThis.fetch = (url, opts) => {
  if (String(url) === EXPO_PUSH_URL) {
    pushLog.push(JSON.parse(opts.body));
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }
  return realFetch(url, opts);
};
const pushesSent = () => pushLog.flat();

// Subscribe via the HTTP endpoint (favourite passed in source-qualified form —
// must be normalised to the raw siteId).
const subRes = await worker.handleRequest(
  new Request('https://x/alerts/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      token: 'ExponentPushToken[t1]',
      fuel: 'E10',
      favourites: ['test:aaa'],
      area: { lat: HOME.lat, lon: HOME.lon, radiusMiles: 5 },
    }),
  }),
  envA,
);
const subBody = await subRes.json();
check('subscribe endpoint 200 ok', subRes.status === 200 && subBody.ok === true && subBody.favourites === 1 && subBody.area === true);
check('subscribe defaults quiet hours to 21:00–07:00', subBody.quiet.start === '21:00' && subBody.quiet.end === '07:00');
const storedSub = JSON.parse(envA.FUEL_KV.store.get('sub:ExponentPushToken[t1]'));
check('subscribe seeds favourite ref from current snapshot', storedSub.favouriteRefs.aaa === 150.0);
check('subscribe seeds area ref from current cheapest', storedSub.areaRef === 149.0);
check('subscribe rejects missing token', (await worker.handleRequest(new Request('https://x/alerts/subscribe', { method: 'POST', body: JSON.stringify({ fuel: 'E10' }) }), envA)).status === 400);

// Fresh subscriber, same prices: nothing fires.
await worker.evaluateAlerts(envA, snapA, DAY);
check('no alert when prices unchanged', pushesSent().length === 0);

// SC1: simulated favourite drop of 1.1p fires exactly one push...
const snapDrop = mkSnap([
  mkStation('aaa', 148.9, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
]);
await worker.evaluateAlerts(envA, snapDrop, DAY);
check('favourite drop ≥1p fires exactly one push', pushesSent().length === 1, JSON.stringify(pushesSent()[0]));
check('push names the station and price', pushesSent()[0]?.title.includes('FavBrand') && pushesSent()[0]?.title.includes('148.9p'));
// ...and the same drop evaluated again fires nothing more (exactly-once).
await worker.evaluateAlerts(envA, snapDrop, DAY);
check('same drop re-evaluated fires nothing (exactly once)', pushesSent().length === 1);

// SC2: below-threshold change (0.9p on favourite, 0.9p on area cheapest) fires nothing.
const snapSmall = mkSnap([
  mkStation('aaa', 148.0, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
]);
await worker.evaluateAlerts(envA, snapSmall, DAY);
check('below-threshold change fires nothing', pushesSent().length === 1);

// Area cheapest drops 2.1p from its 149.0 reference (new cheap station appears).
// Favourite stays below its own threshold, so exactly one area push.
const snapArea = mkSnap([
  mkStation('aaa', 148.0, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
  mkStation('ccc', 146.9, 51.49, -0.11, 'CheapBrand'),
]);
await worker.evaluateAlerts(envA, snapArea, DAY);
check('area cheapest drop ≥2p fires one push', pushesSent().length === 2, JSON.stringify(pushesSent()[1]));
check('area push names cheapest station', pushesSent()[1]?.title.includes('146.9p') && pushesSent()[1]?.body.includes('CheapBrand'));

// SC3: quiet hours suppress, then batch to morning. Two separate drops across
// two night-time cron runs must arrive as ONE morning push.
const snapNight1 = mkSnap([
  mkStation('aaa', 146.0, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
  mkStation('ccc', 146.9, 51.49, -0.11, 'CheapBrand'),
]);
await worker.evaluateAlerts(envA, snapNight1, NIGHT);
check('quiet hours suppress push', pushesSent().length === 2);
const pendingSub = JSON.parse(envA.FUEL_KV.store.get('sub:ExponentPushToken[t1]'));
check('suppressed alert queued as pending', pendingSub.pending.length === 1);
const snapNight2 = mkSnap([
  mkStation('aaa', 144.5, 51.5, -0.1, 'FavBrand'),
  mkStation('bbb', 149.0, 51.51, -0.1, 'AreaBrand'),
  mkStation('ccc', 146.9, 51.49, -0.11, 'CheapBrand'),
]);
await worker.evaluateAlerts(envA, snapNight2, NIGHT2);
// Night 2 holds two more alerts: the favourite fell again (146.0 → 144.5) AND
// the area cheapest is now 2.4p under its 146.9 reference.
check('second night drops also held', pushesSent().length === 2 && JSON.parse(envA.FUEL_KV.store.get('sub:ExponentPushToken[t1]')).pending.length === 3);
await worker.evaluateAlerts(envA, snapNight2, MORNING);
check('morning run sends exactly one batched push', pushesSent().length === 3);
check('batch titled with drop count', pushesSent()[2]?.title === '3 price drops overnight');
check('batch body carries both drops', pushesSent()[2]?.body.includes('146.0p') && pushesSent()[2]?.body.includes('144.5p'));
check('pending cleared after morning batch', JSON.parse(envA.FUEL_KV.store.get('sub:ExponentPushToken[t1]')).pending.length === 0);

// SC4: unsubscribe works — endpoint removes the sub and later drops fire nothing.
const unsubRes = await worker.handleRequest(
  new Request('https://x/alerts/unsubscribe', { method: 'POST', body: JSON.stringify({ token: 'ExponentPushToken[t1]' }) }),
  envA,
);
const unsubBody = await unsubRes.json();
check('unsubscribe endpoint 200 removed', unsubRes.status === 200 && unsubBody.removed === true);
const statusAfter = await (await worker.handleRequest(new Request('https://x/alerts/status?token=ExponentPushToken%5Bt1%5D'), envA)).json();
check('/alerts/status reports unsubscribed', statusAfter.subscribed === false);
const snapHuge = mkSnap([mkStation('aaa', 130.0, 51.5, -0.1, 'FavBrand')]);
const sentAfterUnsub = await worker.evaluateAlerts(envA, snapHuge, DAY);
check('drop after unsubscribe fires nothing', sentAfterUnsub === 0 && pushesSent().length === 3);

globalThis.fetch = realFetch;

// --- FF-7: EV chargepoint proxy -------------------------------------------
// OCM-shaped payload with the quirks the normaliser must survive: a string
// PowerKW, a null-AddressInfo POI, a POI with no connections.
const ocmPayload = [
  {
    ID: 12345,
    AddressInfo: {
      Title: 'Q-Park Westminster',
      Latitude: 51.501,
      Longitude: -0.13,
      Postcode: 'SW1P 4YB',
    },
    OperatorInfo: { Title: 'ChargedEV' },
    StatusType: { Title: 'Operational', IsOperational: true },
    Connections: [
      { ConnectionType: { Title: 'Type 2 (Socket Only)' }, PowerKW: 7 },
      { ConnectionType: { Title: 'CHAdeMO' }, PowerKW: '50.00' },
    ],
  },
  { ID: 12346, AddressInfo: null }, // no coords: dropped
  {
    ID: 12347,
    AddressInfo: { Latitude: 51.502, Longitude: -0.125 },
    Connections: null,
  },
];

const normalized = worker.normalizePois(ocmPayload);
check('normalize keeps POIs with coords, drops the rest', normalized.length === 2);
check(
  'string kW parsed to number, numeric coords kept',
  normalized[0].lat === 51.501 && normalized[0].lon === -0.13 && normalized[0].connectors[1].kw === 50,
);
check(
  'name, postcode, network, operational status carried over',
  normalized[0].name === 'Q-Park Westminster' &&
    normalized[0].postcode === 'SW1P 4YB' &&
    normalized[0].network === 'ChargedEV' &&
    normalized[0].status === 'Operational' &&
    normalized[0].operational === true,
);
check('connection-less POI yields empty connectors', normalized[1].connectors.length === 0);
check('junk payload normalizes to empty', worker.normalizePois({ error: 'nope' }).length === 0);

const evq = worker.parseEvQuery(new URLSearchParams('lat=51.50744&lon=-0.12784&dist=99'));
check('ev query rounds coords to 3dp and clamps dist', evq.lat === 51.507 && evq.lon === -0.128 && evq.dist === 15);
check('ev query defaults dist to 5', worker.parseEvQuery(new URLSearchParams('lat=51.5&lon=-0.1')).dist === 5);
check('ev query rejects missing/invalid coords', worker.parseEvQuery(new URLSearchParams('lat=91&lon=0')) === null && worker.parseEvQuery(new URLSearchParams('lon=-0.1')) === null);

const envEv = { FUEL_KV: new MockKV(), OCM_API_KEY: 'test-key' };
let ocmCalls = 0;
let ocmKeyHeader = null;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith('https://api.openchargemap.io/')) {
    ocmCalls++;
    ocmKeyHeader = init?.headers?.['x-api-key'] ?? null;
    return Promise.resolve(new Response(JSON.stringify(ocmPayload), { status: 200 }));
  }
  return realFetch(url, init);
};
const evRes = await worker.handleRequest(new Request('https://x/ev?lat=51.5074&lon=-0.1278&dist=5'), envEv);
const evBody = await evRes.json();
check('/ev returns normalized chargepoints', evRes.status === 200 && evBody.count === 2 && evBody.cached === false);
check('/ev sends the OCM api key header', ocmKeyHeader === 'test-key');
const evRes2 = await worker.handleRequest(new Request('https://x/ev?lat=51.5071&lon=-0.1282&dist=5'), envEv);
const evBody2 = await evRes2.json();
check('nearby /ev query is served from KV cache', evBody2.cached === true && ocmCalls === 1);
check('/ev without coords is 400', (await worker.handleRequest(new Request('https://x/ev?dist=5'), envEv)).status === 400);
globalThis.fetch = () => Promise.reject(new Error('down'));
check('/ev is 502 when the registry is unreachable', (await worker.handleRequest(new Request('https://x/ev?lat=52&lon=-1'), envEv)).status === 502);
globalThis.fetch = realFetch;

// --- bad requests ---
check('/stations without bbox is 400', (await worker.handleRequest(new Request('https://x/stations'), env)).status === 400);
check('unknown path is 404', (await worker.handleRequest(new Request('https://x/nope'), env)).status === 404);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
