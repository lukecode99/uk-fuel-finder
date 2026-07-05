// Unit tests for the app's pure logic: sorting, cheapest-near-me, price-age
// formatting, geo maths. Bundles the .ts modules with esbuild, runs with
// node:test.
//
//   node test/run.mjs
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import assert from 'node:assert';

const outDir = mkdtempSync(join(tmpdir(), 'ff-app-test-'));
const root = join(import.meta.dirname, '..');
for (const mod of ['sort', 'format', 'geo']) {
  execSync(
    `npx esbuild src/${mod}.ts --bundle --format=esm --platform=node --outfile=${join(outDir, mod + '.mjs')}`,
    { cwd: root, stdio: 'pipe' },
  );
}
const { sortStations, cheapestNear } = await import(join(outDir, 'sort.mjs'));
const { formatAge, shortAge, ageIsStale, formatPrice, formatDistance } = await import(join(outDir, 'format.mjs'));
const { haversineMiles, bboxAround } = await import(join(outDir, 'geo.mjs'));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const st = (id, lat, lon, prices, age = '2026-07-05T10:00:00Z') => ({
  id, brand: id, address: '', postcode: '', lat, lon, prices, priceUpdatedAt: age, source: 't',
});

// Around central London (51.5, -0.12). B is cheapest E10, C cheapest B7.
const HOME = { lat: 51.5, lon: -0.12 };
const A = st('A', 51.501, -0.121, { E10: 152.9, B7: 168.9 });        // ~0.08 mi
const B = st('B', 51.52, -0.10, { E10: 148.9, B7: 170.9 });          // ~1.7 mi
const C = st('C', 51.55, -0.20, { E10: 155.9, B7: 160.9 });          // ~4.8 mi
const D = st('D', 51.6, -0.3, { E5: 171.9 });                         // ~10.4 mi, no E10/B7
const stations = [A, B, C, D];

console.log('sortStations');
test('price sort E10: B < A < C, priceless D last', () => {
  assert.deepEqual(sortStations(stations, 'E10', 'price', HOME).map(s => s.id), ['B', 'A', 'C', 'D']);
});
test('toggling fuel to B7 re-sorts: C < A < B, D last', () => {
  assert.deepEqual(sortStations(stations, 'B7', 'price', HOME).map(s => s.id), ['C', 'A', 'B', 'D']);
});
test('distance sort ignores prices: A < B < C < D', () => {
  assert.deepEqual(sortStations(stations, 'E10', 'distance', HOME).map(s => s.id), ['A', 'B', 'C', 'D']);
});
test('price tie breaks by distance', () => {
  const E = st('E', 51.502, -0.122, { E10: 148.9 }); // same price as B, much closer
  assert.deepEqual(sortStations([B, E], 'E10', 'price', HOME).map(s => s.id), ['E', 'B']);
});
test('input array is not mutated', () => {
  const copy = [...stations];
  sortStations(stations, 'E10', 'price', HOME);
  assert.deepEqual(stations, copy);
});

console.log('cheapestNear');
test('cheapest E10 within 5 mi is B (C dearer, D out of range/priceless)', () => {
  assert.equal(cheapestNear(stations, 'E10', HOME, 5).id, 'B');
});
test('cheapest B7 within 5 mi is C', () => {
  assert.equal(cheapestNear(stations, 'B7', HOME, 5).id, 'C');
});
test('radius excludes far stations: cheapest E10 within 1 mi is A', () => {
  assert.equal(cheapestNear(stations, 'E10', HOME, 1).id, 'A');
});
test('no station with that fuel in range → null', () => {
  assert.equal(cheapestNear([D], 'E10', HOME, 50), null);
});

console.log('formatAge');
const now = new Date('2026-07-05T12:00:00Z');
test('just now under 1 min', () => {
  assert.equal(formatAge('2026-07-05T11:59:30Z', now), 'updated just now');
});
test('12 min ago', () => {
  assert.equal(formatAge('2026-07-05T11:48:00Z', now), 'updated 12 min ago');
});
test('singular hour', () => {
  assert.equal(formatAge('2026-07-05T10:30:00Z', now), 'updated 1 hr ago');
});
test('plural hours', () => {
  assert.equal(formatAge('2026-07-05T08:00:00Z', now), 'updated 4 hrs ago');
});
test('days', () => {
  assert.equal(formatAge('2026-07-03T11:00:00Z', now), 'updated 2 days ago');
});
test('short forms', () => {
  assert.equal(shortAge('2026-07-05T11:48:00Z', now), '12m');
  assert.equal(shortAge('2026-07-05T08:00:00Z', now), '4h');
  assert.equal(shortAge('2026-07-02T08:00:00Z', now), '3d');
});
test('stale flag flips after 24h', () => {
  assert.equal(ageIsStale('2026-07-05T08:00:00Z', now), false);
  assert.equal(ageIsStale('2026-07-03T08:00:00Z', now), true);
});

