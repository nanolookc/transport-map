# Project Notes

## Backend (Elysia + Drizzle + Postgres via Bun SQL)
- Server: `backend/server.ts`
- DB client: `backend/db/client.ts` uses `drizzle-orm/bun-sql` and `SQL` from `bun`
- Schema: `backend/db/schema.ts`
- Retention: 30 days (snapshots + stop_visits)

### Polling
- External transit `/vehicles` is polled by backend:
  - 06:00–24:00: every 15s
  - 00:00–06:00: every 60s
- Latest vehicles cached in memory:
  - `latestVehiclesCache` + `latestVehiclesFetchedAt`
  - `/api/proxy/vehicles` returns `{ fetchedAt, vehicles }`
- Frontend fetches `/api/proxy/vehicles` every 20s.

### Static data refresh
- `routes`, `trips`, `stops`, `stop_times`, `shapes` refreshed every 6 hours.
- Caches rebuilt for trip->stop mapping and stop lookup.

### Analytics logic (stop schedule)
- We record a stop visit when a vehicle **exits** the stop zone:
  - Entry radius: 50m
  - Exit radius: 60m (hysteresis)
- Direction is respected using `trip_id` + `stop_times`:
  - Only stops belonging to the vehicle's `trip_id` are considered.
- Unknown routes are excluded from analytics (`route_id` not in `routes`).
- `/api/analytics/stop/:stopId` returns schedule:
  - For each route at the stop, for each "run order" (#1, #2, ...),
    compute p50/p90/p99 times across days.

### Endpoints
- `GET /api/health`
- `GET /api/proxy/:resource` where resource in
  `vehicles | routes | trips | stops | stop_times | shapes`
- `GET /api/analytics/stop/:stopId`
- `GET /api/analytics/route/:routeId` (legacy, route start stats)

## Frontend
- Main page: `src/pages/main.vue`
- Vehicles are shown from `/api/proxy/vehicles`
- `lastFetch` uses backend `fetchedAt`
- Selected vehicle is refreshed on each fetch
- Relative timestamps update every 10s (based on vehicle timestamp)
- Stop analytics UI uses `/api/analytics/stop/:stopId`

## Docker
- `docker-compose.yml` runs:
  - `moni-x` (nginx frontend)
  - `backend` (bun)
  - `db` (Postgres)
- Nginx proxies `/api/*` to backend (`docker/nginx.conf`).

## Scripts
- `npm run server` runs backend
- `npm run db:generate`, `npm run db:push` for migrations
