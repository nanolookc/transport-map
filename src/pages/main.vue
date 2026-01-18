<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Bug, Star, X, Layers } from "lucide-vue-next";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer";
import StopPanel from "@/components/stop.vue";
import RouteList from "@/components/RouteList.vue";
import DirectionFilter from "@/components/DirectionFilter.vue";

declare global {
    interface Window {
        L: any;
    }
}

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

type ShapePoint = {
    shape_id: string;
    shape_pt_lat: number;
    shape_pt_lon: number;
    shape_pt_sequence: number;
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
};

type StopAnalytics = {
    stop: Stop;
    routes: Array<{
        routeId: number;
        routeShortName: string | null;
        routeLongName: string | null;
        routeColor: string | null;
    }>;
    days: Array<{
        date: string;
        isToday: boolean;
        points: Array<{
            routeId: number;
            timestamps: string[];
            predicted: boolean;
        }>;
    }>;
};

type LeafletMap = {
    setView: (coords: [number, number], zoom: number) => void;
    fitBounds: (
        bounds: unknown,
        options?: { padding?: [number, number] },
    ) => void;
    createPane: (name: string) => { style: { zIndex: string } };
    remove: () => void;
    removeLayer: (layer: unknown) => void;
};

type LeafletMarker = {
    addTo: (map: LeafletMap) => void;
    setLatLng: (coords: [number, number]) => void;
    setIcon: (icon: unknown) => void;
    on: (event: string, handler: () => void) => void;
};

type LeafletLayer = any;
type LeafletCircleMarker = any;

type LatLng = {
    lat: number;
    lon: number;
};

const mapEl = ref<HTMLDivElement | null>(null);
const selectedVehicle = ref<Vehicle | null>(null);
const selectedRouteIds = ref<number[]>([]);
const directionFilter = ref<"all" | "0" | "1">("all");
const selectedStop = ref<Stop | null>(null);
const showAllVehicles = ref(true);
const showAllRoutes = ref(true);
const favoriteRouteIds = ref<number[]>([]);
const showStaleVehicles = ref(false);
const debugOpen = ref(false);
const showUnknownRoutes = ref(false);
const mobileRoutesOpen = ref(false);
const mobileStopOpen = ref(false);
const desktopStopOpen = ref(false);
const isMobile = ref(false);
const nowTick = ref(Date.now());
const routeSearch = ref("");
const loadState = ref<"idle" | "loading" | "error">("idle");
const errorMessage = ref<string | null>(null);
const lastFetch = ref<Date | null>(null);
const routes = ref<Route[]>([]);
const routesLoadState = ref<"idle" | "loading" | "error">("idle");
const routesError = ref<string | null>(null);
const latestVehicles = ref<Vehicle[]>([]);
const trips = ref<Trip[]>([]);
const tripsLoadState = ref<"idle" | "loading" | "error">("idle");
const tripsError = ref<string | null>(null);
const shapesLoadState = ref<"idle" | "loading" | "error">("idle");
const shapesError = ref<string | null>(null);
const stopsLoadState = ref<"idle" | "loading" | "error">("idle");
const stopsError = ref<string | null>(null);
const stopTimesLoadState = ref<"idle" | "loading" | "error">("idle");
const stopTimesError = ref<string | null>(null);
const shapesById = ref<Map<string, ShapePoint[]>>(new Map());
const stopsById = ref<Map<number, Stop>>(new Map());
const stopTimesByStopId = ref<Map<number, Set<string>>>(new Map());
const stopAnalyticsCache = ref<Map<number, StopAnalytics>>(new Map());
const stopAnalyticsState = ref<"idle" | "loading" | "error">("idle");
const stopAnalyticsError = ref<string | null>(null);
const selectedStopId = computed(() => selectedStop.value?.stop_id);
const savedRouteView = ref<{
    showAllRoutes: boolean;
    showAllVehicles: boolean;
    showUnknownRoutes: boolean;
    selectedRouteIds: number[];
} | null>(null);

let map: LeafletMap | null = null;
let refreshTimer: number | null = null;
let tickTimer: number | null = null;
let didFitBounds = false;
const markersById = new Map<number, LeafletMarker>();
const vehiclesById = new Map<number, Vehicle>();
const lastPositionsById = new Map<number, LatLng>();
const lastBearingsById = new Map<number, number>();
const stopMarkersById = new Map<number, LeafletCircleMarker>();
const routeLayers: LeafletLayer[] = [];
const stopLayers: LeafletLayer[] = [];
let lastSelectedStopId: number | null = null;

const apiUrl = "/api/proxy/vehicles";
const routesUrl = "/api/proxy/routes";
const tripsUrl = "/api/proxy/trips";
const shapesUrl = "/api/proxy/shapes";
const stopsUrl = "/api/proxy/stops";
const stopTimesUrl = "/api/proxy/stop_times";

const checkMobile = () => {
    isMobile.value = window.innerWidth < 768;
};

const loadLeaflet = () =>
    new Promise<void>((resolve, reject) => {
        if (window.L) {
            resolve();
            return;
        }

        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.crossOrigin = "";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Leaflet"));
        document.head.appendChild(script);
    });

const getVehicleAgeMinutes = (vehicle: Vehicle) => {
    const timestamp = new Date(vehicle.timestamp).getTime();
    if (Number.isNaN(timestamp)) {
        return Number.POSITIVE_INFINITY;
    }
    return (Date.now() - timestamp) / 60000;
};

const isVehicleStale = (vehicle: Vehicle) => getVehicleAgeMinutes(vehicle) > 60;

const getVehicleColor = (vehicle: Vehicle) => {
    const ageMinutes = getVehicleAgeMinutes(vehicle);
    if (ageMinutes <= 2) return "#16a34a";
    if (ageMinutes <= 15) return "#facc15";
    return "#dc2626";
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

const computeBearing = (
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
) => {
    const phi1 = toRad(fromLat);
    const phi2 = toRad(toLat);
    const delta = toRad(toLon - fromLon);
    const y = Math.sin(delta) * Math.cos(phi2);
    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta);
    const bearing = Math.atan2(y, x);
    return (toDeg(bearing) + 360) % 360;
};

const computeBearingFromShape = (
    lat: number,
    lon: number,
    points: ShapePoint[],
) => {
    if (points.length < 2) return null;
    const lat0 = toRad(lat);
    const cosLat0 = Math.cos(lat0);
    const point = {
        x: toRad(lon) * cosLat0,
        y: toRad(lat),
    };

    let bestStart: ShapePoint | null = null;
    let bestEnd: ShapePoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < points.length - 1; i += 1) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const startX = toRad(start.shape_pt_lon) * cosLat0;
        const startY = toRad(start.shape_pt_lat);
        const endX = toRad(end.shape_pt_lon) * cosLat0;
        const endY = toRad(end.shape_pt_lat);
        const dx = endX - startX;
        const dy = endY - startY;
        let t = 0;
        if (dx !== 0 || dy !== 0) {
            t =
                ((point.x - startX) * dx + (point.y - startY) * dy) /
                (dx * dx + dy * dy);
            if (t < 0) t = 0;
            if (t > 1) t = 1;
        }
        const projX = startX + t * dx;
        const projY = startY + t * dy;
        const distX = point.x - projX;
        const distY = point.y - projY;
        const distance = distX * distX + distY * distY;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestStart = start;
            bestEnd = end;
        }
    }

    if (!bestStart || !bestEnd) return null;
    return computeBearing(
        bestStart.shape_pt_lat,
        bestStart.shape_pt_lon,
        bestEnd.shape_pt_lat,
        bestEnd.shape_pt_lon,
    );
};

