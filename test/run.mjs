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

// --- bad requests ---
check('/stations without bbox is 400', (await worker.handleRequest(new Request('https://x/stations'), env)).status === 400);
check('unknown path is 404', (await worker.handleRequest(new Request('https://x/nope'), env)).status === 404);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