console.log('format');
test('price formatting', () => {
  assert.equal(formatPrice(152.9), '152.9p');
  assert.equal(formatPrice(undefined), '—');
});
test('distance formatting', () => {
  assert.equal(formatDistance(1.234), '1.2 mi');
  assert.equal(formatDistance(0.05), 'nearby');
});

console.log('geo');
test('haversine: London→Brighton ≈ 47 mi', () => {
  const d = haversineMiles({ lat: 51.5074, lon: -0.1278 }, { lat: 50.8225, lon: -0.1372 });
  assert.ok(Math.abs(d - 47.3) < 1.5, `got ${d}`);
});
test('bboxAround contains the centre and is symmetric', () => {
  const [w, s, e, n] = bboxAround(HOME, 5);
  assert.ok(w < HOME.lon && e > HOME.lon && s < HOME.lat && n > HOME.lat);
  assert.ok(Math.abs((e - HOME.lon) - (HOME.lon - w)) < 1e-9);
  assert.ok(Math.abs((n - s) / 2 - 5 / 69) < 1e-9);
});



// --- FF-3: route corridor + worth-the-detour verdict ------------------------
execSync(
  `npx esbuild src/route.ts --bundle --format=esm --platform=node --outfile=${join(outDir, 'route.mjs')}`,
  { cwd: root, stdio: 'pipe' },
);
const {
  distanceToRouteMiles, detourMilesFor, detourMinutesFor, detourVerdict,
  buildCorridor, ROAD_FACTOR, DETOUR_SPEED_MPH, DEFAULT_LITRES_PER_MILE,
} = await import(join(outDir, 'route.mjs'));

console.log('distanceToRouteMiles');
test('point on the route is ~0 miles off', () => {
  const route = [{ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: 0.1 }];
  assert.ok(distanceToRouteMiles({ lat: 51.5, lon: 0.0 }, route) < 0.01);
});
test('1/69 degree of latitude off a straight east-west route ≈ 1 mile', () => {
  const route = [{ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: 0.1 }];
  const d = distanceToRouteMiles({ lat: 51.5 + 1 / 69, lon: 0.0 }, route);
  assert.ok(Math.abs(d - 1) < 0.01, `got ${d}`);
});
test('beyond the segment end measures to the endpoint, not the extension', () => {
  const route = [{ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: 0.0 }];
  const d1 = distanceToRouteMiles({ lat: 51.5, lon: 0.1 }, route); // past the end
  const d2 = distanceToRouteMiles({ lat: 51.5, lon: 0.0 }, route); // at the end
  assert.ok(d1 > 3 && d2 < 0.01, `got ${d1}, ${d2}`);
});

console.log('detour model');
test('detour miles = 2 × off-route × road factor 1.4', () => {
  assert.ok(Math.abs(detourMilesFor(1) - 2.8) < 1e-9);
  assert.equal(ROAD_FACTOR, 1.4);
});
test('detour minutes at 25 mph: 1 mi off-route → 6.72 min', () => {
  assert.ok(Math.abs(detourMinutesFor(1) - (2.8 / 25) * 60) < 1e-9);
  assert.equal(DETOUR_SPEED_MPH, 25);
});

