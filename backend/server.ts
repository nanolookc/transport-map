import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  routeDailyStats,
  routes,
  shapes,
  stopVisits,
  stopTimes,
  stops,
  trips,
  vehicleSnapshots,
} from "./db/schema";
import { db, sqlClient } from "./db/client";

type Vehicle = {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  speed: number;
  route_id: number;
  trip_id: string | null;
  vehicle_type: number;
  bike_accessible: string;
  wheelchair_accessible: string;
};

type Route = {
  agency_id: number;
  route_id: number;
  route_short_name: string;
  route_long_name: string;
  route_color: string;
  route_type: number;
  route_desc: string;
};

type Trip = {
  route_id: number;
  trip_id: string;
  trip_headsign: string;
  direction_id: number;
  block_id: number;
  shape_id: string;
};

type Stop = {
  stop_id: number;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  location_type: number;
  stop_code: string;
};

type StopTime = {
  trip_id: string;
  stop_id: number;
  stop_sequence: number;
  arrival_time?: string;
  departure_time?: string;
  stop_headsign?: string;
  pickup_type?: number;
  drop_off_type?: number;
  shape_dist_traveled?: number;
  timepoint?: number;
};

type ShapePoint = {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
  shape_dist_traveled?: number;
};

const TRANSIT_API_KEY = process.env.TRANSIT_API_KEY;
const TRANSIT_AGENCY_ID = process.env.TRANSIT_AGENCY_ID || "1";
const TRANSIT_BASE_URL = process.env.TRANSIT_API_BASE_URL;

if (!TRANSIT_API_KEY) {
  throw new Error("TRANSIT_API_KEY is not set");
}

if (!TRANSIT_BASE_URL) {
  throw new Error("TRANSIT_API_BASE_URL is not set");
}

const POLL_DAY_INTERVAL_MS = 15_000;
const POLL_NIGHT_INTERVAL_MS = 60_000;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 24;
const RETENTION_DAYS = 30;
const STOP_RADIUS_METERS = 50;
const STOP_EXIT_RADIUS_METERS = 60;

const headers = {
  "X-Agency-Id": TRANSIT_AGENCY_ID,
  Accept: "application/json",
  "X-API-KEY": TRANSIT_API_KEY,
};

let stopsCache: Stop[] = [];
let stopById = new Map<number, Stop>();
const stopInsideByVehicle = new Set<string>();
const tripByIdCache = new Map<
  string,
  { routeId: number; directionId: number }
>();
const stopIdsByTripId = new Map<string, Set<number>>();
let latestVehiclesCache: Vehicle[] = [];
let latestVehiclesFetchedAt: Date | null = null;

const getPollIntervalMs = (now = new Date()) => {
  const hour = now.getHours();
  if (hour >= DAY_START_HOUR && hour < DAY_END_HOUR) {
    return POLL_DAY_INTERVAL_MS;
  }
  return POLL_NIGHT_INTERVAL_MS;
};

