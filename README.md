# uk-fuel-finder

Cloudflare Worker that aggregates UK forecourt fuel prices and serves them as
GeoJSON for the Fuel Finder app.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /stations?bbox=minLng,minLat,maxLng,maxLat` | Stations in the box as a GeoJSON FeatureCollection. Each feature carries `prices` (pence/litre: E10, E5, B7 diesel, SDV super diesel), `brand`, `address`, `postcode`, `priceUpdatedAt` and `source`. Foreign members: `dataUpdatedAt`, `stale`, `count`, `excludedStale`. |
| `GET /status` | Coverage honesty: station counts (total + fresh), per-source health, last ingest time, whether the official API is live. |
| `GET /history?station=<siteId>` | Up to 14 days of daily price points for one station (feeds the price-trend view). |

Prices older than 14 days are excluded from `/stations` (count surfaced as
`excludedStale`). If ingest has not succeeded for over 30 minutes, responses
carry `stale: true` and keep serving the last-good data rather than erroring.

## Data sources

Primary (once registration completes): the official
[Fuel Finder](https://www.gov.uk/government/collections/fuel-finder) open data
API — statutory 30-minute price updates across all ~8,300 UK forecourts.
OAuth2 client-credentials with automatic token refresh is implemented in
`src/official.ts` and activates when `FF_CLIENT_ID`/`FF_CLIENT_SECRET` worker
secrets are set; a CSV bulk-download fallback hook (`FF_CSV_URL`) covers REST
outages. Endpoint paths are to be confirmed against the developer portal docs
(the portal was in maintenance when this was built).

Current ingest: retailer direct feeds from the CMA interim open-data scheme
(the scheme closed 1 May 2026 but most retailers still publish). This covers
the majors only — see `/status` for live coverage numbers. Feeds that stop
updating age out via the 14-day filter; a feed that fails to fetch carries its
last-good stations forward so one dead feed never blanks the map.

Ingest runs every 10 minutes on a cron trigger and writes two KV keys per run
(`latest` + the day's history key), staying well inside KV free-tier limits.

## Develop / deploy

```
npm install
npm test          # bundles the worker and runs a live-feed integration test
npx wrangler deploy
```

Set the KV namespace id in `wrangler.toml` before deploying. Secrets go in via
`wrangler secret put FF_CLIENT_ID` / `FF_CLIENT_SECRET` — never in this repo.

## App (`app/`)

Expo (React Native) app — map + list + cheapest-near-me. Same stack as
car-finance. `react-native-maps` with clustering on iOS/Android; the web
export (used for the gh-pages demo and local verification) swaps the map for
a fallback panel via `StationMap.web.tsx` and keeps the list fully working.

Every price shown — map marker, list row, cheapest banner, detail sheet —
carries its age via one canonical `PriceAge`/`formatAge` implementation.
No accounts, no signup, no ads.

```
cd app
npm install
npm test          # pure-logic tests (sorting, cheapest-near-me, price age, geo)
npm run typecheck
npm run build:web # static web export to app/dist
```