const getVehicleRouteBearing = (vehicle: Vehicle) => {
    if (!vehicle.trip_id) return null;
    const trip = tripById.value.get(vehicle.trip_id);
    if (!trip) return null;
    const points = shapesById.value.get(trip.shape_id);
    if (!points) return null;
    return computeBearingFromShape(vehicle.latitude, vehicle.longitude, points);
};

const createVehicleIcon = (
    vehicle: Vehicle,
    bearing: number | null,
    isSelected: boolean,
) => {
    const color = getVehicleColor(vehicle);
    const L = window.L;
    const rotation = bearing ?? 0;
    const unknownClass = bearing === null ? " is-unknown" : "";
    const selectedClass = isSelected ? " is-selected" : "";
    return L.divIcon({
        className: "vehicle-icon",
        html: `<span class="vehicle-marker${unknownClass}${selectedClass}" style="--vehicle-color:${color};--vehicle-rotation:${rotation}deg;"><span class="vehicle-arrow"></span><span class="vehicle-dot"></span></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
    });
};

const clearRouteLayers = () => {
    if (!map) return;
    routeLayers.splice(0).forEach((layer) => map?.removeLayer(layer));
};

const addPolyline = (points: ShapePoint[], color: string) => {
    if (!map || points.length === 0) return;
    const L = window.L;
    const latLngs = points.map((point) => [
        point.shape_pt_lat,
        point.shape_pt_lon,
    ]);
    const line = L.polyline(latLngs, {
        color,
        weight: 4,
        opacity: 0.85,
        pane: "routes",
    });
    line.addTo(map);
    routeLayers.push(line);
};

const clearStopLayers = () => {
    if (!map) return;
    stopLayers.splice(0).forEach((layer) => map?.removeLayer(layer));
    stopMarkersById.clear();
};

const isStopDimmed = (stopId: number) => {
    const shouldDim = !showAllRoutes.value && selectedRouteIds.value.length > 0;
    const canCheckStops = stopTimesByStopId.value.size > 0;
    if (!shouldDim || !canCheckStops) return false;
    const selectedSet = new Set(selectedRouteIds.value);
    const stopRouteIds = getStopRouteIds(stopId);
    return !stopRouteIds.some((routeId) => selectedSet.has(routeId));
};

const getStopMarkerStyle = (stopId: number, isSelected: boolean) => {
    const dimStop = isStopDimmed(stopId);
    return {
        radius: isSelected ? 7 : 5,
        color: "#0f172a",
        weight: isSelected ? 2.5 : dimStop ? 1 : 1.5,
        fillColor: isSelected ? "#fde68a" : "#ffffff",
        opacity: dimStop ? 0.6 : 0.9,
        fillOpacity: dimStop ? 0.6 : isSelected ? 0.95 : 0.9,
        pane: "stops",
    };
};

const addAllStops = () => {
    if (!map || stopsById.value.size === 0) return;
    clearStopLayers();
    const L = window.L;
    const selectedStopId = selectedStop.value?.stop_id ?? null;
    stopsById.value.forEach((stop) => {
        const isSelected = selectedStopId === stop.stop_id;
        const marker = L.circleMarker(
            [stop.stop_lat, stop.stop_lon],
            getStopMarkerStyle(stop.stop_id, isSelected),
        );
        marker.bindTooltip(stop.stop_name, { direction: "top" });
        marker.on("click", () => {
            selectedStop.value = stop;
            selectedVehicle.value = null;
            fetchStopAnalytics(stop.stop_id);
        });
        marker.addTo(map);
        stopLayers.push(marker);
        stopMarkersById.set(stop.stop_id, marker);
    });
    lastSelectedStopId = selectedStopId;
};

const updateSelectedStopHighlight = () => {
    const nextId = selectedStop.value?.stop_id ?? null;
    if (nextId === lastSelectedStopId) return;
    if (lastSelectedStopId !== null) {
        const previousMarker = stopMarkersById.get(lastSelectedStopId);
        if (previousMarker) {
            previousMarker.setStyle(
                getStopMarkerStyle(lastSelectedStopId, false),
            );
        }
    }
    if (nextId !== null) {
        const nextMarker = stopMarkersById.get(nextId);
        if (nextMarker) {
            nextMarker.setStyle(getStopMarkerStyle(nextId, true));
        }
    }
    lastSelectedStopId = nextId;
};

const updateStopStyles = () => {
    if (!map || stopMarkersById.size === 0) return;
    const selectedStopId = selectedStop.value?.stop_id ?? null;
    stopMarkersById.forEach((marker, stopId) => {
        marker.setStyle(getStopMarkerStyle(stopId, selectedStopId === stopId));
    });
};

const routeById = computed(() => {
    const map = new Map<number, Route>();
    routes.value.forEach((route) => map.set(route.route_id, route));
    return map;
});

const tripById = computed(() => {
    const map = new Map<string, Trip>();
    trips.value.forEach((trip) => map.set(trip.trip_id, trip));
    return map;
});

const selectedRoutesSet = computed(() => new Set(selectedRouteIds.value));
const favoriteRoutesSet = computed(() => new Set(favoriteRouteIds.value));
const knownRouteIdsSet = computed(() => {
    const set = new Set<number>();
    routes.value.forEach((route) => set.add(route.route_id));
    return set;
});
const onlineVehiclesCount = computed(
    () =>
        latestVehicles.value.filter(
            (vehicle) => getVehicleAgeMinutes(vehicle) <= 2,
        ).length,
);
const onlineRoutesCount = computed(() => {
    const set = new Set<number>();
    latestVehicles.value.forEach((vehicle) => {
        if (
            getVehicleAgeMinutes(vehicle) <= 2 &&
            knownRouteIdsSet.value.has(vehicle.route_id)
        ) {
            set.add(vehicle.route_id);
        }
    });
    return set.size;
});

const routeIdsToShow = computed(() => {
    if (showAllRoutes.value) {
        return routes.value.map((route) => route.route_id);
    }
    if (selectedRouteIds.value.length === 0) {
        return routes.value.map((route) => route.route_id);
    }
    return selectedRouteIds.value;
});

const filteredRoutes = computed(() => {
    const query = routeSearch.value.trim().toLowerCase();
    if (!query) return routes.value;
    return routes.value.filter((route) => {
        const shortName = route.route_short_name?.toLowerCase() ?? "";
        const longName = route.route_long_name?.toLowerCase() ?? "";
        const idValue = String(route.route_id);
        return (
            shortName.includes(query) ||
            longName.includes(query) ||
            idValue.includes(query)
        );
    });
});

const unknownRouteIds = computed(() => {
    const ids = new Set<number>();
    latestVehicles.value.forEach((vehicle) => {
        if (
            typeof vehicle.route_id === "number" &&
            !knownRouteIdsSet.value.has(vehicle.route_id)
        ) {
            ids.add(vehicle.route_id);
        }
    });
    return Array.from(ids).sort((a, b) => a - b);
});

const shouldShowUnknownRoutes = computed(() => {
    if (showUnknownRoutes.value) return true;
    return selectedRouteIds.value.some(
        (routeId) => !knownRouteIdsSet.value.has(routeId),
    );
});

const getRouteShortName = (routeId: number) => {
    const route = routeById.value.get(routeId);
    if (!route) return `#${routeId}`;
    return route.route_short_name || route.route_long_name || `#${routeId}`;
};

const getStopRouteLabels = (stopId: number) => {
    const tripIds = stopTimesByStopId.value.get(stopId);
    if (!tripIds) return [];
    const routeIds = new Set<number>();
    tripIds.forEach((tripId) => {
        const trip = tripById.value.get(tripId);
        if (trip) routeIds.add(trip.route_id);
    });
    const labels = Array.from(routeIds).map((routeId) =>
        getRouteShortName(routeId),
    );
    labels.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return labels;
};

const getStopRouteIds = (stopId: number) => {
    const tripIds = stopTimesByStopId.value.get(stopId);
    if (!tripIds) return [];
    const routeIds = new Set<number>();
    tripIds.forEach((tripId) => {
        const trip = tripById.value.get(tripId);
        if (trip) routeIds.add(trip.route_id);
    });
    return Array.from(routeIds).sort((a, b) => a - b);
};

const getVehicleDirectionLabel = (tripId: string | null) => {
    if (!tripId) return "Unknown";
    const trip = tripById.value.get(tripId);
    if (!trip) return "Unknown";
    return trip.direction_id === 0 ? "Way" : "Roundway";
};

const getVehicleDirectionId = (tripId: string | null) => {
    if (!tripId) return null;
    const trip = tripById.value.get(tripId);
    return trip ? trip.direction_id : null;
};

const getRouteDescription = (routeId: number) => {
    const route = routeById.value.get(routeId);
    if (!route) return "N/A";
    return route.route_desc || route.route_long_name || "N/A";
};

const getStopLocationTypeLabel = (locationType: number) => {
    if (locationType === 0) return "Stop";
    if (locationType === 1) return "Station";
    return `Type ${locationType}`;
};

const getStopTripCount = (stopId: number) => {
    const tripIds = stopTimesByStopId.value.get(stopId);
    return tripIds ? tripIds.size : 0;
};

const formatRelativeTime = (timestamp: string) => {
    const parsed = new Date(timestamp);
    const diffMs = nowTick.value - parsed.getTime();
    if (Number.isNaN(diffMs)) return "Unknown";
    const diffSeconds = Math.floor(diffMs / 1000);
    if (diffSeconds < 60) {
        return `${diffSeconds} sec ago`;
    }
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} d ago`;
};

const isRouteSelected = (routeId: number) =>
    selectedRoutesSet.value.has(routeId);

const isUnknownRouteId = (routeId: number) =>
    !knownRouteIdsSet.value.has(routeId);

const isRouteFavorite = (routeId: number) =>
    favoriteRoutesSet.value.has(routeId);

const toggleRouteSelection = (
    routeId: number,
    checked: boolean | "indeterminate",
) => {
    if (checked === true && showAllRoutes.value) {
        showAllRoutes.value = false;
        showAllVehicles.value = false;
        selectedRouteIds.value = [routeId];
        if (isUnknownRouteId(routeId)) {
            showUnknownRoutes.value = true;
        }
        return;
    }
    if (checked === true && isUnknownRouteId(routeId)) {
        showUnknownRoutes.value = true;
    }
    const selected = new Set(selectedRouteIds.value);
    if (checked === false || checked === "indeterminate") {
        selected.delete(routeId);
    } else {
        selected.add(routeId);
    }
    selectedRouteIds.value = Array.from(selected);
};

const fetchStopAnalytics = async (stopId: number) => {
    if (stopAnalyticsCache.value.has(stopId)) {
        return;
    }
    stopAnalyticsState.value = "loading";
    stopAnalyticsError.value = null;
    try {
        const response = await fetch(`/api/analytics/stop/${stopId}`);
        if (!response.ok) {
            throw new Error(`Analytics error: ${response.status}`);
        }
        const data = (await response.json()) as StopAnalytics;
        stopAnalyticsCache.value.set(stopId, data);
        stopAnalyticsState.value = "idle";
    } catch (error) {
        stopAnalyticsState.value = "error";
        stopAnalyticsError.value =
            error instanceof Error ? error.message : "Failed to load analytics";
    }
};

const toggleFavoriteRoute = (routeId: number) => {
    const favorites = new Set(favoriteRouteIds.value);
    if (favorites.has(routeId)) {
        favorites.delete(routeId);
    } else {
        favorites.add(routeId);
    }
    favoriteRouteIds.value = Array.from(favorites);
};

const openRouteFromFavorite = (routeId: number) => {
    if (showAllRoutes.value) {
        showAllRoutes.value = false;
        showAllVehicles.value = false;
        selectedRouteIds.value = [routeId];
        if (isUnknownRouteId(routeId)) {
            showUnknownRoutes.value = true;
        }
        return;
    }
    const selected = new Set(selectedRouteIds.value);
    if (selected.has(routeId)) {
        selected.delete(routeId);
    } else {
        selected.add(routeId);
    }
    selectedRouteIds.value = Array.from(selected);
};

const applyAllFavorites = () => {
    const favorites = new Set(favoriteRouteIds.value);
    if (favorites.size === 0) return;
    if (showAllRoutes.value) {
        showAllRoutes.value = false;
        showAllVehicles.value = false;
        selectedRouteIds.value = Array.from(favorites);
        return;
    }
    const allFavoritesActive = favoriteRouteIds.value.every((routeId) =>
        selectedRoutesSet.value.has(routeId),
    );
    showAllRoutes.value = false;
    showAllVehicles.value = false;
    if (allFavoritesActive) {
        showAllRoutes.value = true;
        showAllVehicles.value = true;
        selectedRouteIds.value = [];
        return;
    }
    const selected = new Set(selectedRouteIds.value);
    favoriteRouteIds.value.forEach((routeId) => selected.add(routeId));
    selectedRouteIds.value = Array.from(selected);
};

const resetRouteSelection = () => {
    showAllRoutes.value = false;
    selectedRouteIds.value = [];
};

const setShowAllVehicles = (checked: boolean | "indeterminate") => {
    showAllVehicles.value = checked === true;
};

const setShowAllRoutes = (checked: boolean | "indeterminate") => {
    showAllRoutes.value = checked === true;
};

const applyStopRoutes = (stopId: number) => {
    const stopRouteIds = getStopRouteIds(stopId);
    showAllRoutes.value = false;
    showAllVehicles.value = false;
    selectedRouteIds.value = stopRouteIds;
};

const toggleStopRoute = (routeId: number, stopId: number) => {
    if (showAllRoutes.value) {
        showAllRoutes.value = false;
        showAllVehicles.value = false;
        selectedRouteIds.value = [routeId];
        if (isUnknownRouteId(routeId)) {
            showUnknownRoutes.value = true;
        }
        return;
    }
    if (isUnknownRouteId(routeId)) {
        showUnknownRoutes.value = true;
    }
    const selected = new Set(selectedRouteIds.value);
    if (selected.has(routeId)) {
        selected.delete(routeId);
    } else {
        selected.add(routeId);
    }
    selectedRouteIds.value = Array.from(selected);
    if (selectedRouteIds.value.length === 0) {
        selectedRouteIds.value = getStopRouteIds(stopId);
    }
};

const isStopAllActive = (stopId: number) => {
    if (showAllRoutes.value) return true;
    const stopRouteIds = getStopRouteIds(stopId);
    if (stopRouteIds.length === 0) return false;
    return stopRouteIds.every((routeId) =>
        selectedRoutesSet.value.has(routeId),
    );
};

const getStopAnalytics = (stopId: number) =>
    stopAnalyticsCache.value.get(stopId) ?? null;

const downloadDataset = async (name: string, url: string) => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Download error: ${response.status}`);
        }
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${name}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
    } catch (error) {
        console.error("Download failed", error);
    }
};