console.log('detourVerdict — hand-computed worked examples (on the Trello card)');
test('worked example 1: 5p cheaper, 40L fill, 1 mi detour → net +£1.83, worth it', () => {
  // saving = (150.0 − 145.0) × 40 / 100 = £2.00
  // detour fuel = 1.0 mi × 0.114 L/mi × 145.0 p/L / 100 = £0.1653
  // net = 2.00 − 0.1653 = £1.8347 → worth it
  const v = detourVerdict({ baselinePence: 150.0, stationPence: 145.0, litresToFill: 40, detourMiles: 1.0 });
  assert.equal(v.savingPounds.toFixed(2), '2.00');
  assert.equal(v.detourFuelPounds.toFixed(4), '0.1653');
  assert.equal(v.netPounds.toFixed(2), '1.83');
  assert.equal(v.worthIt, true);
});
test('worked example 2: 0.5p cheaper, 30L fill, 4 mi detour → net −£0.53, NOT worth it', () => {
  // saving = (150.0 − 149.5) × 30 / 100 = £0.15
  // detour fuel = 4 × 0.114 × 149.5 / 100 = £0.6817
  // net = 0.15 − 0.6817 = −£0.5317 → not worth it
  const v = detourVerdict({ baselinePence: 150.0, stationPence: 149.5, litresToFill: 30, detourMiles: 4 });
  assert.equal(v.savingPounds.toFixed(2), '0.15');
  assert.equal(v.detourFuelPounds.toFixed(4), '0.6817');
  assert.equal(v.netPounds.toFixed(2), '-0.53');
  assert.equal(v.worthIt, false);
});
test('dearer station is never worth it even with zero detour', () => {
  const v = detourVerdict({ baselinePence: 150.0, stationPence: 151.0, litresToFill: 40, detourMiles: 0 });
  assert.equal(v.worthIt, false);
});
test('default consumption constant is 0.114 L/mile (~40 mpg)', () => {
  assert.equal(DEFAULT_LITRES_PER_MILE, 0.114);
});

console.log('buildCorridor');
// Straight east-west route along lat 51.5. Offsets in degrees of latitude:
// 1/69 deg = 1 mile off-route = 6.72 min detour.
const routeEW = [{ lat: 51.5, lon: -0.2 }, { lat: 51.5, lon: 0.2 }];
const onRouteCheap = st('onCheap', 51.5001, -0.1, { E10: 150.0 });   // ~0 off → baseline
const onRouteDear = st('onDear', 51.5001, 0.05, { E10: 152.0 });     // ~0 off, dearer
const nearSaver = st('nearSaver', 51.5 + 0.5 / 69, 0.0, { E10: 145.0 }); // 0.5 mi off → 3.36 min
const farStation = st('far', 51.5 + 2 / 69, 0.1, { E10: 140.0 });    // 2 mi off → 13.4 min, outside 5-min cap
const noFuel = st('noFuel', 51.5001, 0.0, { B7: 160.0 });            // no E10 price
const corridor = buildCorridor([farStation, nearSaver, onRouteDear, onRouteCheap, noFuel], routeEW, 'E10', 5, 40);

test('corridor only contains stations within the configured detour', () => {
  const ids = corridor.map(c => c.station.id);
  assert.ok(!ids.includes('far'), 'far station (13.4 min) must be excluded at 5-min cap');
  assert.ok(!ids.includes('noFuel'), 'stations without the selected fuel are excluded');
  assert.deepEqual(new Set(ids), new Set(['onCheap', 'onDear', 'nearSaver']));
});
test('baseline is the cheapest on-route station, listed first with no verdict', () => {
  assert.equal(corridor[0].station.id, 'onCheap');
  assert.equal(corridor[0].isBaseline, true);
  assert.equal(corridor[0].verdict, null);
});
test('cheaper near-route station gets a positive worth-it verdict', () => {
  const c = corridor.find(x => x.station.id === 'nearSaver');
  // off 0.5 mi → detour 1.4 mi; saving = 5p × 40L = £2.00; fuel = 1.4 × 0.114 × 145/100 = £0.2314
  assert.equal(c.verdict.worthIt, true);
  assert.equal(c.verdict.netPounds.toFixed(2), '1.77');
});
test('dearer on-route station shows explicitly not worth it', () => {
  const c = corridor.find(x => x.station.id === 'onDear');
  assert.equal(c.verdict.worthIt, false);
  assert.ok(c.verdict.netPounds < 0);
});
test('raising the cap to 15 min admits the far station', () => {
  const wide = buildCorridor([farStation, onRouteCheap], routeEW, 'E10', 15, 40);
  assert.ok(wide.some(c => c.station.id === 'far'));
});
test('no on-route station → smallest-detour station becomes baseline', () => {
  const c = buildCorridor([nearSaver, farStation], routeEW, 'E10', 15, 40);
  assert.equal(c[0].station.id, 'nearSaver');
  assert.equal(c[0].isBaseline, true);
});


