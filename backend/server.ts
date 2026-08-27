import { Elysia } from "elysia";
import { desc, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { buildAlignedPredictionMinutes } from "./predictions";
import {
  routeDailyStats,
  routes,
  shapes,
  stopSegmentStats,
  stopSegmentTravelTimes,
  stopVisits,
  stopTimes,
  stops,
  trips,
  vehicleLiveStates,
  vehicleProgressSamples,
  vehicleSnapshots,
} from "./db/schema";
import { db, sqlClient, writeDb, writeSqlClient } from "./db/client";

type Vehicle = {
  id: number;
  label: string;
  latitude: number | null;
  longitude: number | null;
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

type TripInfo = {
  routeId: number;
  directionId: number;
  shapeId: string;
};

type RouteInfo = {
  routeId: number;
  routeShortName: string;
  routeLongName: string;
  routeColor: string;
};

type ShapeGeometry = {
  shapeId: string;
  points: ShapePoint[];
  cumulativeMeters: number[];
  totalMeters: number;
};

type StopProjection = {
  stopId: number;
  stopSequence: number;
  shapeDistanceMeters: number;
  distanceFromShapeMeters: number;
};

type SegmentStat = {
  routeId: number;
  directionId: number;
  fromStopId: number;
  toStopId: number;
  dayType: string;
  hourOfDay: number;
  sampleCount: number;
  p50Seconds: number;
  p75Seconds: number;
  p90Seconds: number;
};

type Projection = {
  progressMeters: number;
  distanceFromShapeMeters: number;
  segmentIndex: number;
};

type VehicleLiveStatus =
  | "arriving"
  | "moving"
  | "stopped_on_route"
  | "waiting_at_terminal"
  | "arrived_terminal"
  | "off_route"
  | "stale"
  | "unknown";

type VehicleLiveState = {
  vehicleId: number;
  routeId: number | null;
  tripId: string | null;
  directionId: number | null;
  shapeId: string | null;
  fetchedAt: Date;
  vehicleTimestamp: Date | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  progressMeters: number | null;
  distanceFromShapeMeters: number | null;
  segmentIndex: number | null;
  status: VehicleLiveStatus;
  confidence: "high" | "medium" | "low";
  reason: string;
  effectiveSpeedMps: number | null;
};

type VehicleProgressSample = {
  fetchedAt: Date;
  vehicleTimestamp: Date | null;
  tripId: string | null;
  progressMeters: number | null;
  speedKmh: number | null;
  status: VehicleLiveStatus;
};

const TRANSIT_API_KEY = process.env.TRANSIT_API_KEY;
const TRANSIT_AGENCY_ID = process.env.TRANSIT_AGENCY_ID || "1";
const TRANSIT_BASE_URL = process.env.TRANSIT_API_BASE_URL;
const INGEST_ENABLED =
  (process.env.INGEST_ENABLED ?? "true").toLowerCase() === "true";

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
const LIVE_STALE_AFTER_MS = 2 * 60 * 1000;
const LIVE_OFF_ROUTE_METERS = 150;
const LIVE_TERMINAL_RADIUS_METERS = 120;
const LIVE_TERMINAL_PROGRESS_METERS = 220;
const LIVE_ARRIVING_METERS = 80;
const LIVE_STOPPED_KMH = 3;
const LIVE_MIN_SPEED_MPS = 1.5;
const LIVE_MAX_SPEED_MPS = 16;
const LIVE_HISTORY_LIMIT = 10;
const LIVE_PROGRESS_RETENTION_HOURS = 6;
const SEGMENT_STATS_MIN_SAMPLES = 5;
const SEGMENT_STATS_REFRESH_MS = 30 * 60 * 1000;
const PREDICTION_HISTORY_DAYS = 30;
const PREDICTION_MIN_SAME_WEEKDAY_DAYS = 3;

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
  TripInfo
>();
const stopIdsByTripId = new Map<string, Set<number>>();
const stopTimesByTripId = new Map<string, StopTime[]>();
const shapeGeometryById = new Map<string, ShapeGeometry>();
const stopProjectionsByTripId = new Map<string, StopProjection[]>();
const tripIdsByStopId = new Map<number, Set<string>>();
const routeInfoById = new Map<number, RouteInfo>();
const vehicleLiveStateById = new Map<number, VehicleLiveState>();
const vehicleProgressHistoryById = new Map<number, VehicleProgressSample[]>();
const segmentStatsByKey = new Map<string, SegmentStat>();
let latestVehiclesCache: Vehicle[] = [];
let latestVehiclesFetchedAt: Date | null = null;
let lastDbErrorAt: Date | null = null;
let lastDbErrorMessage: string | null = null;
let lastDbSuccessAt: Date | null = null;

const normalizeVehiclePosition = (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null };
  }

  if (
    latitude! < -90 ||
    latitude! > 90 ||
    longitude! < -180 ||
    longitude! > 180
  ) {
    return { latitude: null, longitude: null };
  }

  if (latitude === 0 && longitude === 0) {
    return { latitude: null, longitude: null };
  }

  return { latitude, longitude };
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const isLikelyDbError = (error: unknown) => {
  const message = toErrorMessage(error);
  return (
    message.includes("ERR_POSTGRES") ||
    message.includes("PostgresError") ||
    message.includes("Failed query")
  );
};

const markDbError = (error: unknown) => {
  if (!isLikelyDbError(error)) return;
  lastDbErrorAt = new Date();
  lastDbErrorMessage = toErrorMessage(error);
};

const markDbSuccess = () => {
  lastDbSuccessAt = new Date();
};

const checkDbHealth = async () => {
  try {
    await db.execute(sql`select 1`);
    markDbSuccess();
    return true;
  } catch (error) {
    markDbError(error);
    return false;
  }
};

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
  client: Pick<typeof db, "insert">,
  table: AnyPgTable,
  rows: T[],
  chunkSize = 1000,
) => {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    if (batch.length === 0) continue;
    await client.insert(table).values(batch as never);
  }
};