const getRouteColor = (routeId: number) => {
    const route = routeById.value.get(routeId);
    return route?.route_color || "#0f172a";
};

const rememberRouteView = () => {
    if (savedRouteView.value) return;
    savedRouteView.value = {
        showAllRoutes: showAllRoutes.value,
        showAllVehicles: showAllVehicles.value,
        showUnknownRoutes: showUnknownRoutes.value,
        selectedRouteIds: [...selectedRouteIds.value],
    };
};

const restoreRouteView = () => {
    if (!savedRouteView.value) return;
    showAllRoutes.value = savedRouteView.value.showAllRoutes;
    showAllVehicles.value = savedRouteView.value.showAllVehicles;
    showUnknownRoutes.value = savedRouteView.value.showUnknownRoutes;
    selectedRouteIds.value = [...savedRouteView.value.selectedRouteIds];
    savedRouteView.value = null;
};

const clearSelection = () => {
    selectedVehicle.value = null;
    selectedStop.value = null;
    restoreRouteView();
};

const updateMarkers = (vehicles: Vehicle[]) => {
    if (!map) return;
    const L = window.L;
    const seen = new Set<number>();

    vehicles.forEach((vehicle) => {
        if (
            typeof vehicle.latitude !== "number" ||
            typeof vehicle.longitude !== "number"
        ) {
            return;
        }
        seen.add(vehicle.id);
        vehiclesById.set(vehicle.id, vehicle);

        const routeBearing = getVehicleRouteBearing(vehicle);
        const previous = lastPositionsById.get(vehicle.id);
        let bearing: number | null = null;
        if (
            previous &&
            (previous.lat !== vehicle.latitude ||
                previous.lon !== vehicle.longitude)
        ) {
            bearing = computeBearing(
                previous.lat,
                previous.lon,
                vehicle.latitude,
                vehicle.longitude,
            );
            lastBearingsById.set(vehicle.id, bearing);
        } else if (previous) {
            bearing = lastBearingsById.get(vehicle.id) ?? null;
        }
        if (!previous) {
            lastPositionsById.set(vehicle.id, {
                lat: vehicle.latitude,
                lon: vehicle.longitude,
            });
        } else if (
            previous.lat !== vehicle.latitude ||
            previous.lon !== vehicle.longitude
        ) {
            lastPositionsById.set(vehicle.id, {
                lat: vehicle.latitude,
                lon: vehicle.longitude,
            });
        }

        let marker = markersById.get(vehicle.id);
        const isSelected = selectedVehicle.value?.id === vehicle.id;
        const icon = createVehicleIcon(
            vehicle,
            routeBearing ?? bearing,
            isSelected,
        );
        if (!marker) {
            const newMarker = L.marker([vehicle.latitude, vehicle.longitude], {
                icon,
            });
            newMarker.on("click", () => {
                selectedVehicle.value = vehiclesById.get(vehicle.id) ?? null;
                selectedStop.value = null;
                if (vehicle.route_id) {
                    rememberRouteView();
                    showAllVehicles.value = false;
                    showAllRoutes.value = false;
                    selectedRouteIds.value = [vehicle.route_id];
                    if (isUnknownRouteId(vehicle.route_id)) {
                        showUnknownRoutes.value = true;
                    }
                }
            });
            newMarker.addTo(map);
            markersById.set(vehicle.id, newMarker);
        } else {
            marker.setLatLng([vehicle.latitude, vehicle.longitude]);
            marker.setIcon(icon);
        }
    });

    markersById.forEach((marker, id) => {
        if (!seen.has(id)) {
            map?.removeLayer(marker);
            markersById.delete(id);
            vehiclesById.delete(id);
            lastPositionsById.delete(id);
            lastBearingsById.delete(id);
        }
    });

    if (!didFitBounds && vehicles.length > 0) {
        const boundsVehicles = vehicles.filter(
            (vehicle) =>
                typeof vehicle.latitude === "number" &&
                typeof vehicle.longitude === "number",
        );
        if (boundsVehicles.length === 0) return;
        const bounds = L.latLngBounds(
            boundsVehicles.map((vehicle) => [
                vehicle.latitude,
                vehicle.longitude,
            ]),
        );
        map.fitBounds(bounds, { padding: [32, 32] });
        didFitBounds = true;
    }
};