// --- FF-4: price history, trends + fill-now signal ---------------------------
execSync(
  `npx esbuild src/history.ts --bundle --format=esm --platform=node --outfile=${join(outDir, 'history.mjs')}`,
  { cwd: root, stdio: 'pipe' },
);
const {
  computeTrend, areaSeries, fillNowSignal, sparkHeights, nearestWithFuel,
  STEADY_THRESHOLD_PENCE, RISING_SLOPE,
} = await import(join(outDir, 'history.mjs'));

const day = i => `2026-06-${String(21 + i).padStart(2, '0')}`; // 2026-06-21 .. 
const series = prices => prices.map((price, i) => ({ date: day(i), price }));

// Rising 0.5p/day over 7 days: 140.0 → 143.0
const rising = series([140.0, 140.5, 141.0, 141.5, 142.0, 142.5, 143.0]);
// Falling 0.4p/day over 7 days: 150.0 → 147.6
const falling = series([150.0, 149.6, 149.2, 148.8, 148.4, 148.0, 147.6]);
// Flat with 0.2p of noise — inside the steady band
const flat = series([145.9, 146.1, 145.9, 146.0, 145.9, 146.1, 146.0]);

test('trend direction matches rising data', () => {
  const t = computeTrend(rising);
  assert.equal(t.direction, 'rising');
  assert.equal(t.changePence.toFixed(1), '3.0');
  assert.ok(Math.abs(t.slopePencePerDay - 0.5) < 1e-9, `slope ${t.slopePencePerDay}`);
  assert.equal(t.days, 6);
});
test('trend direction matches falling data', () => {
  const t = computeTrend(falling);
  assert.equal(t.direction, 'falling');
  assert.ok(Math.abs(t.slopePencePerDay - -0.4) < 1e-9);
});
test('sub-threshold drift reads steady', () => {
  const t = computeTrend(flat);
  assert.equal(t.direction, 'steady');
  assert.ok(Math.abs(t.changePence) < STEADY_THRESHOLD_PENCE);
});
test('single point yields no trend', () => {
  assert.equal(computeTrend(series([146.9])), null);
  assert.equal(computeTrend([]), null);
});
test('trend handles gaps in the day sequence', () => {
  // 140p on day 0, 146p on day 6 — 1p/day even with days missing
  const gappy = [{ date: day(0), price: 140.0 }, { date: day(3), price: 143.0 }, { date: day(6), price: 146.0 }];
  const t = computeTrend(gappy);
  assert.ok(Math.abs(t.slopePencePerDay - 1.0) < 1e-9);
  assert.equal(t.days, 6);
});

test('area series averages stations per day', () => {
  const a = [{ date: day(0), price: 140.0 }, { date: day(1), price: 142.0 }];
  const b = [{ date: day(0), price: 150.0 }, { date: day(1), price: 152.0 }];
  const avg = areaSeries([a, b]);
  assert.deepEqual(avg.map(p => p.price), [145.0, 147.0]);
  assert.deepEqual(avg.map(p => p.date), [day(0), day(1)]);
});
test('area series tolerates stations missing days', () => {
  const a = [{ date: day(0), price: 140.0 }, { date: day(1), price: 141.0 }];
  const b = [{ date: day(1), price: 143.0 }];
  const avg = areaSeries([a, b]);
  assert.deepEqual(avg.map(p => p.price), [140.0, 142.0]);
});

test('fill-now signal fires on a rising trend and states the numbers', () => {
  const t = computeTrend(rising);
  const s = fillNowSignal(t, 'Petrol (E10)');
  assert.equal(s.action, 'fill-now');
  assert.ok(t.slopePencePerDay >= RISING_SLOPE);
  // the explanation must contain the actual numbers the rule used
  assert.ok(s.explanation.includes('140.0p'), s.explanation);
  assert.ok(s.explanation.includes('143.0p'), s.explanation);
  assert.ok(s.explanation.includes('+3.0p'), s.explanation);
  assert.ok(s.explanation.includes('0.5p/day'), s.explanation);
  assert.ok(s.explanation.includes('6 days'), s.explanation);
});
test('wait signal on a falling trend states the numbers', () => {
  const s = fillNowSignal(computeTrend(falling), 'Diesel (B7)');
  assert.equal(s.action, 'wait');
  assert.ok(s.explanation.includes('150.0p'));
  assert.ok(s.explanation.includes('147.6p'));
  assert.ok(s.explanation.includes('0.4p/day'));
});
test('steady trend yields a neutral signal', () => {
  const s = fillNowSignal(computeTrend(flat), 'Petrol (E10)');
  assert.equal(s.action, 'neutral');
});
test('no history yields an honest neutral signal', () => {
  const s = fillNowSignal(null, 'Petrol (E10)');
  assert.equal(s.action, 'neutral');
  assert.ok(/history/i.test(s.explanation));
});

