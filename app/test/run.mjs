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

console.log(`\n${passed} tests passed`);