const buildShapesIndex = (data: ShapePoint[]) => {
    const grouped = new Map<string, ShapePoint[]>();
    data.forEach((point) => {
        if (!grouped.has(point.shape_id)) {
            grouped.set(point.shape_id, []);
        }
        grouped.get(point.shape_id)?.push(point);
    });
    grouped.forEach((points) => {
        points.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
    });
    shapesById.value = grouped;
};

const buildStopsIndex = (data: Stop[]) => {
    const map = new Map<number, Stop>();
    data.forEach((stop) => map.set(stop.stop_id, stop));
    stopsById.value = map;
};

const buildStopTimesIndex = (data: StopTime[]) => {
    const byStop = new Map<number, Set<string>>();
    data.forEach((stopTime) => {
        if (!byStop.has(stopTime.stop_id)) {
            byStop.set(stopTime.stop_id, new Set());
        }
        byStop.get(stopTime.stop_id)?.add(stopTime.trip_id);
    });
    stopTimesByStopId.value = byStop;
};

const applyVehicleFilter = () => {
    const allowUnknown = showUnknownRoutes.value;
    const isAllowedRoute = (routeId: number) =>
        allowUnknown || knownRouteIdsSet.value.has(routeId);
    const direction =
        directionFilter.value === "all" ? null : Number(directionFilter.value);
    if (showAllVehicles.value) {
        const filtered = showStaleVehicles.value
            ? latestVehicles.value.filter(
                  (vehicle) =>
                      isAllowedRoute(vehicle.route_id) &&
                      (direction === null ||
                          getVehicleDirectionId(vehicle.trip_id) === direction),
              )
            : latestVehicles.value.filter(
                  (vehicle) =>
                      !isVehicleStale(vehicle) &&
                      isAllowedRoute(vehicle.route_id) &&
                      (direction === null ||
                          getVehicleDirectionId(vehicle.trip_id) === direction),
              );
        updateMarkers(filtered);
        return;
    }
    const selected = selectedRoutesSet.value;
    const filtered =
        selected.size === 0
            ? latestVehicles.value.filter(
                  (vehicle) =>
                      knownRouteIdsSet.value.has(vehicle.route_id) &&
                      (showStaleVehicles.value || !isVehicleStale(vehicle)) &&
                      isAllowedRoute(vehicle.route_id) &&
                      (direction === null ||
                          getVehicleDirectionId(vehicle.trip_id) === direction),
              )
            : latestVehicles.value.filter(
                  (vehicle) =>
                      selected.has(vehicle.route_id) &&
                      (showStaleVehicles.value || !isVehicleStale(vehicle)) &&
                      isAllowedRoute(vehicle.route_id) &&
                      (direction === null ||
                          getVehicleDirectionId(vehicle.trip_id) === direction),
              );
    updateMarkers(filtered);
    if (
        selectedVehicle.value &&
        ((selected.size > 0 && !selected.has(selectedVehicle.value.route_id)) ||
            (selected.size === 0 &&
                !knownRouteIdsSet.value.has(selectedVehicle.value.route_id)))
    ) {
        selectedVehicle.value = null;
    }
};