test('spark heights normalise to 0..1 with flat mid-height', () => {
  assert.deepEqual(sparkHeights(series([140, 145, 150])), [0, 0.5, 1]);
  assert.deepEqual(sparkHeights(series([146.9, 146.9])), [0.5, 0.5]);
  assert.deepEqual(sparkHeights([]), []);
});

test('nearestWithFuel picks the N closest stations that price the fuel', () => {
  const sample = nearestWithFuel([A, B, C, D], 'E10', HOME, 2);
  assert.deepEqual(sample.map(s => s.id), ['A', 'B']); // D has no E10, C is farthest
});


// --- FF-5: alert subscription logic (pure module, no storage imports) ---------
execSync(
  `npx esbuild src/alerts.ts --bundle --format=esm --platform=node --outfile=${join(outDir, 'alerts.mjs')}`,
  { cwd: root, stdio: 'pipe' },
);
const {
  AREA_RADIUS_MILES,
  DEFAULT_PREFS,
  buildSubscribePayload,
  isValidQuietTime,
  toggleId,
} = await import(join(outDir, 'alerts.mjs'));

test('quiet time validator accepts HH:MM and rejects junk', () => {
  assert.ok(isValidQuietTime('21:00'));
  assert.ok(isValidQuietTime('07:30'));
  assert.ok(!isValidQuietTime('25:00'));
  assert.ok(!isValidQuietTime('9:00'));
  assert.ok(!isValidQuietTime('ab:cd'));
});

