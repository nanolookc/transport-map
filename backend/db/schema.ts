import {
    date,
    doublePrecision,
    index,
    integer,
    pgTable,
    primaryKey,
    serial,
    text,
    timestamp,
} from "drizzle-orm/pg-core";

export const routes = pgTable("routes", {
    routeId: integer("route_id").primaryKey(),
    agencyId: integer("agency_id").notNull(),
    routeShortName: text("route_short_name").notNull(),
    routeLongName: text("route_long_name").notNull(),
    routeColor: text("route_color").notNull(),
    routeType: integer("route_type").notNull(),
    routeDesc: text("route_desc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const trips = pgTable("trips", {
    tripId: text("trip_id").primaryKey(),
    routeId: integer("route_id").notNull(),
    tripHeadsign: text("trip_headsign").notNull(),
    directionId: integer("direction_id").notNull(),
    blockId: integer("block_id").notNull(),
    shapeId: text("shape_id").notNull(),
});

export const stops = pgTable("stops", {
    stopId: integer("stop_id").primaryKey(),
    stopName: text("stop_name").notNull(),
    stopLat: doublePrecision("stop_lat").notNull(),
    stopLon: doublePrecision("stop_lon").notNull(),
    locationType: integer("location_type").notNull(),
    stopCode: text("stop_code").notNull(),
});

export const stopTimes = pgTable(
    "stop_times",
    {
        tripId: text("trip_id").notNull(),
        stopId: integer("stop_id").notNull(),
        stopSequence: integer("stop_sequence").notNull(),
        arrivalTime: text("arrival_time"),
        departureTime: text("departure_time"),
        stopHeadsign: text("stop_headsign"),
        pickupType: integer("pickup_type"),
        dropOffType: integer("drop_off_type"),
        shapeDistTraveled: doublePrecision("shape_dist_traveled"),
        timepoint: integer("timepoint"),
    },
    (table) => ({
        pk: primaryKey({
            columns: [table.tripId, table.stopSequence],
        }),
        stopTripIdx: index("stop_times_stop_id_idx").on(table.stopId),
        tripIdx: index("stop_times_trip_id_idx").on(table.tripId),
    }),
);

export const shapes = pgTable(
    "shapes",
    {
        shapeId: text("shape_id").notNull(),
        shapePtSequence: integer("shape_pt_sequence").notNull(),
        shapePtLat: doublePrecision("shape_pt_lat").notNull(),
        shapePtLon: doublePrecision("shape_pt_lon").notNull(),
        shapeDistTraveled: doublePrecision("shape_dist_traveled"),
    },
    (table) => ({
        pk: primaryKey({
            columns: [table.shapeId, table.shapePtSequence],
        }),
        shapeIdx: index("shapes_shape_id_idx").on(table.shapeId),
    }),
);

export const vehicleSnapshots = pgTable(
    "vehicle_snapshots",
    {
        id: serial("id").primaryKey(),
        fetchedAt: timestamp("fetched_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        vehicleId: integer("vehicle_id").notNull(),
        routeId: integer("route_id"),
        tripId: text("trip_id"),
        latitude: doublePrecision("latitude"),
        longitude: doublePrecision("longitude"),
        timestamp: timestamp("vehicle_timestamp", { withTimezone: true }),
        speed: doublePrecision("speed"),
        vehicleType: integer("vehicle_type"),
        bikeAccessible: text("bike_accessible"),
        wheelchairAccessible: text("wheelchair_accessible"),
    },
    (table) => ({
        vehicleIdx: index("vehicle_snapshots_vehicle_id_idx").on(
            table.vehicleId,
        ),
        routeIdx: index("vehicle_snapshots_route_id_idx").on(table.routeId),
        fetchedIdx: index("vehicle_snapshots_fetched_at_idx").on(table.fetchedAt),
    }),
);

export const stopVisits = pgTable(
    "stop_visits",
    {
        id: serial("id").primaryKey(),
        stopId: integer("stop_id").notNull(),
        routeId: integer("route_id"),
        tripId: text("trip_id"),
        vehicleId: integer("vehicle_id").notNull(),
        observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
        fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
        latitude: doublePrecision("latitude").notNull(),
        longitude: doublePrecision("longitude").notNull(),
        distanceMeters: doublePrecision("distance_meters").notNull(),
    },
    (table) => ({
        stopIdx: index("stop_visits_stop_id_idx").on(table.stopId),
        routeIdx: index("stop_visits_route_id_idx").on(table.routeId),
        observedIdx: index("stop_visits_observed_at_idx").on(table.observedAt),
    }),
);

export const routeDailyStats = pgTable(
    "route_daily_stats",
    {
        day: date("day").notNull(),
        routeId: integer("route_id").notNull(),
        firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
            .notNull(),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.day, table.routeId] }),
        routeIdx: index("route_daily_stats_route_id_idx").on(table.routeId),
    }),
);