const applyRouteLayers = () => {
    clearRouteLayers();
    const direction =
        directionFilter.value === "all" ? null : Number(directionFilter.value);
    const routeIds = routeIdsToShow.value;
    if (routeIds.length === 0) return;

    routeIds.forEach((routeId) => {
        const color = getRouteColor(routeId);
        const tripsForRoute = trips.value.filter(
            (trip) =>
                trip.route_id === routeId &&
                (direction === null || trip.direction_id === direction),
        );
        if (tripsForRoute.length === 0) return;

        const tripsByDirection = new Map<number, Trip>();
        tripsForRoute.forEach((trip) => {
            if (!tripsByDirection.has(trip.direction_id)) {
                tripsByDirection.set(trip.direction_id, trip);
            }
        });

        tripsByDirection.forEach((trip) => {
            const points = shapesById.value.get(trip.shape_id);
            if (points) {
                addPolyline(points, color);
            }
            // Stops are shown globally now.
        });
    });
};

const refreshRouteLayersIfReady = () => {
    if (routeIdsToShow.value.length === 0) return;
    if (shapesById.value.size === 0) return;
    applyRouteLayers();
};

const fetchVehicles = async () => {
    loadState.value = "loading";
    errorMessage.value = null;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        const payload = await response.json();
        const vehicles = Array.isArray(payload)
            ? (payload as Vehicle[])
            : ((payload?.vehicles ?? []) as Vehicle[]);
        latestVehicles.value = vehicles;
        applyVehicleFilter();
        if (selectedVehicle.value) {
            const updated = vehicles.find(
                (vehicle) => vehicle.id === selectedVehicle.value?.id,
            );
            selectedVehicle.value = updated ?? null;
        }
        lastFetch.value = payload?.fetchedAt
            ? new Date(payload.fetchedAt)
            : new Date();
        loadState.value = "idle";
    } catch (error) {
        loadState.value = "error";
        errorMessage.value =
            error instanceof Error ? error.message : "Failed to load vehicles";
    }
};

const fetchTrips = async () => {
    tripsLoadState.value = "loading";
    tripsError.value = null;
    try {
        const response = await fetch(tripsUrl);
        if (!response.ok) {
            throw new Error(`Trips API error: ${response.status}`);
        }
        trips.value = (await response.json()) as Trip[];
        tripsLoadState.value = "idle";
        refreshRouteLayersIfReady();
    } catch (error) {
        tripsLoadState.value = "error";
        tripsError.value =
            error instanceof Error ? error.message : "Failed to load trips";
    }
};

const fetchShapes = async () => {
    if (shapesById.value.size > 0) return;
    shapesLoadState.value = "loading";
    shapesError.value = null;
    try {
        const response = await fetch(shapesUrl);
        if (!response.ok) {
            throw new Error(`Shapes API error: ${response.status}`);
        }
        const data = (await response.json()) as ShapePoint[];
        buildShapesIndex(data);
        shapesLoadState.value = "idle";
        refreshRouteLayersIfReady();
    } catch (error) {
        shapesLoadState.value = "error";
        shapesError.value =
            error instanceof Error ? error.message : "Failed to load shapes";
    }
};

const fetchStops = async () => {
    stopsLoadState.value = "loading";
    stopsError.value = null;
    try {
        const response = await fetch(stopsUrl);
        if (!response.ok) {
            throw new Error(`Stops API error: ${response.status}`);
        }
        const data = (await response.json()) as Stop[];
        buildStopsIndex(data);
        stopsLoadState.value = "idle";
        addAllStops();
        refreshRouteLayersIfReady();
    } catch (error) {
        stopsLoadState.value = "error";
        stopsError.value =
            error instanceof Error ? error.message : "Failed to load stops";
    }
};

const fetchStopTimes = async () => {
    stopTimesLoadState.value = "loading";
    stopTimesError.value = null;
    try {
        const response = await fetch(stopTimesUrl);
        if (!response.ok) {
            throw new Error(`Stop times API error: ${response.status}`);
        }
        const data = (await response.json()) as StopTime[];
        buildStopTimesIndex(data);
        stopTimesLoadState.value = "idle";
        updateStopStyles();
        refreshRouteLayersIfReady();
    } catch (error) {
        stopTimesLoadState.value = "error";
        stopTimesError.value =
            error instanceof Error
                ? error.message
                : "Failed to load stop times";
    }
};