const upsertRoutes = async (
  client: Pick<typeof db, "insert">,
  data: Route[],
) => {
  if (data.length === 0) return;
  await client
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

type StaticRefreshProgress = {
  phase: string;
};

type StaticRefreshResult = {
  routes: number;
  trips: number;
  stops: number;
  stopTimes: number;
  shapes: number;
};

const refreshStaticData = async (progress?: StaticRefreshProgress): Promise<StaticRefreshResult> => {
  if (progress) progress.phase = "fetching upstream data";
  const [routesData, tripsData, stopsData, stopTimesData, shapesData] =
    await Promise.all([
      fetchJson<Route[]>("routes"),
      fetchJson<Trip[]>("trips"),
      fetchJson<Stop[]>("stops"),
      fetchJson<StopTime[]>("stop_times"),
      fetchJson<ShapePoint[]>("shapes"),
    ]);

  if (progress) progress.phase = "replacing static data";
  await db.transaction(async (tx) => {
    await tx.delete(trips);
    await tx.delete(stops);
    await tx.delete(stopTimes);
    await tx.delete(shapes);

    await upsertRoutes(tx, routesData);
    await chunkedInsert(
      tx,
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
      tx,
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
    await chunkedInsert(
      tx,
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
      tx,
      shapes,
      shapesData.map((shape) => ({
        shapeId: shape.shape_id,
        shapePtSequence: shape.shape_pt_sequence,
        shapePtLat: shape.shape_pt_lat,
        shapePtLon: shape.shape_pt_lon,
        shapeDistTraveled: shape.shape_dist_traveled ?? null,
      })),
    );
  });
  if (progress) progress.phase = "rebuilding caches";
  buildStaticCaches(routesData, tripsData, stopsData, stopTimesData, shapesData);
  return {
    routes: routesData.length,
    trips: tripsData.length,
    stops: stopsData.length,
    stopTimes: stopTimesData.length,
    shapes: shapesData.length,
  };
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
  routesData: Route[],
  tripsData: Trip[],
  stopsData: Stop[],
  stopTimesData: StopTime[],
  shapesData: ShapePoint[],
) => {
  stopsCache = stopsData;
  stopById = new Map(stopsData.map((stop) => [stop.stop_id, stop]));
  routeInfoById.clear();
  tripByIdCache.clear();
  stopIdsByTripId.clear();
  stopTimesByTripId.clear();
  shapeGeometryById.clear();
  stopProjectionsByTripId.clear();
  tripIdsByStopId.clear();

  routesData.forEach((route) => {
    routeInfoById.set(route.route_id, {
      routeId: route.route_id,
      routeShortName: route.route_short_name,
      routeLongName: route.route_long_name,
      routeColor: route.route_color,
    });
  });

  tripsData.forEach((trip) => {
    tripByIdCache.set(trip.trip_id, {
      routeId: trip.route_id,
      directionId: trip.direction_id,
      shapeId: trip.shape_id,
    });
  });

  stopTimesData.forEach((stopTime) => {
    if (!stopIdsByTripId.has(stopTime.trip_id)) {
      stopIdsByTripId.set(stopTime.trip_id, new Set());
    }
    stopIdsByTripId.get(stopTime.trip_id)?.add(stopTime.stop_id);

    if (!stopTimesByTripId.has(stopTime.trip_id)) {
      stopTimesByTripId.set(stopTime.trip_id, []);
    }
    stopTimesByTripId.get(stopTime.trip_id)?.push(stopTime);

    if (!tripIdsByStopId.has(stopTime.stop_id)) {
      tripIdsByStopId.set(stopTime.stop_id, new Set());
    }
    tripIdsByStopId.get(stopTime.stop_id)?.add(stopTime.trip_id);
  });

  stopTimesByTripId.forEach((values) => {
    values.sort((a, b) => a.stop_sequence - b.stop_sequence);
  });

  const shapePointsById = new Map<string, ShapePoint[]>();
  shapesData.forEach((point) => {
    if (!shapePointsById.has(point.shape_id)) {
      shapePointsById.set(point.shape_id, []);
    }
    shapePointsById.get(point.shape_id)?.push(point);
  });

  shapePointsById.forEach((points, shapeId) => {
    points.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
    const cumulativeMeters: number[] = [];
    let totalMeters = 0;
    points.forEach((point, index) => {
      if (index === 0) {
        cumulativeMeters.push(0);
        return;
      }
      const previous = points[index - 1]!;
      totalMeters += haversineMeters(
        previous.shape_pt_lat,
        previous.shape_pt_lon,
        point.shape_pt_lat,
        point.shape_pt_lon,
      );
      cumulativeMeters.push(totalMeters);
    });
    shapeGeometryById.set(shapeId, {
      shapeId,
      points,
      cumulativeMeters,
      totalMeters,
    });
  });

  stopTimesByTripId.forEach((values, tripId) => {
    const tripInfo = tripByIdCache.get(tripId);
    if (!tripInfo) return;
    const geometry = shapeGeometryById.get(tripInfo.shapeId);
    if (!geometry) return;
    const projections = values
      .map((stopTime) => {
        const stop = stopById.get(stopTime.stop_id);
        if (!stop) return null;
        const projection = projectPointOnShape(
          stop.stop_lat,
          stop.stop_lon,
          geometry,
        );
        if (!projection) return null;
        return {
          stopId: stopTime.stop_id,
          stopSequence: stopTime.stop_sequence,
          shapeDistanceMeters: projection.progressMeters,
          distanceFromShapeMeters: projection.distanceFromShapeMeters,
        };
      })
      .filter((value): value is StopProjection => value !== null)
      .sort((a, b) => a.stopSequence - b.stopSequence);
    stopProjectionsByTripId.set(tripId, projections);
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
  await writeDb
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
    writeDb,
    vehicleSnapshots,
    vehicles.map((vehicle) => ({
      fetchedAt,
      vehicleId: vehicle.id,
      routeId: vehicle.route_id ?? null,
      tripId: vehicle.trip_id ?? null,
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
      timestamp: parseTimestamp(vehicle.timestamp),
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
  const progressCutoff = new Date();
  progressCutoff.setHours(
    progressCutoff.getHours() - LIVE_PROGRESS_RETENTION_HOURS,
  );
  await db
    .delete(vehicleSnapshots)
    .where(sql`${vehicleSnapshots.fetchedAt} < ${cutoff}`);
  await db.delete(stopVisits).where(sql`${stopVisits.observedAt} < ${cutoff}`);
  await db
    .delete(vehicleProgressSamples)
    .where(sql`${vehicleProgressSamples.fetchedAt} < ${progressCutoff}`);
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

const projectPointOnShape = (
  lat: number,
  lon: number,
  geometry: ShapeGeometry,
): Projection | null => {
  if (geometry.points.length === 0) return null;
  if (geometry.points.length === 1) {
    const only = geometry.points[0]!;
    return {
      progressMeters: 0,
      distanceFromShapeMeters: haversineMeters(
        lat,
        lon,
        only.shape_pt_lat,
        only.shape_pt_lon,
      ),
      segmentIndex: 0,
    };
  }

  const earthRadiusMeters = 6371000;
  const lat0 = toRadians(lat);
  const cosLat0 = Math.cos(lat0);
  const pointX = toRadians(lon) * cosLat0 * earthRadiusMeters;
  const pointY = toRadians(lat) * earthRadiusMeters;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestProgressMeters = 0;
  let bestSegmentIndex = 0;

  for (let index = 0; index < geometry.points.length - 1; index += 1) {
    const start = geometry.points[index]!;
    const end = geometry.points[index + 1]!;
    const startX = toRadians(start.shape_pt_lon) * cosLat0 * earthRadiusMeters;
    const startY = toRadians(start.shape_pt_lat) * earthRadiusMeters;
    const endX = toRadians(end.shape_pt_lon) * cosLat0 * earthRadiusMeters;
    const endY = toRadians(end.shape_pt_lat) * earthRadiusMeters;
    const dx = endX - startX;
    const dy = endY - startY;
    const segmentLengthSq = dx * dx + dy * dy;
    let t = 0;
    if (segmentLengthSq > 0) {
      t = ((pointX - startX) * dx + (pointY - startY) * dy) / segmentLengthSq;
      t = Math.max(0, Math.min(1, t));
    }
    const projectedX = startX + t * dx;
    const projectedY = startY + t * dy;
    const distanceX = pointX - projectedX;
    const distanceY = pointY - projectedY;
    const distanceSq = distanceX * distanceX + distanceY * distanceY;
    if (distanceSq < bestDistanceSq) {
      const segmentMeters =
        geometry.cumulativeMeters[index + 1]! -
        geometry.cumulativeMeters[index]!;
      bestDistanceSq = distanceSq;
      bestProgressMeters = geometry.cumulativeMeters[index]! + t * segmentMeters;
      bestSegmentIndex = index;
    }
  }

  return {
    progressMeters: bestProgressMeters,
    distanceFromShapeMeters: Math.sqrt(bestDistanceSq),
    segmentIndex: bestSegmentIndex,
  };
};

const loadStaticCachesFromDb = async () => {
  const [routeRows, tripRows, stopRows, stopTimeRows, shapeRows] =
    await Promise.all([
      db.select().from(routes),
      db.select().from(trips),
      db.select().from(stops),
      db.select().from(stopTimes),
      db.select().from(shapes),
    ]);

  buildStaticCaches(
    routeRows.map((route) => ({
      agency_id: route.agencyId,
      route_id: route.routeId,
      route_short_name: route.routeShortName,
      route_long_name: route.routeLongName,
      route_color: route.routeColor,
      route_type: route.routeType,
      route_desc: route.routeDesc,
    })),
    tripRows.map((trip) => ({
      route_id: trip.routeId,
      trip_id: trip.tripId,
      trip_headsign: trip.tripHeadsign,
      direction_id: trip.directionId,
      block_id: trip.blockId,
      shape_id: trip.shapeId,
    })),
    stopRows.map((stop) => ({
      stop_id: stop.stopId,
      stop_name: stop.stopName,
      stop_lat: stop.stopLat,
      stop_lon: stop.stopLon,
      location_type: stop.locationType,
      stop_code: stop.stopCode,
    })),
    stopTimeRows.map((stopTime) => ({
      trip_id: stopTime.tripId,
      stop_id: stopTime.stopId,
      stop_sequence: stopTime.stopSequence,
      arrival_time: stopTime.arrivalTime ?? undefined,
      departure_time: stopTime.departureTime ?? undefined,
      stop_headsign: stopTime.stopHeadsign ?? undefined,
      pickup_type: stopTime.pickupType ?? undefined,
      drop_off_type: stopTime.dropOffType ?? undefined,
      shape_dist_traveled: stopTime.shapeDistTraveled ?? undefined,
      timepoint: stopTime.timepoint ?? undefined,
    })),
    shapeRows.map((shape) => ({
      shape_id: shape.shapeId,
      shape_pt_lat: shape.shapePtLat,
      shape_pt_lon: shape.shapePtLon,
      shape_pt_sequence: shape.shapePtSequence,
      shape_dist_traveled: shape.shapeDistTraveled ?? undefined,
    })),
  );
};

const ensureStaticCachesLoaded = async () => {
  if (
    stopsCache.length > 0 &&
    tripByIdCache.size > 0 &&
    shapeGeometryById.size > 0 &&
    stopProjectionsByTripId.size > 0
  ) {
    return;
  }
  await loadStaticCachesFromDb();
};

const parseTimestamp = (ts: string | undefined | null): Date | null => {
  if (!ts) return null;
  // If timestamp doesn't end with Z or timezone, assume UTC and add Z
  const isoTimestamp = /^[0-9TZ.:+-]+$/.test(ts) && (ts.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(ts))
    ? ts
    : `${ts}Z`;
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getLatestVehiclesSnapshotFromDb = async () => {
  const latest = await db
    .select({ fetchedAt: vehicleSnapshots.fetchedAt })
    .from(vehicleSnapshots)
    .orderBy(desc(vehicleSnapshots.fetchedAt))
    .limit(1);
  const fetchedAt = latest[0]?.fetchedAt ?? null;
  if (!fetchedAt) return null;
  const rows = await db
    .select({
      vehicleId: vehicleSnapshots.vehicleId,
      routeId: vehicleSnapshots.routeId,
      tripId: vehicleSnapshots.tripId,
      latitude: vehicleSnapshots.latitude,
      longitude: vehicleSnapshots.longitude,
      timestamp: vehicleSnapshots.timestamp,
      speed: vehicleSnapshots.speed,
      vehicleType: vehicleSnapshots.vehicleType,
      bikeAccessible: vehicleSnapshots.bikeAccessible,
      wheelchairAccessible: vehicleSnapshots.wheelchairAccessible,
    })
    .from(vehicleSnapshots)
    .where(sql`${vehicleSnapshots.fetchedAt} = ${fetchedAt}`);
  const vehicles = rows.map((row) => ({
    ...normalizeVehiclePosition(row.latitude, row.longitude),
    id: row.vehicleId,
    label: String(row.vehicleId),
    timestamp: (row.timestamp ?? fetchedAt).toISOString(),
    speed: row.speed ?? 0,
    route_id: row.routeId ?? -1,
    trip_id: row.tripId,
    vehicle_type: row.vehicleType ?? 0,
    bike_accessible: row.bikeAccessible ?? "",
    wheelchair_accessible: row.wheelchairAccessible ?? "",
  }));
  return { fetchedAt, vehicles };
};

const loadLatestVehiclesSnapshotCache = async () => {
  const latest = await getLatestVehiclesSnapshotFromDb();
  if (!latest) return false;
  latestVehiclesFetchedAt = latest.fetchedAt;
  latestVehiclesCache = latest.vehicles;
  updateLiveVehicleStates(latest.fetchedAt, latest.vehicles);
  return latestVehiclesCache.length > 0;
};

const getRecentProgressSpeedMps = (
  vehicleId: number,
  tripId: string | null,
  progressMeters: number | null,
  now: Date,
) => {
  if (!tripId || progressMeters === null) return null;
  const history = vehicleProgressHistoryById.get(vehicleId) ?? [];
  const candidates = history
    .filter(
      (sample) =>
        sample.tripId === tripId &&
        sample.progressMeters !== null &&
        now.getTime() - sample.fetchedAt.getTime() <= 5 * 60 * 1000,
    )
    .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const previous = candidates[0];
  if (!previous || previous.progressMeters === null) return null;
  const elapsedSeconds =
    (now.getTime() - previous.fetchedAt.getTime()) / 1000;
  if (elapsedSeconds < 20) return null;
  const progressDelta = progressMeters - previous.progressMeters;
  if (progressDelta <= 0) return null;
  return progressDelta / elapsedSeconds;
};

const appendVehicleProgressSample = (
  vehicleId: number,
  sample: VehicleProgressSample,
) => {
  const history = vehicleProgressHistoryById.get(vehicleId) ?? [];
  history.push(sample);
  if (history.length > LIVE_HISTORY_LIMIT) {
    history.splice(0, history.length - LIVE_HISTORY_LIMIT);
  }
  vehicleProgressHistoryById.set(vehicleId, history);
};

const upsertLiveVehicleStates = async (states: VehicleLiveState[]) => {
  if (states.length === 0) return;
  const updatedAt = new Date();
  for (let i = 0; i < states.length; i += 500) {
    const batch = states.slice(i, i + 500);
    await writeDb
      .insert(vehicleLiveStates)
      .values(
        batch.map((state) => ({
          vehicleId: state.vehicleId,
          routeId: state.routeId,
          tripId: state.tripId,
          directionId: state.directionId,
          shapeId: state.shapeId,
          fetchedAt: state.fetchedAt,
          vehicleTimestamp: state.vehicleTimestamp,
          latitude: state.latitude,
          longitude: state.longitude,
          speedKmh: state.speedKmh,
          progressMeters: state.progressMeters,
          distanceFromShapeMeters: state.distanceFromShapeMeters,
          segmentIndex: state.segmentIndex,
          status: state.status,
          confidence: state.confidence,
          reason: state.reason,
          effectiveSpeedMps: state.effectiveSpeedMps,
          updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: vehicleLiveStates.vehicleId,
        set: {
          routeId: sql`excluded.route_id`,
          tripId: sql`excluded.trip_id`,
          directionId: sql`excluded.direction_id`,
          shapeId: sql`excluded.shape_id`,
          fetchedAt: sql`excluded.fetched_at`,
          vehicleTimestamp: sql`excluded.vehicle_timestamp`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          speedKmh: sql`excluded.speed_kmh`,
          progressMeters: sql`excluded.progress_meters`,
          distanceFromShapeMeters: sql`excluded.distance_from_shape_meters`,
          segmentIndex: sql`excluded.segment_index`,
          status: sql`excluded.status`,
          confidence: sql`excluded.confidence`,
          reason: sql`excluded.reason`,
          effectiveSpeedMps: sql`excluded.effective_speed_mps`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  await db
    .delete(vehicleLiveStates)
    .where(sql`${vehicleLiveStates.updatedAt} < ${updatedAt}`);
};

const insertProgressSamples = async (states: VehicleLiveState[]) => {
  if (states.length === 0) return;
  await chunkedInsert(
    writeDb,
    vehicleProgressSamples,
    states.map((state) => ({
      vehicleId: state.vehicleId,
      routeId: state.routeId,
      tripId: state.tripId,
      fetchedAt: state.fetchedAt,
      vehicleTimestamp: state.vehicleTimestamp,
      progressMeters: state.progressMeters,
      speedKmh: state.speedKmh,
      status: state.status,
    })),
    500,
  );
};

const persistLiveStateSnapshot = async (states: VehicleLiveState[]) => {
  await upsertLiveVehicleStates(states);
  await insertProgressSamples(states);
};

const rowToLiveState = (row: typeof vehicleLiveStates.$inferSelect) => ({
  vehicleId: row.vehicleId,
  routeId: row.routeId,
  tripId: row.tripId,
  directionId: row.directionId,
  shapeId: row.shapeId,
  fetchedAt: row.fetchedAt,
  vehicleTimestamp: row.vehicleTimestamp,
  latitude: row.latitude,
  longitude: row.longitude,
  speedKmh: row.speedKmh,
  progressMeters: row.progressMeters,
  distanceFromShapeMeters: row.distanceFromShapeMeters,
  segmentIndex: row.segmentIndex,
  status: row.status as VehicleLiveStatus,
  confidence: row.confidence as "high" | "medium" | "low",
  reason: row.reason,
  effectiveSpeedMps: row.effectiveSpeedMps,
});

const loadPersistedLiveStates = async () => {
  const rows = await db.select().from(vehicleLiveStates);
  vehicleLiveStateById.clear();
  rows.forEach((row) => {
    const state = rowToLiveState(row);
    vehicleLiveStateById.set(state.vehicleId, state);
  });
  return rows.length;
};

const loadRecentProgressSamples = async () => {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - 10);
  const rows = await db
    .select()
    .from(vehicleProgressSamples)
    .where(sql`${vehicleProgressSamples.fetchedAt} >= ${cutoff}`)
    .orderBy(vehicleProgressSamples.fetchedAt);
  vehicleProgressHistoryById.clear();
  rows.forEach((row) => {
    appendVehicleProgressSample(row.vehicleId, {
      fetchedAt: row.fetchedAt,
      vehicleTimestamp: row.vehicleTimestamp,
      tripId: row.tripId,
      progressMeters: row.progressMeters,
      speedKmh: row.speedKmh,
      status: row.status as VehicleLiveStatus,
    });
  });
  return rows.length;
};

const getTripTerminalDistances = (tripId: string) => {
  const projections = stopProjectionsByTripId.get(tripId);
  if (!projections || projections.length === 0) return null;
  return {
    first: projections[0]!,
    last: projections[projections.length - 1]!,
  };
};

const classifyLiveVehicleState = (
  vehicle: Vehicle,
  fetchedAt: Date,
): VehicleLiveState => {
  const vehicleTimestamp = parseTimestamp(vehicle.timestamp);
  const base = {
    vehicleId: vehicle.id,
    routeId: Number.isFinite(vehicle.route_id) ? vehicle.route_id : null,
    tripId: vehicle.trip_id ?? null,
    fetchedAt,
    vehicleTimestamp,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    speedKmh: Number.isFinite(vehicle.speed) ? vehicle.speed : null,
  };

  const stale =
    !vehicleTimestamp ||
    fetchedAt.getTime() - vehicleTimestamp.getTime() > LIVE_STALE_AFTER_MS;
  if (stale) {
    return {
      ...base,
      directionId: null,
      shapeId: null,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "stale",
      confidence: "low",
      reason: "vehicle timestamp is stale",
      effectiveSpeedMps: null,
    };
  }

  if (typeof vehicle.latitude !== "number" || typeof vehicle.longitude !== "number") {
    return {
      ...base,
      directionId: null,
      shapeId: null,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "vehicle has no valid GPS position",
      effectiveSpeedMps: null,
    };
  }

  if (!vehicle.trip_id) {
    return {
      ...base,
      directionId: null,
      shapeId: null,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "vehicle has no trip_id",
      effectiveSpeedMps: null,
    };
  }

  const tripInfo = tripByIdCache.get(vehicle.trip_id);
  if (!tripInfo) {
    return {
      ...base,
      directionId: null,
      shapeId: null,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "trip_id is missing from static trips",
      effectiveSpeedMps: null,
    };
  }

  if (tripInfo.routeId !== vehicle.route_id) {
    return {
      ...base,
      directionId: tripInfo.directionId,
      shapeId: tripInfo.shapeId,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "vehicle route_id does not match trip route_id",
      effectiveSpeedMps: null,
    };
  }

  const geometry = shapeGeometryById.get(tripInfo.shapeId);
  if (!geometry) {
    return {
      ...base,
      directionId: tripInfo.directionId,
      shapeId: tripInfo.shapeId,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "shape is missing for trip",
      effectiveSpeedMps: null,
    };
  }

  const projection = projectPointOnShape(
    vehicle.latitude,
    vehicle.longitude,
    geometry,
  );
  if (!projection) {
    return {
      ...base,
      directionId: tripInfo.directionId,
      shapeId: tripInfo.shapeId,
      progressMeters: null,
      distanceFromShapeMeters: null,
      segmentIndex: null,
      status: "unknown",
      confidence: "low",
      reason: "could not project vehicle to shape",
      effectiveSpeedMps: null,
    };
  }

  const progressSpeedMps = getRecentProgressSpeedMps(
    vehicle.id,
    vehicle.trip_id,
    projection.progressMeters,
    fetchedAt,
  );
  const effectiveSpeedMps =
    progressSpeedMps !== null &&
    progressSpeedMps >= LIVE_MIN_SPEED_MPS &&
    progressSpeedMps <= LIVE_MAX_SPEED_MPS
      ? progressSpeedMps
      : null;
  const terminals = getTripTerminalDistances(vehicle.trip_id);
  const nearOrigin =
    terminals !== null &&
    projection.progressMeters <=
      terminals.first.shapeDistanceMeters + LIVE_TERMINAL_PROGRESS_METERS &&
    haversineMeters(
      vehicle.latitude,
      vehicle.longitude,
      stopById.get(terminals.first.stopId)?.stop_lat ?? vehicle.latitude,
      stopById.get(terminals.first.stopId)?.stop_lon ?? vehicle.longitude,
    ) <= LIVE_TERMINAL_RADIUS_METERS;
  const nearDestination =
    terminals !== null &&
    projection.progressMeters >=
      terminals.last.shapeDistanceMeters - LIVE_TERMINAL_PROGRESS_METERS &&
    haversineMeters(
      vehicle.latitude,
      vehicle.longitude,
      stopById.get(terminals.last.stopId)?.stop_lat ?? vehicle.latitude,
      stopById.get(terminals.last.stopId)?.stop_lon ?? vehicle.longitude,
    ) <= LIVE_TERMINAL_RADIUS_METERS;
  const isStopped = (vehicle.speed ?? 0) <= LIVE_STOPPED_KMH;

  let status: VehicleLiveStatus = "moving";
  let confidence: "high" | "medium" | "low" = "high";
  let reason = "vehicle is moving on its trip shape";

  if (projection.distanceFromShapeMeters > LIVE_OFF_ROUTE_METERS) {
    status = "off_route";
    confidence = "low";
    reason = "vehicle is too far from trip shape";
  } else if (nearDestination && isStopped) {
    status = "arrived_terminal";
    confidence = "low";
    reason = "vehicle is stopped at the destination terminal";
  } else if (nearOrigin && isStopped) {
    status = "waiting_at_terminal";
    confidence = "medium";
    reason = "vehicle is stopped at the origin terminal; departure is unknown";
  } else if (isStopped) {
    status = "stopped_on_route";
    confidence = "medium";
    reason = "vehicle is stopped on route";
  } else if (projection.distanceFromShapeMeters > LIVE_OFF_ROUTE_METERS / 2) {
    confidence = "medium";
    reason = "vehicle is moving but not tightly matched to shape";
  }

  return {
    ...base,
    directionId: tripInfo.directionId,
    shapeId: tripInfo.shapeId,
    progressMeters: projection.progressMeters,
    distanceFromShapeMeters: projection.distanceFromShapeMeters,
    segmentIndex: projection.segmentIndex,
    status,
    confidence,
    reason,
    effectiveSpeedMps:
      status === "off_route" || status === "arrived_terminal"
        ? null
        : effectiveSpeedMps,
  };
};

const updateLiveVehicleStates = (fetchedAt: Date, vehicles: Vehicle[]) => {
  const seenVehicleIds = new Set<number>();
  const states: VehicleLiveState[] = [];
  vehicles.forEach((vehicle) => {
    seenVehicleIds.add(vehicle.id);
    const state = classifyLiveVehicleState(vehicle, fetchedAt);
    vehicleLiveStateById.set(vehicle.id, state);
    states.push(state);
    appendVehicleProgressSample(vehicle.id, {
      fetchedAt,
      vehicleTimestamp: state.vehicleTimestamp,
      tripId: state.tripId,
      progressMeters: state.progressMeters,
      speedKmh: state.speedKmh,
      status: state.status,
    });
  });

  vehicleLiveStateById.forEach((_state, vehicleId) => {
    if (!seenVehicleIds.has(vehicleId)) {
      vehicleLiveStateById.delete(vehicleId);
    }
  });
  return states;
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
    const observedAt = parseTimestamp(vehicle.timestamp) ?? fetchedAt;
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
    });
  });

  if (events.length === 0) return;
  await chunkedInsert(writeDb, stopVisits, events);
};

const pollVehicles = async () => {
  const fetchedAt = new Date();
  const vehicles = (await fetchJson<Vehicle[]>("vehicles")).map((vehicle) => ({
    ...vehicle,
    ...normalizeVehiclePosition(vehicle.latitude, vehicle.longitude),
  }));
  // Normalize timestamps to ensure consistent timezone handling (assume UTC if no timezone info)
  latestVehiclesCache = vehicles.map((vehicle) => {
    if (!vehicle.timestamp) {
      return { ...vehicle, timestamp: '' };
    }
    const ts = vehicle.timestamp;
    // Check if already has timezone (Z or +HH:MM or -HH:MM)
    const hasTimezone = ts.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(ts);
    const normalizedTs = hasTimezone ? ts : `${ts}Z`;
    const date = new Date(normalizedTs);
    if (Number.isNaN(date.getTime())) {
      console.error(`Failed to parse timestamp: ${ts}`);
      return { ...vehicle, timestamp: '' };
    }
    return { ...vehicle, timestamp: date.toISOString() };
  });
  latestVehiclesFetchedAt = fetchedAt;
  const liveStates = updateLiveVehicleStates(fetchedAt, latestVehiclesCache);
  await storeVehicleSnapshots(fetchedAt, vehicles);
  await persistLiveStateSnapshot(liveStates);
  await upsertRouteDailyStats(fetchedAt, vehicles);
  await recordStopVisits(fetchedAt, vehicles);
};

const scheduleLoop = () => {
  const run = async () => {
    try {
      await pollVehicles();
    } catch (error) {
      markDbError(error);
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
      markDbSuccess();
    } catch (error) {
      markDbError(error);
      console.error("Cleanup failed", error);
    } finally {
      setTimeout(run, 24 * 60 * 60 * 1000);
    }
  };
  run();
};

const runStaticRefresh = async (trigger: "startup" | "scheduled") => {
  const startedAt = Date.now();
  const progress: StaticRefreshProgress = { phase: "starting" };
  try {
    const result = await refreshStaticData(progress);
    markDbSuccess();
    console.info("Static refresh completed", {
      trigger,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (error) {
    markDbError(error);
    console.error("Static refresh failed", {
      trigger,
      phase: progress.phase,
      durationMs: Date.now() - startedAt,
      error,
    });
  }
};

const scheduleStaticRefresh = () => {
  const run = async () => {
    try {
      await runStaticRefresh("scheduled");
    } finally {
      setTimeout(run, 6 * 60 * 60 * 1000);
    }
  };
  run();
};

const timeToMinutes = (date: Date) =>
  date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

const timeToIso = (date: Date) => date.toISOString();

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

const getDayType = (date: Date) => {
  const day = date.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
};

const getSegmentStatsKey = (
  routeId: number,
  directionId: number,
  fromStopId: number,
  toStopId: number,
  dayType: string,
  hourOfDay: number,
) =>
  [
    routeId,
    directionId,
    fromStopId,
    toStopId,
    dayType,
    hourOfDay,
  ].join(":");

const buildPredictedTimes = (dayValues: string[][]) => {
  if (dayValues.length === 0) return [];
  const sortedDays = dayValues.map((values) =>
    values
      .map((ts) => timeToMinutes(new Date(ts)))
      .filter((v) => !Number.isNaN(v))
      .sort((a, b) => a - b),
  );
  const predictedMinutes = buildAlignedPredictionMinutes(sortedDays);
  const today = new Date();
  const predicted: string[] = [];
  predictedMinutes.forEach((minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    const predictedDate = new Date(today);
    predictedDate.setHours(hours, mins, 0, 0);
    predicted.push(predictedDate.toISOString());
  });
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

const loadSegmentStatsCache = async () => {
  const rows = await db.select().from(stopSegmentStats);
  segmentStatsByKey.clear();
  rows.forEach((row) => {
    const stat = {
      routeId: row.routeId,
      directionId: row.directionId,
      fromStopId: row.fromStopId,
      toStopId: row.toStopId,
      dayType: row.dayType,
      hourOfDay: row.hourOfDay,
      sampleCount: row.sampleCount,
      p50Seconds: row.p50Seconds,
      p75Seconds: row.p75Seconds,
      p90Seconds: row.p90Seconds,
    };
    segmentStatsByKey.set(
      getSegmentStatsKey(
        stat.routeId,
        stat.directionId,
        stat.fromStopId,
        stat.toStopId,
        stat.dayType,
        stat.hourOfDay,
      ),
      stat,
    );
  });
  return rows.length;
};

const refreshSegmentTravelStats = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  await db.transaction(async (tx) => {
    await tx.delete(stopSegmentTravelTimes);
    await tx.execute(sql`
    insert into stop_segment_travel_times (
      route_id,
      direction_id,
      trip_id,
      vehicle_id,
      from_stop_id,
      to_stop_id,
      from_stop_sequence,
      to_stop_sequence,
      departed_at,
      arrived_at,
      travel_seconds,
      day_type,
      hour_of_day
    )
    with ordered as (
      select
        sv.vehicle_id,
        sv.trip_id,
        sv.stop_id,
        sv.observed_at,
        st.stop_sequence,
        t.route_id,
        t.direction_id,
        lead(sv.stop_id) over (
          partition by sv.vehicle_id, sv.trip_id
          order by sv.observed_at
        ) as next_stop_id,
        lead(sv.observed_at) over (
          partition by sv.vehicle_id, sv.trip_id
          order by sv.observed_at
        ) as next_observed_at,
        lead(st.stop_sequence) over (
          partition by sv.vehicle_id, sv.trip_id
          order by sv.observed_at
        ) as next_stop_sequence
      from stop_visits sv
      join trips t on t.trip_id = sv.trip_id
      join stop_times st
        on st.trip_id = sv.trip_id
       and st.stop_id = sv.stop_id
      where sv.observed_at >= ${cutoff}
        and sv.trip_id is not null
    )
    select
      route_id,
      direction_id,
      trip_id,
      vehicle_id,
      stop_id,
      next_stop_id,
      stop_sequence,
      next_stop_sequence,
      observed_at,
      next_observed_at,
      extract(epoch from (next_observed_at - observed_at))::integer,
      case
        when extract(isodow from (observed_at at time zone 'Europe/Bucharest')) in (6, 7)
          then 'weekend'
        else 'weekday'
      end,
      extract(hour from (observed_at at time zone 'Europe/Bucharest'))::integer
    from ordered
    where next_stop_id is not null
      and next_observed_at is not null
      and next_stop_sequence = stop_sequence + 1
      and extract(epoch from (next_observed_at - observed_at)) between 15 and 3600
    `);

    await tx.delete(stopSegmentStats);
    await tx.execute(sql`
    insert into stop_segment_stats (
      route_id,
      direction_id,
      from_stop_id,
      to_stop_id,
      day_type,
      hour_of_day,
      sample_count,
      p50_seconds,
      p75_seconds,
      p90_seconds,
      updated_at
    )
    select
      route_id,
      direction_id,
      from_stop_id,
      to_stop_id,
      day_type,
      hour_of_day,
      count(*)::integer,
      percentile_cont(0.5) within group (order by travel_seconds),
      percentile_cont(0.75) within group (order by travel_seconds),
      percentile_cont(0.9) within group (order by travel_seconds),
      now()
    from stop_segment_travel_times
    group by
      route_id,
      direction_id,
      from_stop_id,
      to_stop_id,
      day_type,
      hour_of_day
    having count(*) >= ${SEGMENT_STATS_MIN_SAMPLES}
    `);
  });

  const count = await loadSegmentStatsCache();
  console.log(`Segment stats refreshed: ${count} buckets`);
};

const ensureSegmentStatsLoaded = async () => {
  if (segmentStatsByKey.size > 0) return;
  await loadSegmentStatsCache();
};

const scheduleSegmentStatsRefresh = () => {
  const run = async () => {
    try {
      await refreshSegmentTravelStats();
      markDbSuccess();
    } catch (error) {
      markDbError(error);
      console.error("Segment stats refresh failed", error);
    } finally {
      setTimeout(run, SEGMENT_STATS_REFRESH_MS);
    }
  };
  setTimeout(run, 60_000);
};

const getLatestVehiclesForLive = async () => {
  if (!INGEST_ENABLED) {
    await loadRecentProgressSamples().catch((error) => {
      markDbError(error);
      console.error("Progress sample load failed", error);
    });
    const persistedCount = await loadPersistedLiveStates().catch((error) => {
      markDbError(error);
      console.error("Persisted live state load failed", error);
      return 0;
    });
    if (persistedCount > 0) {
      let fetchedAt: Date | null = null;
      vehicleLiveStateById.forEach((state) => {
        if (!fetchedAt || state.fetchedAt > fetchedAt) {
          fetchedAt = state.fetchedAt;
        }
      });
      if (fetchedAt) {
        latestVehiclesFetchedAt = fetchedAt;
        return { fetchedAt, vehicles: latestVehiclesCache };
      }
    }

    const latestFromDb = await getLatestVehiclesSnapshotFromDb();
    if (latestFromDb) {
      latestVehiclesFetchedAt = latestFromDb.fetchedAt;
      latestVehiclesCache = latestFromDb.vehicles;
      updateLiveVehicleStates(latestFromDb.fetchedAt, latestFromDb.vehicles);
    }
    return latestFromDb;
  }

  if (latestVehiclesCache.length === 0) {
    await loadLatestVehiclesSnapshotCache();
  }
  if (!latestVehiclesFetchedAt || latestVehiclesCache.length === 0) {
    return null;
  }
  return {
    fetchedAt: latestVehiclesFetchedAt,
    vehicles: latestVehiclesCache,
  };
};

const getSegmentStatForTime = (
  routeId: number,
  directionId: number,
  fromStopId: number,
  toStopId: number,
  at: Date,
) => {
  const dayType = getDayType(at);
  const hourOfDay = at.getHours();
  return segmentStatsByKey.get(
    getSegmentStatsKey(
      routeId,
      directionId,
      fromStopId,
      toStopId,
      dayType,
      hourOfDay,
    ),
  );
};

const computeStrictEtaToStop = ({
  state,
  routeId,
  directionId,
  projections,
  targetStop,
  fetchedAt,
}: {
  state: VehicleLiveState;
  routeId: number;
  directionId: number;
  projections: StopProjection[];
  targetStop: StopProjection;
  fetchedAt: Date;
}) => {
  if (state.progressMeters === null) {
    return {
      etaSeconds: null,
      arrivalAt: null,
      reason: "vehicle progress is unavailable",
      missingSegment: null,
    };
  }
  const remainingMeters = targetStop.shapeDistanceMeters - state.progressMeters;
  if (remainingMeters <= LIVE_ARRIVING_METERS) {
    return {
      etaSeconds: 0,
      arrivalAt: fetchedAt.toISOString(),
      reason: "vehicle is arriving at this stop",
      missingSegment: null,
    };
  }
  if (!state.effectiveSpeedMps) {
    return {
      etaSeconds: null,
      arrivalAt: null,
      reason: "not enough live progress samples for strict ETA",
      missingSegment: null,
    };
  }

  const currentIndex = projections.findIndex(
    (projection) => projection.shapeDistanceMeters >= state.progressMeters,
  );
  const targetIndex = projections.findIndex(
    (projection) =>
      projection.stopId === targetStop.stopId &&
      projection.stopSequence === targetStop.stopSequence,
  );
  if (targetIndex < 0) {
    return {
      etaSeconds: null,
      arrivalAt: null,
      reason: "target stop is missing from trip projections",
      missingSegment: null,
    };
  }
  const nextStopIndex = currentIndex < 0 ? targetIndex : currentIndex;
  if (nextStopIndex > targetIndex) {
    return {
      etaSeconds: null,
      arrivalAt: null,
      reason: "vehicle has already passed this stop",
      missingSegment: null,
    };
  }

  const nextStop = projections[nextStopIndex]!;
  let etaSeconds = Math.max(
    0,
    (nextStop.shapeDistanceMeters - state.progressMeters) /
      state.effectiveSpeedMps,
  );
  let cursorTime = new Date(fetchedAt.getTime() + etaSeconds * 1000);

  for (let index = nextStopIndex; index < targetIndex; index += 1) {
    const fromStop = projections[index]!;
    const toStop = projections[index + 1]!;
    const stat = getSegmentStatForTime(
      routeId,
      directionId,
      fromStop.stopId,
      toStop.stopId,
      cursorTime,
    );
    if (!stat) {
      return {
        etaSeconds: null,
        arrivalAt: null,
        reason: "missing strict historical segment stats for this time bucket",
        missingSegment: {
          fromStopId: fromStop.stopId,
          toStopId: toStop.stopId,
          dayType: getDayType(cursorTime),
          hourOfDay: cursorTime.getHours(),
        },
      };
    }
    etaSeconds += stat.p50Seconds;
    cursorTime = new Date(fetchedAt.getTime() + etaSeconds * 1000);
  }

  const roundedEtaSeconds = Math.round(etaSeconds);
  return {
    etaSeconds: roundedEtaSeconds,
    arrivalAt: new Date(
      fetchedAt.getTime() + roundedEtaSeconds * 1000,
    ).toISOString(),
    reason: "strict ETA from live progress and historical stop segments",
    missingSegment: null,
  };
};

const buildLiveStopArrivals = async (stopId: number) => {
  await ensureStaticCachesLoaded();
  await ensureSegmentStatsLoaded();
  const stop = stopById.get(stopId);
  if (!stop) return null;

  const latest = await getLatestVehiclesForLive();
  if (!latest) {
    return {
      stop,
      fetchedAt: null,
      arrivals: [],
      diagnostics: {
        liveVehicles: 0,
        candidateTrips: 0,
        excludedPassedStop: 0,
        excludedUnusableState: 0,
      },
    };
  }

  const candidateTrips = tripIdsByStopId.get(stopId) ?? new Set<string>();
  const arrivals: Array<{
    vehicleId: number;
    routeId: number;
    routeShortName: string | null;
    routeLongName: string | null;
    routeColor: string | null;
    tripId: string;
    directionId: number;
    etaSeconds: number | null;
    arrivalAt: string | null;
    distanceMeters: number | null;
    status: VehicleLiveStatus;
    confidence: "high" | "medium" | "low";
    reason: string;
    vehicleTimestamp: string | null;
    fetchedAt: string;
    debug: {
      progressMeters: number | null;
      targetStopMeters: number | null;
      distanceFromShapeMeters: number | null;
      effectiveSpeedMps: number | null;
      stopSequence: number | null;
      missingSegment: {
        fromStopId: number;
        toStopId: number;
        dayType: string;
        hourOfDay: number;
      } | null;
    };
  }> = [];
  let excludedPassedStop = 0;
  let excludedUnusableState = 0;

  vehicleLiveStateById.forEach((state) => {
    if (!state.tripId || !candidateTrips.has(state.tripId)) return;
    const routeId = state.routeId;
    if (routeId === null || state.directionId === null) return;
    const projections = stopProjectionsByTripId.get(state.tripId);
    const targetStop = projections?.find((value) => value.stopId === stopId);
    if (!targetStop) return;

    const unusableStatuses = new Set<VehicleLiveStatus>([
      "stale",
      "unknown",
      "off_route",
      "arrived_terminal",
    ]);
    const liveStateStale =
      Date.now() - state.fetchedAt.getTime() > LIVE_STALE_AFTER_MS;
    if (
      liveStateStale ||
      unusableStatuses.has(state.status) ||
      state.progressMeters === null ||
      state.distanceFromShapeMeters === null
    ) {
      excludedUnusableState += 1;
      return;
    }

    const remainingMeters = targetStop.shapeDistanceMeters - state.progressMeters;
    if (remainingMeters < -LIVE_ARRIVING_METERS) {
      excludedPassedStop += 1;
      return;
    }

    let status = state.status;
    let etaSeconds: number | null = null;
    let arrivalAt: string | null = null;
    let reason = state.reason;
    const normalizedRemainingMeters = Math.max(0, remainingMeters);

    const strictEta = computeStrictEtaToStop({
      state,
      routeId,
      directionId: state.directionId,
      projections,
      targetStop,
      fetchedAt: latest.fetchedAt,
    });

    if (normalizedRemainingMeters <= LIVE_ARRIVING_METERS) {
      status = "arriving";
      etaSeconds = strictEta.etaSeconds;
      arrivalAt = strictEta.arrivalAt;
      reason = strictEta.reason;
    } else if (state.status === "moving") {
      etaSeconds = strictEta.etaSeconds;
      arrivalAt = strictEta.arrivalAt;
      reason = strictEta.reason;
    } else if (state.status === "waiting_at_terminal") {
      reason =
        "vehicle is waiting at the origin terminal; ETA starts after departure";
    } else if (state.status === "stopped_on_route") {
      reason = "vehicle is stopped on route; ETA is temporarily unavailable";
    }

    const routeInfo = routeInfoById.get(routeId);
    arrivals.push({
      vehicleId: state.vehicleId,
      routeId,
      routeShortName: routeInfo?.routeShortName ?? null,
      routeLongName: routeInfo?.routeLongName ?? null,
      routeColor: routeInfo?.routeColor ?? null,
      tripId: state.tripId,
      directionId: state.directionId,
      etaSeconds,
      arrivalAt,
      distanceMeters: Math.round(normalizedRemainingMeters),
      status,
      confidence:
        etaSeconds === null && status !== "arriving" ? "low" : state.confidence,
      reason,
      vehicleTimestamp: state.vehicleTimestamp?.toISOString() ?? null,
      fetchedAt: latest.fetchedAt.toISOString(),
      debug: {
        progressMeters:
          state.progressMeters === null ? null : Math.round(state.progressMeters),
        targetStopMeters: Math.round(targetStop.shapeDistanceMeters),
        distanceFromShapeMeters:
          state.distanceFromShapeMeters === null
            ? null
            : Math.round(state.distanceFromShapeMeters),
        effectiveSpeedMps:
          state.effectiveSpeedMps === null
            ? null
            : Math.round(state.effectiveSpeedMps * 100) / 100,
        stopSequence: targetStop.stopSequence,
        missingSegment: strictEta.missingSegment,
      },
    });
  });

  arrivals.sort((a, b) => {
    const rank = (arrival: (typeof arrivals)[number]) => {
      if (arrival.status === "arriving") return 0;
      if (arrival.etaSeconds !== null) return 1;
      if (arrival.status === "stopped_on_route") return 2;
      if (arrival.status === "waiting_at_terminal") return 3;
      return 4;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return (a.etaSeconds ?? Number.POSITIVE_INFINITY) -
      (b.etaSeconds ?? Number.POSITIVE_INFINITY);
  });

  return {
    stop,
    fetchedAt: latest.fetchedAt.toISOString(),
    arrivals,
    diagnostics: {
      liveVehicles: vehicleLiveStateById.size,
      candidateTrips: candidateTrips.size,
      excludedPassedStop,
      excludedUnusableState,
    },
  };
};

const app = new Elysia()
  .get("/api/live", () => ({ ok: true }))
  .get("/api/live/stop/:stopId", async ({ params }) => {
    const stopId = Number(params.stopId);
    if (Number.isNaN(stopId)) {
      return new Response("Invalid stop id", { status: 400 });
    }
    const payload = await buildLiveStopArrivals(stopId);
    if (!payload) {
      return new Response("Stop not found", { status: 404 });
    }
    return Response.json(payload);
  })
  .get("/api/live/debug/vehicle/:vehicleId", async ({ params }) => {
    await ensureStaticCachesLoaded();
    await getLatestVehiclesForLive();
    const vehicleId = Number(params.vehicleId);
    if (Number.isNaN(vehicleId)) {
      return new Response("Invalid vehicle id", { status: 400 });
    }
    const state = vehicleLiveStateById.get(vehicleId);
    if (!state) {
      return new Response("Vehicle not found", { status: 404 });
    }
    return Response.json({
      state,
      history: vehicleProgressHistoryById.get(vehicleId) ?? [],
    });
  })
  .get("/api/health", async () => {
    const dbOk = await checkDbHealth();
    if (!dbOk) {
      return Response.json(
        {
          ok: false,
          dbOk: false,
          lastDbErrorAt: lastDbErrorAt?.toISOString() ?? null,
          lastDbErrorMessage,
        },
        { status: 503 },
      );
    }
    return {
      ok: true,
      dbOk: true,
      lastDbErrorAt: lastDbErrorAt?.toISOString() ?? null,
      lastDbErrorMessage,
      lastDbSuccessAt: lastDbSuccessAt?.toISOString() ?? null,
    };
  })
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
    if (resource === "vehicles") {
      // API-only pods (INGEST_ENABLED=false) must read from DB on every request,
      // otherwise in-memory cache can become stale per pod in multi-replica setups.
      if (!INGEST_ENABLED) {
        const latestFromDb = await getLatestVehiclesSnapshotFromDb();
        if (latestFromDb) {
          return Response.json({
            fetchedAt: latestFromDb.fetchedAt.toISOString(),
            vehicles: latestFromDb.vehicles,
          });
        }
        return Response.json({ fetchedAt: null, vehicles: [] });
      }

      if (latestVehiclesCache.length === 0) {
        await loadLatestVehiclesSnapshotCache();
      }
      if (latestVehiclesCache.length > 0) {
        return Response.json({
          fetchedAt: latestVehiclesFetchedAt?.toISOString() ?? null,
          vehicles: latestVehiclesCache,
        });
      }
      const latestFromDb = await getLatestVehiclesSnapshotFromDb();
      if (latestFromDb) {
        return Response.json({
          fetchedAt: latestFromDb.fetchedAt.toISOString(),
          vehicles: latestFromDb.vehicles,
        });
      }
      return Response.json({ fetchedAt: null, vehicles: [] });
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
  .get("/api/analytics/stop/:stopId", async ({ params, query }) => {
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
    const requestedOffset = Number(query.offset ?? 0);
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(22, Math.max(0, Math.floor(requestedOffset)))
      : 0;
    const windowSize = 8;
    const today = new Date();
    const dayKeys: Array<{ key: string; isToday: boolean }> = [];
    for (let i = offset + windowSize - 1; i >= offset; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dayKeys.push({ key: localDateKey(date), isToday: i === 0 });
    }
    const historyCutoff = new Date(today);
    historyCutoff.setDate(today.getDate() - PREDICTION_HISTORY_DAYS);
    historyCutoff.setHours(0, 0, 0, 0);
    const displayCutoff = new Date(today);
    displayCutoff.setDate(today.getDate() - (offset + windowSize - 1));
    displayCutoff.setHours(0, 0, 0, 0);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayKey = localDateKey(today);
    const targetDate = new Date(`${todayKey}T00:00:00`);
    const targetWeekday = targetDate.getDay();
    const targetIsoWeekday = targetWeekday === 0 ? 7 : targetWeekday;
    const targetDayType = getDayType(targetDate);

    const [displayVisits, predictionVisits, routeInfoRows] = await Promise.all([
      db
        .select({
          routeId: stopVisits.routeId,
          observedAt: stopVisits.observedAt,
        })
        .from(stopVisits)
        .where(
          sql`${stopVisits.stopId} = ${stopId} AND ${stopVisits.observedAt} >= ${displayCutoff} AND ${stopVisits.routeId} IS NOT NULL`,
        ),
      db.execute<{ routeId: number; observedAt: Date }>(sql`
        with candidate_visits as (
          select
            route_id,
            observed_at,
            (observed_at at time zone 'Europe/Bucharest')::date as service_date
          from stop_visits
          where stop_id = ${stopId}
            and observed_at >= ${historyCutoff}
            and observed_at < ${todayStart}
            and route_id is not null
        ),
        route_days as (
          select distinct route_id, service_date
          from candidate_visits
        ),
        same_day_counts as (
          select route_id, count(*)::integer as available_days
          from route_days
          where extract(isodow from service_date) = ${targetIsoWeekday}
          group by route_id
        ),
        same_day_candidates as (
          select
            route_id,
            service_date,
            dense_rank() over (
              partition by route_id
              order by service_date desc
            ) as day_rank
          from route_days
          where extract(isodow from service_date) = ${targetIsoWeekday}
        ),
        fallback_day_candidates as (
          select
            route_days.route_id,
            route_days.service_date,
            dense_rank() over (
              partition by route_days.route_id
              order by route_days.service_date desc
            ) as day_rank
          from route_days
          left join same_day_counts
            on same_day_counts.route_id = route_days.route_id
          where coalesce(same_day_counts.available_days, 0) < ${PREDICTION_MIN_SAME_WEEKDAY_DAYS}
            and case
              when extract(isodow from route_days.service_date) in (6, 7)
                then 'weekend'
              else 'weekday'
            end = ${targetDayType}
        ),
        selected_days as (
          select same_day_candidates.route_id, same_day_candidates.service_date
          from same_day_candidates
          join same_day_counts
            on same_day_counts.route_id = same_day_candidates.route_id
          where same_day_counts.available_days >= ${PREDICTION_MIN_SAME_WEEKDAY_DAYS}
            and same_day_candidates.day_rank <= 4
          union all
          select route_id, service_date
          from fallback_day_candidates
          where day_rank <= 4
        )
        select
          candidate_visits.route_id as "routeId",
          candidate_visits.observed_at as "observedAt"
        from candidate_visits
        join selected_days
          on selected_days.route_id = candidate_visits.route_id
         and selected_days.service_date = candidate_visits.service_date
      `),
      db
        .select({
          routeId: routes.routeId,
          routeShortName: routes.routeShortName,
          routeLongName: routes.routeLongName,
          routeColor: routes.routeColor,
        })
        .from(routes),
    ]);
    const routeInfoMap = new Map(
      routeInfoRows.map((row) => [row.routeId, row]),
    );

    const knownDisplayVisits = displayVisits.filter((row) =>
      routeInfoMap.has(row.routeId as number),
    );
    const knownPredictionVisits = predictionVisits.filter((row) =>
      routeInfoMap.has(row.routeId),
    );
    const daySet = new Set(dayKeys.map((day) => day.key));
    const visitsByDay = new Map<
      string,
      Map<number, { timestamps: string[]; predicted: boolean }>
    >();

    knownDisplayVisits.forEach((row) => {
      const dayKey = localDateKey(row.observedAt);
      const routeId = row.routeId as number;
      const timestamp = timeToIso(row.observedAt);
      if (!daySet.has(dayKey)) return;
      if (!visitsByDay.has(dayKey)) {
        visitsByDay.set(dayKey, new Map());
      }
      const dayMap = visitsByDay.get(dayKey);
      if (!dayMap?.has(routeId)) {
        dayMap?.set(routeId, { timestamps: [], predicted: false });
      }
      dayMap?.get(routeId)?.timestamps.push(timestamp);
    });

    const predictedByRoute = new Map<number, string[]>();
    const predictionDaysByRoute = new Map<number, Map<string, string[]>>();
    knownPredictionVisits.forEach((row) => {
      const dayKey = localDateKey(row.observedAt);
      if (!predictionDaysByRoute.has(row.routeId)) {
        predictionDaysByRoute.set(row.routeId, new Map());
      }
      const routeDayMap = predictionDaysByRoute.get(row.routeId);
      if (!routeDayMap?.has(dayKey)) {
        routeDayMap?.set(dayKey, []);
      }
      routeDayMap?.get(dayKey)?.push(timeToIso(row.observedAt));
    });
    predictionDaysByRoute.forEach((dayMap, routeId) => {
      const predicted = buildPredictedTimes(
        Array.from(dayMap.values()).map((timestamps) =>
          timestamps.slice().sort((a, b) => new Date(a).getTime() - new Date(b).getTime()),
        ),
      );
      if (predicted.length > 0) {
        predictedByRoute.set(routeId, predicted);
      }
    });

    const days = dayKeys.map((day) => {
      const points: Array<{
        routeId: number;
        timestamps: string[];
        predicted: boolean;
      }> = [];
      if (day.isToday) {
        const dayMap = visitsByDay.get(day.key);
        if (dayMap) {
          dayMap.forEach((value, routeId) => {
            if (value.timestamps.length === 0) return;
            points.push({
              routeId,
              timestamps: value.timestamps.slice().sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
              ),
              predicted: false,
            });
          });
        }
        predictedByRoute.forEach((timestamps, routeId) => {
          const nowTime = new Date().toISOString();
          const future = timestamps.filter((ts) => ts > nowTime);
          if (future.length === 0) return;
          points.push({ routeId, timestamps: future, predicted: true });
        });
      } else {
        const dayMap = visitsByDay.get(day.key);
        if (dayMap) {
          dayMap.forEach((value, routeId) => {
            if (value.timestamps.length === 0) return;
            points.push({
              routeId,
              timestamps: value.timestamps.slice().sort((a, b) =>
                new Date(a).getTime() - new Date(b).getTime()
              ),
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
      new Set([
        ...knownDisplayVisits.map((row) => row.routeId as number),
        ...knownPredictionVisits.map((row) => row.routeId),
      ]),
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
      window: {
        offset,
        canGoOlder: offset < 22,
        canGoNewer: offset > 0,
      },
    });
  });

const port = Number(process.env.BACKEND_PORT || 3000);

app.listen(port);
console.log(`Backend listening on http://localhost:${port}`);

if (INGEST_ENABLED) {
  await runStaticRefresh("startup");
  await ensureStaticCachesLoaded().catch((error) => {
    markDbError(error);
    console.error("Static cache load failed", error);
  });
  await loadRecentProgressSamples().catch((error) => {
    markDbError(error);
    console.error("Progress sample load failed", error);
  });
  await ensureSegmentStatsLoaded().catch((error) => {
    markDbError(error);
    console.error("Segment stats cache load failed", error);
  });
  scheduleLoop();
  scheduleStaticRefresh();
  scheduleSegmentStatsRefresh();
  scheduleDailyCleanup();
  console.log("Ingest mode enabled");
} else {
  console.log("Ingest mode disabled");
}

process.on("SIGINT", async () => {
  await Promise.all([sqlClient.close(), writeSqlClient.close()]);
  process.exit(0);
});