test('toggleId adds then removes', () => {
  assert.deepEqual(toggleId([], 'a'), ['a']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
});

test('subscribe payload carries token, fuel, favourites and default quiet hours', () => {
  const p = buildSubscribePayload('tok1', 'E10', ['asda:x', 'mfg:y'], DEFAULT_PREFS, HOME);
  assert.equal(p.token, 'tok1');
  assert.equal(p.fuel, 'E10');
  assert.deepEqual(p.favourites, ['asda:x', 'mfg:y']);
  assert.deepEqual(p.quiet, { start: '21:00', end: '07:00' });
});

test('area included when enabled with a location, at the 5 mi radius', () => {
  const p = buildSubscribePayload('tok1', 'E10', [], DEFAULT_PREFS, HOME);
  assert.deepEqual(p.area, { lat: HOME.lat, lon: HOME.lon, radiusMiles: AREA_RADIUS_MILES });
  assert.equal(AREA_RADIUS_MILES, 5);
});

test('area omitted when disabled or when no location', () => {
  const off = buildSubscribePayload('tok1', 'E10', [], { ...DEFAULT_PREFS, areaEnabled: false }, HOME);
  assert.equal(off.area, undefined);
  const noLoc = buildSubscribePayload('tok1', 'E10', [], DEFAULT_PREFS, null);
  assert.equal(noLoc.area, undefined);
});

test('invalid quiet hours fall back to 21:00–07:00', () => {
  const p = buildSubscribePayload(
    'tok1',
    'E10',
    [],
    { ...DEFAULT_PREFS, quietStart: '9pm', quietEnd: '26:99' },
    null,
  );
  assert.deepEqual(p.quiet, { start: '21:00', end: '07:00' });
});

// --- FF-6: widget deep links (fuelfinder://station/<id>) ----------------------
execSync(
  `npx esbuild src/deeplink.ts --bundle --format=esm --platform=node --outfile=${join(outDir, 'deeplink.mjs')}`,
  { cwd: root, stdio: 'pipe' },
);
const { parseStationDeepLink } = await import(join(outDir, 'deeplink.mjs'));

console.log('\nparseStationDeepLink');
test('plain id parses', () => {
  assert.equal(parseStationDeepLink('fuelfinder://station/abc123'), 'abc123');
});
test('percent-encoded source-prefixed id decodes (widget encodes the colon)', () => {
  assert.equal(
    parseStationDeepLink('fuelfinder://station/tesco%3A12345'),
    'tesco:12345',
  );
  assert.equal(parseStationDeepLink('fuelfinder://station/tesco:12345'), 'tesco:12345');
});
test('triple-slash form (station as path, not host) also parses', () => {
  assert.equal(parseStationDeepLink('fuelfinder:///station/abc'), 'abc');
});
test('non-station and malformed urls return null', () => {
  assert.equal(parseStationDeepLink('fuelfinder://settings'), null);
  assert.equal(parseStationDeepLink('fuelfinder://station/'), null);
  assert.equal(parseStationDeepLink('https://station/abc'), null);
  assert.equal(parseStationDeepLink('fuelfinder://station/%ZZ'), null);
  assert.equal(parseStationDeepLink(''), null);
});

// --- FF-7: affiliate layer + EV helpers (pure modules) -------------------------
for (const mod of ['affiliates', 'ev']) {
  execSync(
    `npx esbuild src/${mod}.ts --bundle --format=esm --platform=node --outfile=${join(outDir, mod + '.mjs')}`,
    { cwd: root, stdio: 'pipe' },
  );
}
const { AFFILIATE_CONFIG, MAX_LINKOUTS, affiliateLinks, appendLinkOut, awinDeepLink } =
  await import(join(outDir, 'affiliates.mjs'));
const { connectorSummary, maxKw, prettyConnector } = await import(join(outDir, 'ev.mjs'));

console.log('\naffiliates');
test('shipped config renders no links (all flags off)', () => {
  assert.deepEqual(affiliateLinks(), []);
  assert.deepEqual(affiliateLinks(AFFILIATE_CONFIG), []);
});
test('links render only when every id for the offer is set', () => {
  const full = {
    awinAffId: 'aff1',
    breakdownMid: 'm1',
    breakdownDest: 'https://partner.example/breakdown',
    insuranceMid: '',
    insuranceDest: '',
  };
  const links = affiliateLinks(full);
  assert.equal(links.length, 1);
  assert.equal(links[0].key, 'breakdown');
  assert.ok(links[0].url.startsWith('https://www.awin1.com/cread.php?awinmid=m1&awinaffid=aff1'));
});
test('partial config (mid without publisher id) renders nothing', () => {
  const partial = { ...AFFILIATE_CONFIG, breakdownMid: 'm1', breakdownDest: 'https://x' };
  assert.deepEqual(affiliateLinks(partial), []);
});
test('awin deeplink percent-encodes the destination', () => {
  const url = awinDeepLink('https://p.example/a?b=c&d=e', 'mid', 'aff');
  assert.ok(url.includes('ued=https%3A%2F%2Fp.example%2Fa%3Fb%3Dc%26d%3De'));
});
test('link-out log is newest-first and capped', () => {
  let log = [];
  for (let i = 0; i < MAX_LINKOUTS + 10; i++) {
    log = appendLinkOut(log, { timestamp: i, key: 'breakdown', stationId: null, url: 'u' });
  }
  assert.equal(log.length, MAX_LINKOUTS);
  assert.equal(log[0].timestamp, MAX_LINKOUTS + 9);
});

console.log('\nev helpers');
test('OCM connector names shorten to driver labels', () => {
  assert.equal(prettyConnector('Type 2 (Socket Only)'), 'Type 2');
  assert.equal(prettyConnector('CHAdeMO'), 'CHAdeMO');
  assert.equal(prettyConnector('CCS (Type 2)'), 'CCS');
  assert.equal(prettyConnector('BS1363 3 Pin 13 Amp'), '3-pin');
});
test('connector summary groups by type with count and fastest kW', () => {
  const s = connectorSummary([
    { type: 'Type 2 (Socket Only)', kw: 7 },
    { type: 'Type 2 (Tethered Connector)', kw: 22 },
    { type: 'CCS (Type 2)', kw: 50 },
  ]);
  assert.equal(s, 'Type 2 ×2 22kW · CCS 50kW');
});
test('maxKw ignores unknown outputs', () => {
  assert.equal(maxKw([{ type: 'a', kw: null }, { type: 'b', kw: 7.4 }]), 7.4);
  assert.equal(maxKw([{ type: 'a', kw: null }]), null);
});

console.log(`\n${passed} tests passed`);