const fetchRoutes = async () => {
    routesLoadState.value = "loading";
    routesError.value = null;
    try {
        const response = await fetch(routesUrl);
        if (!response.ok) {
            throw new Error(`Routes API error: ${response.status}`);
        }
        const data = (await response.json()) as Route[];
        routes.value = data.sort((a, b) =>
            a.route_short_name.localeCompare(b.route_short_name, "en", {
                numeric: true,
            }),
        );
        routesLoadState.value = "idle";
        applyVehicleFilter();
        if (showAllRoutes.value) {
            fetchShapes().then(refreshRouteLayersIfReady);
        }
    } catch (error) {
        routesLoadState.value = "error";
        routesError.value =
            error instanceof Error ? error.message : "Failed to load routes";
    }
};

const initMap = async () => {
    if (!mapEl.value) return;
    await loadLeaflet();
    const L = window.L;

    const mapInstance = L.map(mapEl.value, {
        zoomControl: false,
    });
    mapInstance.createPane("routes").style.zIndex = "400";
    mapInstance.createPane("stops").style.zIndex = "550";
    map = mapInstance;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapInstance);

    mapInstance.setView([47.16, 27.58], 12);
    L.control.zoom({ position: "bottomright" }).addTo(mapInstance);

    fetchRoutes();
    fetchTrips();
    fetchStops();
    fetchStopTimes();
    await fetchVehicles();
    refreshTimer = window.setInterval(fetchVehicles, 20000);
};

onMounted(() => {
    checkMobile();
    window.addEventListener("resize", checkMobile);
    initMap();
    tickTimer = window.setInterval(() => {
        nowTick.value = Date.now();
    }, 10_000);
    try {
        const stored = localStorage.getItem("local-bus:favorites");
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                favoriteRouteIds.value = parsed
                    .map((value) => Number(value))
                    .filter((value) => !Number.isNaN(value));
            }
        }
    } catch (error) {
        console.warn("Failed to load favorites", error);
    }
});

watch(
    selectedRouteIds,
    () => {
        applyVehicleFilter();
        updateStopStyles();
        if (routeIdsToShow.value.length > 0) {
            fetchShapes().then(refreshRouteLayersIfReady);
        } else {
            clearRouteLayers();
        }
    },
    { deep: true },
);

watch(directionFilter, () => {
    refreshRouteLayersIfReady();
    applyVehicleFilter();
});

watch(
    stopsById,
    () => {
        addAllStops();
    },
    { deep: true },
);

watch(selectedStop, () => {
    updateSelectedStopHighlight();
    if (selectedStop.value && isMobile.value) {
        mobileStopOpen.value = true;
    } else if (selectedStop.value && !isMobile.value) {
        desktopStopOpen.value = true;
    }
});

watch(selectedVehicle, () => {
    applyVehicleFilter();
    if (selectedVehicle.value && isMobile.value) {
        selectedStop.value = null;
        mobileStopOpen.value = false;
    } else if (selectedVehicle.value && !isMobile.value) {
        selectedStop.value = null;
        desktopStopOpen.value = false;
    }
});

watch(mobileStopOpen, (value) => {
    if (!value) {
        selectedStop.value = null;
    }
});

watch(desktopStopOpen, (value) => {
    if (!value) {
        selectedStop.value = null;
    }
});

watch(isMobile, (value) => {
    if (selectedStop.value) {
        if (value) {
            mobileStopOpen.value = true;
            desktopStopOpen.value = false;
        } else {
            mobileStopOpen.value = false;
            desktopStopOpen.value = true;
        }
    }
});

watch(showAllVehicles, () => {
    applyVehicleFilter();
});

watch(selectedVehicle, () => {
    applyVehicleFilter();
});

watch(showStaleVehicles, () => {
    applyVehicleFilter();
});

watch(showUnknownRoutes, () => {
    applyVehicleFilter();
});

watch([selectedVehicle, selectedStop], ([vehicle, stop]) => {
    if (!vehicle && !stop) {
        savedRouteView.value = null;
    }
});

watch(showAllRoutes, () => {
    updateStopStyles();
    if (routeIdsToShow.value.length > 0) {
        fetchShapes().then(refreshRouteLayersIfReady);
    } else {
        clearRouteLayers();
    }
});

watch(
    favoriteRouteIds,
    (next) => {
        try {
            localStorage.setItem("local-bus:favorites", JSON.stringify(next));
        } catch (error) {
            console.warn("Failed to save favorites", error);
        }
    },
    { deep: true },
);

onBeforeUnmount(() => {
    window.removeEventListener("resize", checkMobile);
    if (refreshTimer) {
        window.clearInterval(refreshTimer);
    }
    if (tickTimer) {
        window.clearInterval(tickTimer);
    }
    map?.remove();
});
</script>