const fetchJson = async <T>(path: string) => {
  if (!TRANSIT_BASE_URL) {
    throw new Error("Missing TRANSIT_API_BASE_URL");
  }
  const response = await fetch(`${TRANSIT_BASE_URL}/${path}`, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new Error(`Transit API error ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
};

const chunkedInsert = async <T>(
  table: AnyPgTable,
  rows: T[],
  chunkSize = 1000,
) => {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    if (batch.length === 0) continue;
    await db.insert(table).values(batch as never);
  }
};

const upsertRoutes = async (data: Route[]) => {
  if (data.length === 0) return;
  await db
    .insert(routes)
    .values(
      data.map((route) => ({
        routeId: route.route_id,
        agencyId: route.agency_id,
        routeShortName: route.route_short_name,
        routeLongName: route.route_long_name,
        routeColor: route.route_color,
        routeType: route.route_type,
        routeDesc: route.route_desc,
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: routes.routeId,
      set: {
        agencyId: sql`excluded.agency_id`,
        routeShortName: sql`excluded.route_short_name`,
        routeLongName: sql`excluded.route_long_name`,
        routeColor: sql`excluded.route_color`,
        routeType: sql`excluded.route_type`,
        routeDesc: sql`excluded.route_desc`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
};

const refreshStaticData = async () => {
  const [routesData, tripsData, stopsData, stopTimesData, shapesData] =
    await Promise.all([
      fetchJson<Route[]>("routes"),
      fetchJson<Trip[]>("trips"),
      fetchJson<Stop[]>("stops"),
      fetchJson<StopTime[]>("stop_times"),
      fetchJson<ShapePoint[]>("shapes"),
    ]);

  await db.delete(trips);
  await db.delete(stops);
  await db.delete(stopTimes);
  await db.delete(shapes);

  await upsertRoutes(routesData);
  await chunkedInsert(
    trips,
    tripsData.map((trip) => ({
      tripId: trip.trip_id,
      routeId: trip.route_id,
      tripHeadsign: trip.trip_headsign,
      directionId: trip.direction_id,
      blockId: trip.block_id,
      shapeId: trip.shape_id,
    })),
  );
  await chunkedInsert(
    stops,
    stopsData.map((stop) => ({
      stopId: stop.stop_id,
      stopName: stop.stop_name,
      stopLat: stop.stop_lat,
      stopLon: stop.stop_lon,
      locationType: stop.location_type,
      stopCode: stop.stop_code ?? "",
    })),
  );
  await loadStopsCache();
  await chunkedInsert(
    stopTimes,
    stopTimesData.map((stopTime) => ({
      tripId: stopTime.trip_id,
      stopId: stopTime.stop_id,
      stopSequence: stopTime.stop_sequence,
      arrivalTime: stopTime.arrival_time ?? null,
      departureTime: stopTime.departure_time ?? null,
      stopHeadsign: stopTime.stop_headsign ?? null,
      pickupType: stopTime.pickup_type ?? null,
      dropOffType: stopTime.drop_off_type ?? null,
      shapeDistTraveled: stopTime.shape_dist_traveled ?? null,
      timepoint: stopTime.timepoint ?? null,
    })),
  );
  await chunkedInsert(
    shapes,
    shapesData.map((shape) => ({
      shapeId: shape.shape_id,
      shapePtSequence: shape.shape_pt_sequence,
      shapePtLat: shape.shape_pt_lat,
      shapePtLon: shape.shape_pt_lon,
      shapeDistTraveled: shape.shape_dist_traveled ?? null,
    })),
  );
  buildStaticCaches(tripsData, stopsData, stopTimesData);
};

const loadStopsCache = async () => {
  const rows = await db.select().from(stops);
  stopsCache = rows.map((row) => ({
    stop_id: row.stopId,
    stop_name: row.stopName,
    stop_lat: row.stopLat,
    stop_lon: row.stopLon,
    location_type: row.locationType,
    stop_code: row.stopCode,
  }));
  stopById = new Map(stopsCache.map((stop) => [stop.stop_id, stop]));
};

const buildStaticCaches = (
  tripsData: Trip[],
  stopsData: Stop[],
  stopTimesData: StopTime[],
) => {
  stopsCache = stopsData;
  stopById = new Map(stopsData.map((stop) => [stop.stop_id, stop]));
  tripByIdCache.clear();
  stopIdsByTripId.clear();
  tripsData.forEach((trip) => {
    tripByIdCache.set(trip.trip_id, {
      routeId: trip.route_id,
      directionId: trip.direction_id,
    });
  });
  stopTimesData.forEach((stopTime) => {
    if (!stopIdsByTripId.has(stopTime.trip_id)) {
      stopIdsByTripId.set(stopTime.trip_id, new Set());
    }
    stopIdsByTripId.get(stopTime.trip_id)?.add(stopTime.stop_id);
  });
};

const upsertRouteDailyStats = async (fetchedAt: Date, vehicles: Vehicle[]) => {
  const byRoute = new Map<number, Date>();
  vehicles.forEach((vehicle) => {
    if (typeof vehicle.route_id !== "number") return;
    if (!byRoute.has(vehicle.route_id)) {
      byRoute.set(vehicle.route_id, fetchedAt);
    }
  });
  if (byRoute.size === 0) return;
  const day = fetchedAt.toISOString().slice(0, 10);
  await db
    .insert(routeDailyStats)
    .values(
      Array.from(byRoute.keys()).map((routeId) => ({
        day,
        routeId,
        firstSeenAt: fetchedAt,
        lastSeenAt: fetchedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [routeDailyStats.day, routeDailyStats.routeId],
      set: {
        firstSeenAt: sql`LEAST(${routeDailyStats.firstSeenAt}, EXCLUDED.first_seen_at)`,
        lastSeenAt: sql`GREATEST(${routeDailyStats.lastSeenAt}, EXCLUDED.last_seen_at)`,
      },
    });
};

const storeVehicleSnapshots = async (fetchedAt: Date, vehicles: Vehicle[]) => {
  if (vehicles.length === 0) return;
  await chunkedInsert(
    vehicleSnapshots,
    vehicles.map((vehicle) => ({
      fetchedAt,
      vehicleId: vehicle.id,
      routeId: vehicle.route_id ?? null,
      tripId: vehicle.trip_id ?? null,
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
      timestamp: vehicle.timestamp ? new Date(vehicle.timestamp) : null,
      speed: vehicle.speed ?? null,
      vehicleType: vehicle.vehicle_type ?? null,
      bikeAccessible: vehicle.bike_accessible ?? null,
      wheelchairAccessible: vehicle.wheelchair_accessible ?? null,
    })),
  );
};

const cleanupOldSnapshots = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  await db
    .delete(vehicleSnapshots)
    .where(sql`${vehicleSnapshots.fetchedAt} < ${cutoff}`);
  await db.delete(stopVisits).where(sql`${stopVisits.observedAt} < ${cutoff}`);
};

const toRadians = (value: number) => (value * Math.PI) / 180;
const haversineMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) => {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const recordStopVisits = async (fetchedAt: Date, vehicles: Vehicle[]) => {
  if (stopsCache.length === 0) return;
  const events: Array<{
    stopId: number;
    routeId: number | null;
    tripId: string | null;
    vehicleId: number;
    observedAt: Date;
    fetchedAt: Date;
    latitude: number;
    longitude: number;
    distanceMeters: number;
  }> = [];

  vehicles.forEach((vehicle) => {
    if (
      typeof vehicle.latitude !== "number" ||
      typeof vehicle.longitude !== "number" ||
      typeof vehicle.route_id !== "number"
    ) {
      return;
    }
    if (!vehicle.trip_id) {
      return;
    }
    const tripInfo = tripByIdCache.get(vehicle.trip_id);
    const allowedStops = stopIdsByTripId.get(vehicle.trip_id);
    if (!tripInfo || !allowedStops || allowedStops.size === 0) {
      return;
    }
    if (tripInfo.routeId !== vehicle.route_id) {
      return;
    }
    const observedAt = vehicle.timestamp
      ? new Date(vehicle.timestamp)
      : fetchedAt;
    const lat = vehicle.latitude;
    const lon = vehicle.longitude;
    Array.from(allowedStops).forEach((stopId) => {
      const stop = stopById.get(stopId);
      if (!stop) return;
      const key = `${vehicle.id}:${stop.stop_id}`;
      const wasInside = stopInsideByVehicle.has(key);
      if (wasInside) {
        const distance = haversineMeters(
          lat,
          lon,
          stop.stop_lat,
          stop.stop_lon,
        );
        if (distance > STOP_EXIT_RADIUS_METERS) {
          stopInsideByVehicle.delete(key);
          console.log(
            `Vehicle ${vehicle.id} (route ${vehicle.route_id}) exited stop ${stop.stop_name}`,
          );
          events.push({
            stopId: stop.stop_id,
            routeId: vehicle.route_id,
            tripId: vehicle.trip_id ?? null,
            vehicleId: vehicle.id,
            observedAt,
            fetchedAt,
            latitude: lat,
            longitude: lon,
            distanceMeters: distance,
          });
        }
        return;
      }

      const distance = haversineMeters(lat, lon, stop.stop_lat, stop.stop_lon);
      if (distance > STOP_RADIUS_METERS) return;
      stopInsideByVehicle.add(key);
      console.log(
        `Vehicle ${vehicle.id} (route ${vehicle.route_id}) entered stop ${stop.stop_name}`,
      );
    });
  });

  if (events.length === 0) return;
  await chunkedInsert(stopVisits, events);
  console.log(`Stop visits saved: ${events.length}`);
};

const pollVehicles = async () => {
  const fetchedAt = new Date();
  const vehicles = await fetchJson<Vehicle[]>("vehicles");
  latestVehiclesCache = vehicles;
  latestVehiclesFetchedAt = fetchedAt;
  await storeVehicleSnapshots(fetchedAt, vehicles);
  await upsertRouteDailyStats(fetchedAt, vehicles);
  await recordStopVisits(fetchedAt, vehicles);
};

const scheduleLoop = () => {
  const run = async () => {
    try {
      await pollVehicles();
    } catch (error) {
      console.error("Vehicle poll failed", error);
    } finally {
      const interval = getPollIntervalMs();
      setTimeout(run, interval);
    }
  };
  run();
};

const scheduleDailyCleanup = () => {
  const run = async () => {
    try {
      await cleanupOldSnapshots();
    } catch (error) {
      console.error("Cleanup failed", error);
    } finally {
      setTimeout(run, 24 * 60 * 60 * 1000);
    }
  };
  run();
};

const scheduleStaticRefresh = () => {
  const run = async () => {
    try {
      await refreshStaticData();
    } catch (error) {
      console.error("Static refresh failed", error);
    } finally {
      setTimeout(run, 6 * 60 * 60 * 1000);
    }
  };
  run();
};

const timeToMinutes = (date: Date) =>
  date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

const minutesToTime = (value: number) => {
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
};

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildPredictedTimes = (dayValues: number[][]) => {
  if (dayValues.length === 0) return [];
  const sortedDays = dayValues.map((values) =>
    values.slice().sort((a, b) => a - b),
  );
  const maxCount = sortedDays.reduce(
    (acc, values) => Math.max(acc, values.length),
    0,
  );
  const predicted: number[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const samples = sortedDays
      .filter((values) => values.length > i)
      .map((values) => values[i]);
    if (samples.length === 0) continue;
    const p50 = percentile(samples, 0.5);
    if (p50 !== null) {
      predicted.push(p50);
    }
  }
  return predicted;
};
const getRouteStartStats = async (routeId: number) => {
  const rows = await db
    .select({
      firstSeenAt: routeDailyStats.firstSeenAt,
    })
    .from(routeDailyStats)
    .where(sql`${routeDailyStats.routeId} = ${routeId}`)
    .limit(RETENTION_DAYS * 2);
  const values = rows
    .map((row) => row.firstSeenAt)
    .filter(Boolean)
    .map((value) => timeToMinutes(new Date(value)));
  if (values.length === 0) return null;
  const p50 = percentile(values, 0.5);
  const p90 = percentile(values, 0.9);
  const p99 = percentile(values, 0.99);
  return {
    samples: values.length,
    p50: p50 === null ? null : minutesToTime(p50),
    p90: p90 === null ? null : minutesToTime(p90),
    p99: p99 === null ? null : minutesToTime(p99),
  };
};

const app = new Elysia()
  .get("/api/health", () => ({ ok: true }))
  .get("/api/proxy/:resource", async ({ params }) => {
    const resource = params.resource;
    const allowed = new Set([
      "vehicles",
      "routes",
      "trips",
      "stops",
      "stop_times",
      "shapes",
    ]);
    if (!allowed.has(resource)) {
      return new Response("Not found", { status: 404 });
    }
    if (resource === "vehicles" && latestVehiclesCache.length > 0) {
      return Response.json({
        fetchedAt: latestVehiclesFetchedAt,
        vehicles: latestVehiclesCache,
      });
    }
    const data = await fetchJson(resource);
    return Response.json(data);
  })
  .get("/api/analytics/route/:routeId", async ({ params }) => {
    const routeId = Number(params.routeId);
    if (Number.isNaN(routeId)) {
      return new Response("Invalid route id", { status: 400 });
    }
    const stats = await getRouteStartStats(routeId);
    return Response.json({ routeId, stats });
  })
  .get("/api/analytics/stop/:stopId", async ({ params }) => {
    const stopId = Number(params.stopId);
    if (Number.isNaN(stopId)) {
      return new Response("Invalid stop id", { status: 400 });
    }
    const stop = await db
      .select()
      .from(stops)
      .where(sql`${stops.stopId} = ${stopId}`)
      .limit(1);
    if (stop.length === 0) {
      return new Response("Stop not found", { status: 404 });
    }
    const today = new Date();
    const dayKeys: Array<{ key: string; isToday: boolean }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dayKeys.push({ key: localDateKey(date), isToday: i === 0 });
    }
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - 6);
    const nowMinutes = timeToMinutes(today);

    const visits = await db
      .select({
        routeId: stopVisits.routeId,
        observedAt: stopVisits.observedAt,
      })
      .from(stopVisits)
      .where(
        sql`${stopVisits.stopId} = ${stopId} AND ${stopVisits.observedAt} >= ${cutoff} AND ${stopVisits.routeId} IS NOT NULL`,
      );

    const routeInfoRows = await db
      .select({
        routeId: routes.routeId,
        routeShortName: routes.routeShortName,
        routeLongName: routes.routeLongName,
        routeColor: routes.routeColor,
      })
      .from(routes);
    const routeInfoMap = new Map(
      routeInfoRows.map((row) => [row.routeId, row]),
    );

    const knownVisits = visits.filter((row) =>
      routeInfoMap.has(row.routeId as number),
    );
    const daySet = new Set(dayKeys.map((day) => day.key));
    const visitsByDay = new Map<
      string,
      Map<number, { times: number[]; predicted: boolean }>
    >();
    const historyByRoute = new Map<number, number[][]>();

    knownVisits.forEach((row) => {
      const dayKey = localDateKey(row.observedAt);
      if (!daySet.has(dayKey)) return;
      const routeId = row.routeId as number;
      const minutes = timeToMinutes(row.observedAt);
      if (!visitsByDay.has(dayKey)) {
        visitsByDay.set(dayKey, new Map());
      }
      const dayMap = visitsByDay.get(dayKey);
      if (!dayMap?.has(routeId)) {
        dayMap?.set(routeId, { times: [], predicted: false });
      }
      dayMap?.get(routeId)?.times.push(minutes);
    });

    dayKeys.forEach((day) => {
      if (day.isToday) return;
      const dayMap = visitsByDay.get(day.key);
      if (!dayMap) return;
      dayMap.forEach((value, routeId) => {
        if (!historyByRoute.has(routeId)) {
          historyByRoute.set(routeId, []);
        }
        historyByRoute
          .get(routeId)
          ?.push(value.times.slice().sort((a, b) => a - b));
      });
    });

    const predictedByRoute = new Map<number, number[]>();
    historyByRoute.forEach((values, routeId) => {
      predictedByRoute.set(routeId, buildPredictedTimes(values));
    });

    const days = dayKeys.map((day) => {
      const points: Array<{
        routeId: number;
        minutes: number[];
        predicted: boolean;
      }> = [];
      if (day.isToday) {
        const dayMap = visitsByDay.get(day.key);
        if (dayMap) {
          dayMap.forEach((value, routeId) => {
            if (value.times.length === 0) return;
            points.push({
              routeId,
              minutes: value.times.slice().sort((a, b) => a - b),
              predicted: false,
            });
          });
        }
        predictedByRoute.forEach((minutes, routeId) => {
          const future = minutes.filter((value) => value > nowMinutes);
          if (future.length === 0) return;
          points.push({ routeId, minutes: future, predicted: true });
        });
      } else {
        const dayMap = visitsByDay.get(day.key);
        if (dayMap) {
          dayMap.forEach((value, routeId) => {
            if (value.times.length === 0) return;
            points.push({
              routeId,
              minutes: value.times.slice().sort((a, b) => a - b),
              predicted: false,
            });
          });
        }
      }
      return {
        date: day.key,
        isToday: day.isToday,
        points,
      };
    });

    const routeIds = Array.from(
      new Set(knownVisits.map((row) => row.routeId as number)),
    );

    return Response.json({
      stop: stop[0],
      routes: routeIds
        .map((routeId) => ({
          routeId,
          routeShortName: routeInfoMap.get(routeId)?.routeShortName ?? null,
          routeLongName: routeInfoMap.get(routeId)?.routeLongName ?? null,
          routeColor: routeInfoMap.get(routeId)?.routeColor ?? null,
        }))
        .sort((a, b) =>
          String(a.routeShortName ?? a.routeId).localeCompare(
            String(b.routeShortName ?? b.routeId),
          ),
        ),
      days,
    });
  });

const port = Number(process.env.BACKEND_PORT || 3000);

app.listen(port);
console.log(`Backend listening on http://localhost:${port}`);

await refreshStaticData().catch((error) =>
  console.error("Initial static refresh failed", error),
);
await loadStopsCache().catch((error) =>
  console.error("Stops cache load failed", error),
);
scheduleLoop();
scheduleStaticRefresh();
scheduleDailyCleanup();

process.on("SIGINT", async () => {
  await sqlClient.close();
  process.exit(0);
});
