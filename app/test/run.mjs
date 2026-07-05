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

console.log(`\n${passed} tests passed`);