<template>
    <section class="flex min-h-screen w-full">
        <aside
            class="hidden md:flex h-screen w-80 xl:w-96 flex-col border-r border-slate-200 bg-white/95 px-4 py-2 backdrop-blur"
        >
            <div class="mt-2 flex items-center justify-between">
                <div class="flex items-baseline gap-2">
                    <div class="text-xs font-semibold text-slate-700">
                        Routes
                    </div>
                    <span class="text-[11px] text-slate-500">
                        {{
                            showAllRoutes || selectedRouteIds.length === 0
                                ? "All routes"
                                : `${selectedRouteIds.length} selected`
                        }}
                    </span>
                </div>
                <Button
                    v-if="selectedRouteIds.length > 0"
                    size="sm"
                    variant="ghost"
                    class="text-[11px] h-6"
                    @click="resetRouteSelection"
                >
                    Reset
                </Button>
            </div>
            <div class="mt-2">
                <Input
                    v-model="routeSearch"
                    placeholder="Search routes"
                    class="h-8 text-xs"
                />
            </div>
            <div class="mt-2 flex-1 overflow-y-auto pr-1">
                <RouteList
                    :routes="routes"
                    :filtered-routes="filteredRoutes"
                    :unknown-route-ids="unknownRouteIds"
                    :is-route-selected="isRouteSelected"
                    :is-route-favorite="isRouteFavorite"
                    :toggle-route-selection="toggleRouteSelection"
                    :toggle-favorite-route="toggleFavoriteRoute"
                    :should-show-unknown-routes="shouldShowUnknownRoutes"
                    />
                <DirectionFilter :direction-filter="directionFilter" @change="directionFilter = $event" />
            </div>
            <div
                v-if="routesLoadState === 'loading'"
                class="mt-3 text-[11px] text-slate-500"
            >
                Loading routes...
            </div>
            <div
                v-if="routesLoadState === 'error'"
                class="mt-2 text-[11px] text-red-600"
            >
                {{ routesError }}
            </div>
            <div
                v-if="routeIdsToShow.length > 0"
                class="mt-2 text-[11px] text-slate-500"
            >
                <span
                    v-if="
                        shapesLoadState === 'loading' ||
                        tripsLoadState === 'loading' ||
                        stopsLoadState === 'loading' ||
                        stopTimesLoadState === 'loading'
                    "
                >
                    Loading route layers...
                </span>
            </div>
            <div
                v-if="shapesError || tripsError || stopsError || stopTimesError"
                class="mt-2 text-[11px] text-red-600"
            >
                {{ shapesError || tripsError || stopsError || stopTimesError }}
            </div>
            <div class="mt-auto pt-4 text-xs text-slate-500">
                <span v-if="lastFetch">
                    Last update: {{ lastFetch.toLocaleTimeString() }}
                </span>
                <span v-else>Waiting for data...</span>
                <div
                    v-if="loadState === 'loading'"
                    class="mt-2 text-xs text-slate-500"
                >
                    Loading vehicles...
                </div>
                <div
                    v-if="loadState === 'error'"
                    class="mt-2 text-xs text-red-600"
                >
                    {{ errorMessage }}
                </div>
            </div>
        </aside>

        <div class="relative flex-1">
            <div
                class="absolute top-0 left-0 right-0 pt-4 px-4 z-1000 flex items-center gap-3 max-w-full overflow-x-auto scrollbar-hide flex-nowrap"
            >
                <Drawer v-model:open="mobileRoutesOpen">
                    <DrawerTrigger as-child>
                        <button
                            type="button"
                            class="md:hidden flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm transition hover:bg-white flex-shrink-0"
                            aria-label="Open routes"
                            title="Routes"
                        >
                            <Layers class="h-4 w-4" />
                        </button>
                    </DrawerTrigger>
                    <DrawerContent class="h-[80vh]">
                        <DrawerHeader class="border-b pb-4">
                            <div class="flex items-center justify-between">
                                <DrawerTitle>Routes</DrawerTitle>
                                <DrawerClose as-child>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8"
                                    >
                                        <X class="h-4 w-4" />
                                    </Button>
                                </DrawerClose>
                            </div>
                        </DrawerHeader>
                        <div class="flex-1 overflow-y-auto p-4">
                            <div class="mt-2">
                                <Input
                                    v-model="routeSearch"
                                    placeholder="Search routes"
                                    class="h-8 text-xs"
                                />
                            </div>
                            <RouteList
                                id-prefix="mobile-"
                                :routes="routes"
                                :filtered-routes="filteredRoutes"
                                :unknown-route-ids="unknownRouteIds"
                                :is-route-selected="isRouteSelected"
                                :is-route-favorite="isRouteFavorite"
                                :toggle-route-selection="toggleRouteSelection"
                                :toggle-favorite-route="toggleFavoriteRoute"
                                :should-show-unknown-routes="shouldShowUnknownRoutes"
                            />
                            <DirectionFilter :direction-filter="directionFilter" @change="directionFilter = $event" />
                        </div>
                    </DrawerContent>
                </Drawer>

                <div
                    v-if="favoriteRouteIds.length > 0"
                    class="flex h-9 items-center gap-3 rounded-full bg-white/90 px-2 py-1 text-sm shadow-sm flex-shrink-0"
                >
                    <button
                        type="button"
                        class="rounded-full p-1 text-amber-500 shrink-0"
                        title="Show all favorites"
                        @click="applyAllFavorites"
                    >
                        <Star class="h-4 w-4 fill-amber-500" />
                    </button>
                    <div class="flex gap-1.5 flex-nowrap">
                        <button
                            v-for="routeId in favoriteRouteIds"
                            :key="routeId"
                            type="button"
                            class="rounded-full px-2 py-0.5 font-semibold text-slate-700 transition shrink-0 whitespace-nowrap"
                            :class="
                                isRouteSelected(routeId)
                                    ? 'bg-slate-900 text-white'
                                    : 'hover:bg-slate-100'
                            "
                            @click="openRouteFromFavorite(routeId)"
                            :title="`Show ${getRouteShortName(routeId)}`"
                        >
                            {{ getRouteShortName(routeId) }}
                        </button>
                    </div>
                </div>
                <div
                    class="flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold shadow-sm flex-shrink-0"
                >
                    <span class="flex items-center gap-2 text-slate-700">
                        <span
                            class="h-2 w-2 rounded-full bg-emerald-500"
                        ></span>
                        {{ onlineVehiclesCount }}
                    </span>
                    <span class="text-slate-400">|</span>
                    <span class="text-slate-700">
                        {{ onlineRoutesCount }} routes
                    </span>
                </div>
                <Dialog v-model:open="debugOpen">
                    <DialogTrigger as-child>
                        <button
                            type="button"
                            class="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-sm transition hover:bg-white flex-shrink-0"
                            aria-label="Open debug"
                            title="Debug"
                        >
                            <Bug class="h-4 w-4" />
                        </button>
                    </DialogTrigger>
                    <DialogContent class="max-w-sm">
                        <DialogHeader>
                            <DialogTitle>Debug</DialogTitle>
                        </DialogHeader>
                        <div class="mt-4 space-y-3 text-xs">
                            <label
                                class="flex items-center gap-2 text-slate-600"
                            >
                                <Checkbox
                                    :model-value="showAllVehicles"
                                    @update:model-value="setShowAllVehicles"
                                />
                                <span>All vehicles</span>
                            </label>
                            <label
                                class="flex items-center gap-2 text-slate-600"
                            >
                                <Checkbox
                                    :model-value="showAllRoutes"
                                    @update:model-value="setShowAllRoutes"
                                />
                                <span>All routes</span>
                            </label>
                            <label
                                class="flex items-center gap-2 text-slate-600"
                            >
                                <Checkbox
                                    :model-value="showStaleVehicles"
                                    @update:model-value="
                                        (val) =>
                                            (showStaleVehicles = val === true)
                                    "
                                />
                                <span>Show stale vehicles (60m+)</span>
                            </label>
                            <label
                                class="flex items-center gap-2 text-slate-600"
                            >
                                <Checkbox
                                    :model-value="showUnknownRoutes"
                                    @update:model-value="
                                        (val) =>
                                            (showUnknownRoutes = val === true)
                                    "
                                />
                                <span>Show unknown routes + vehicles</span>
                            </label>
                            <div class="grid grid-cols-2 gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="
                                        downloadDataset('routes', routesUrl)
                                    "
                                >
                                    routes.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="downloadDataset('trips', tripsUrl)"
                                >
                                    trips.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="
                                        downloadDataset('shapes', shapesUrl)
                                    "
                                >
                                    shapes.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="downloadDataset('stops', stopsUrl)"
                                >
                                    stops.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="
                                        downloadDataset(
                                            'stop_times',
                                            stopTimesUrl,
                                        )
                                    "
                                >
                                    stop_times.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    @click="downloadDataset('vehicles', apiUrl)"
                                >
                                    vehicles.txt
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
            <div ref="mapEl" class="relative z-0 h-screen w-full"></div>

            <div
                v-if="selectedVehicle"
                class="absolute bottom-4 left-4 right-4 z-1000 md:left-auto md:right-4 md:w-80 xl:w-96 rounded-xl bg-white/95 p-4 shadow-lg backdrop-blur"
            >
                <div v-if="selectedVehicle">
                    <div class="flex items-center justify-between">
                        <h2 class="text-base font-semibold text-slate-900">
                            Vehicle {{ selectedVehicle.label }}
                        </h2>
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-slate-500">
                                ID {{ selectedVehicle.id }}
                            </span>
                            <button
                                type="button"
                                class="rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-white"
                                @click="clearSelection"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                    <div
                        class="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600"
                    >
                        <div>
                            Route:
                            <span class="font-semibold text-slate-800">
                                {{
                                    selectedVehicle.route_id
                                        ? getRouteShortName(
                                              selectedVehicle.route_id,
                                          )
                                        : "N/A"
                                }}
                            </span>
                        </div>
                        <div>
                            Direction:
                            <span class="font-semibold text-slate-800">
                                {{
                                    getVehicleDirectionLabel(
                                        selectedVehicle.trip_id,
                                    )
                                }}
                            </span>
                        </div>
                        <div>
                            Speed:
                            <span class="font-semibold text-slate-800">
                                {{ selectedVehicle.speed }} km/h
                            </span>
                        </div>
                        <div>
                            Updated:
                            <span class="font-semibold text-slate-800">
                                {{
                                    formatRelativeTime(
                                        selectedVehicle.timestamp,
                                    )
                                }}
                            </span>
                        </div>
                        <div class="col-span-2">
                            Route info:
                            <span class="font-semibold text-slate-800">
                                {{
                                    selectedVehicle.route_id
                                        ? getRouteDescription(
                                              selectedVehicle.route_id,
                                          )
                                        : "N/A"
                                }}
                            </span>
                        </div>
                        <div>
                            Bike:
                            <span class="font-semibold text-slate-800">
                                {{ selectedVehicle.bike_accessible }}
                            </span>
                        </div>
                        <div>
                            Wheelchair:
                            <span class="font-semibold text-slate-800">
                                {{ selectedVehicle.wheelchair_accessible }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <Drawer v-model:open="mobileStopOpen">
                <DrawerContent v-if="selectedStop" class="h-[70vh]">
                    <DrawerHeader class="border-b pb-4">
                        <div class="flex items-center justify-between">
                            <DrawerTitle>Stop Details</DrawerTitle>
                            <DrawerClose as-child>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-8 w-8"
                                >
                                    <X class="h-4 w-4" />
                                </Button>
                            </DrawerClose>
                        </div>
                    </DrawerHeader>
                    <div class="flex-1 overflow-y-auto p-4">
                        <StopPanel
                            :stop="selectedStop"
                            :stop-route-labels="
                                getStopRouteLabels(selectedStop.stop_id)
                            "
                            :stop-route-ids="
                                getStopRouteIds(selectedStop.stop_id)
                            "
                            :trip-count="getStopTripCount(selectedStop.stop_id)"
                            :is-stop-all-active="
                                isStopAllActive(selectedStop.stop_id)
                            "
                            :show-all-routes="showAllRoutes"
                            :is-route-selected="isRouteSelected"
                            :get-route-short-name="getRouteShortName"
                            :get-stop-location-type-label="
                                getStopLocationTypeLabel
                            "
                            :on-apply-stop-routes="
                                selectedStopId != null
                                    ? () => applyStopRoutes(selectedStopId!)
                                    : () => {}
                            "
                            :on-toggle-stop-route="
                                selectedStopId != null
                                    ? (routeId: number) =>
                                          toggleStopRoute(
                                              routeId,
                                              selectedStopId!,
                                          )
                                    : () => {}
                            "
                            :analytics="getStopAnalytics(selectedStop.stop_id)"
                            :analytics-state="stopAnalyticsState"
                            :analytics-error="stopAnalyticsError"
                        />
                    </div>
                </DrawerContent>
            </Drawer>

            <Dialog v-model:open="desktopStopOpen">
                <DialogContent
                    v-if="selectedStop"
                    no-overlay
                    class="hidden md:block left-auto right-4 bottom-4 top-auto w-80 xl:w-96 translate-x-0 translate-y-0"
                >
                    <DialogHeader>
                        <DialogTitle>Stop details</DialogTitle>
                        <button
                            type="button"
                            class="absolute right-4 top-4"
                            @click="clearSelection"
                        >
                            <X class="h-4 w-4" />
                        </button>
                    </DialogHeader>
                    <StopPanel
                        class="mt-2"
                        :stop="selectedStop"
                        :stop-route-labels="
                            getStopRouteLabels(selectedStop.stop_id)
                        "
                        :stop-route-ids="getStopRouteIds(selectedStop.stop_id)"
                        :trip-count="getStopTripCount(selectedStop.stop_id)"
                        :is-stop-all-active="
                            isStopAllActive(selectedStop.stop_id)
                        "
                        :show-all-routes="showAllRoutes"
                        :is-route-selected="isRouteSelected"
                        :get-route-short-name="getRouteShortName"
                        :get-stop-location-type-label="getStopLocationTypeLabel"
                        :on-apply-stop-routes="
                            selectedStopId != null
                                ? () => applyStopRoutes(selectedStopId!)
                                : () => {}
                        "
                        :on-toggle-stop-route="
                            selectedStopId != null
                                ? (routeId: number) =>
                                      toggleStopRoute(routeId, selectedStopId!)
                                : () => {}
                        "
                        :analytics="getStopAnalytics(selectedStop.stop_id)"
                        :analytics-state="stopAnalyticsState"
                        :analytics-error="stopAnalyticsError"
                    />
                </DialogContent>
            </Dialog>
        </div>
    </section>
</template>

<style scoped>
:global(.leaflet-container) {
    font-family: "Montserrat", sans-serif;
}

:global(.vehicle-icon) {
    background: transparent;
    border: none;
    overflow: visible;
}

:global(.vehicle-marker) {
    position: relative;
    display: block;
    width: 16px;
    height: 16px;
    transform: rotate(var(--vehicle-rotation));
    transform-origin: 50% 50%;
}

:global(.vehicle-marker.is-unknown) {
    transform: none;
}

:global(.vehicle-marker.is-selected .vehicle-dot) {
    box-shadow:
        0 6px 12px rgba(15, 23, 42, 0.35),
        0 0 0 3px rgba(253, 230, 138, 0.9);
}

:global(.vehicle-marker.is-selected .vehicle-arrow) {
    filter: drop-shadow(0 3px 6px rgba(15, 23, 42, 0.35));
}

:global(.vehicle-arrow) {
    position: absolute;
    left: 50%;
    top: -8px;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 10px solid var(--vehicle-color);
    transform: translateX(-50%);
    filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.25));
}

:global(.vehicle-marker.is-unknown .vehicle-arrow) {
    opacity: 0;
}

:global(.vehicle-dot) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 2px solid white;
    background: var(--vehicle-color);
    box-shadow: 0 4px 8px rgba(15, 23, 42, 0.3);
}

.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
</style>
