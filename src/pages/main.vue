<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Bug, Star, X, Layers, Sun, Moon, Search, RotateCcw } from "lucide-vue-next";
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
const isDark = ref(false);
const isTouchUi = ref(false);
const statsInfoOpen = ref(false);
const statsInfoRef = ref<HTMLElement | null>(null);
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
let tileLayer: any = null;
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

const LIGHT_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

const normalizeHexColor = (value: string): string | null => {
    if (!value) return null;
    const raw = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
        const expanded = raw
            .split("")
            .map((ch) => `${ch}${ch}`)
            .join("");
        return `#${expanded.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
        return `#${raw.toLowerCase()}`;
    }
    return null;
};

const hexToHsl = (hex: string): [number, number, number] => {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
    const hue2rgb = (p: number, q: number, t: number) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    let r: number, g: number, b: number;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = (v: number) =>
        Math.round(v * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const ensureVisibleColor = (hex: string): string => {
    if (!hex || hex.length < 3) return hex;
    const normalized = normalizeHexColor(hex);
    if (!normalized) return hex;
    const [h, s, l] = hexToHsl(normalized);
    if (isDark.value && l < 0.42) {
        // Lift dark colors just enough for dark map contrast, without washing into white.
        const newL = Math.max(l, 0.45 + l * 0.3);
        const newS = s < 0.08 ? 0.08 : s;
        return hslToHex(h, newS, newL);
    }
    if (!isDark.value && l > 0.85) {
        return hslToHex(h, Math.min(s * 1.2, 1), Math.min(l, 0.7));
    }
    return normalized;
};

const toggleTheme = () => {
    isDark.value = !isDark.value;
    document.documentElement.classList.toggle("dark", isDark.value);
    localStorage.setItem("local-bus:theme", isDark.value ? "dark" : "light");
    if (map && tileLayer) {
        map.removeLayer(tileLayer);
        const L = window.L;
        tileLayer = L.tileLayer(isDark.value ? DARK_TILES : LIGHT_TILES, {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap & CartoDB",
        });
        tileLayer.addTo(map);
    }
    applyVehicleFilter();
    refreshRouteLayersIfReady();
    if (stopsById.value.size > 0) addAllStops();
};

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
        opacity: 0.9,
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
    const dark = isDark.value;
    return {
        radius: isSelected ? 7 : 5,
        color: isSelected ? (dark ? "#ffffff" : "#111111") : dark ? "rgba(255,255,255,0.3)" : "#0f172a",
        weight: isSelected ? 2.5 : dimStop ? (dark ? 0.8 : 1) : (dark ? 1.2 : 1.5),
        fillColor: isSelected ? (dark ? "#ffffff" : "#111111") : dark ? "rgba(255,255,255,0.7)" : "#ffffff",
        opacity: dimStop ? (dark ? 0.3 : 0.5) : (dark ? 0.8 : 0.9),
        fillOpacity: dimStop ? (dark ? 0.2 : 0.5) : isSelected ? 0.9 : (dark ? 0.5 : 0.9),
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

const refreshStatusText = computed(() => {
    if (lastFetch.value) {
        return `Updated ${lastFetch.value.toLocaleTimeString()}`;
    }
    return "Waiting for data...";
});

const onStatsInfoEnter = () => {
    if (isTouchUi.value) return;
    statsInfoOpen.value = true;
};

const onStatsInfoLeave = () => {
    if (isTouchUi.value) return;
    statsInfoOpen.value = false;
};

const onStatsInfoTap = () => {
    if (!isTouchUi.value) return;
    statsInfoOpen.value = !statsInfoOpen.value;
};

const onDocumentPointerDown = (event: Event) => {
    if (!isTouchUi.value || !statsInfoOpen.value) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (statsInfoRef.value?.contains(target)) return;
    statsInfoOpen.value = false;
};

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
    const raw = route?.route_color || (isDark.value ? "#a0a0b0" : "#0f172a");
    return ensureVisibleColor(raw);
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

    tileLayer = L.tileLayer(isDark.value ? DARK_TILES : LIGHT_TILES, {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap & CartoDB",
    });
    tileLayer.addTo(mapInstance);

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
    isTouchUi.value =
        window.matchMedia("(hover: none), (pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0;
    document.addEventListener("pointerdown", onDocumentPointerDown);
    try {
        const theme = localStorage.getItem("local-bus:theme");
        if (theme === "dark") {
            isDark.value = true;
            document.documentElement.classList.add("dark");
        }
    } catch {}
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
    document.removeEventListener("pointerdown", onDocumentPointerDown);
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
    <section class="overflow-hidden relative w-full h-screen">
        <aside
            class="hidden absolute top-4 bottom-4 left-4 flex-col px-4 py-4 w-80 rounded-2xl md:flex z-1000 xl:w-96 glass-strong glow-accent-sm"
        >
            <div class="flex justify-between items-center text-lg">
                <div class="flex gap-2 items-baseline">
                    <div class="font-bold tracking-tight text-foreground">
                        Routes
                    </div>
                    <span class="text-muted-foreground">
                        {{
                            showAllRoutes || selectedRouteIds.length === 0
                                ? "All"
                                : `${selectedRouteIds.length} selected`
                        }}
                    </span>
                </div>
                <Button
                    v-if="selectedRouteIds.length > 0"
                    variant="ghost"
                    size="icon"
                    class="w-7 h-7 text-muted-foreground hover:text-foreground"
                    aria-label="Reset route selection"
                    title="Reset route selection"
                    @click="resetRouteSelection"
                >
                    <RotateCcw class="w-3.5 h-3.5" />
                </Button>
            </div>
            <div class="relative mt-2">
                <Search class="absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                    v-model="routeSearch"
                    placeholder="Search routes..."
                    class="h-10 text-sm pl-8 bg-foreground/[0.03] border-foreground/[0.06] rounded-lg focus-visible:ring-primary/30 focus-visible:border-primary/40"
                />
            </div>
            <div class="overflow-y-auto flex-1 pr-1 mt-3 themed-scroll">
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
                class="mt-3 text-[11px] text-muted-foreground"
            >
                Loading routes...
            </div>
            <div
                v-if="routesLoadState === 'error'"
                class="mt-2 text-[11px] text-destructive"
            >
                {{ routesError }}
            </div>
            <div
                v-if="routeIdsToShow.length > 0"
                class="mt-2 text-[11px] text-muted-foreground"
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
                class="mt-2 text-[11px] text-destructive"
            >
                {{ shapesError || tripsError || stopsError || stopTimesError }}
            </div>
        </aside>

        <div class="absolute inset-0">
            <div
                class="absolute top-0 right-0 left-0 md:left-[calc(20rem+2.5rem)] xl:left-[calc(22rem+2.5rem)] pt-4 px-4 z-1000 flex items-center gap-3 max-w-full overflow-x-auto scrollbar-hide flex-nowrap"
            >
                <Drawer v-model:open="mobileRoutesOpen">
                    <DrawerTrigger as-child>
                        <button
                            type="button"
                            class="flex flex-shrink-0 justify-center items-center w-9 h-9 rounded-full border border-border/70 transition md:hidden glass text-muted-foreground hover:text-foreground glow-accent-sm"
                            aria-label="Open routes"
                            title="Routes"
                        >
                            <Layers class="w-4 h-4" />
                        </button>
                    </DrawerTrigger>
                    <DrawerContent class="h-[80vh] glass-strong">
                        <DrawerHeader class="pb-4 border-b border-border">
                            <div class="flex justify-between items-center">
                                <DrawerTitle class="text-foreground">Routes</DrawerTitle>
                                <DrawerClose as-child>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="w-8 h-8 text-muted-foreground hover:text-foreground"
                                    >
                                        <X class="w-4 h-4" />
                                    </Button>
                                </DrawerClose>
                            </div>
                        </DrawerHeader>
                        <div class="overflow-y-auto flex-1 p-4 themed-scroll">
                            <div class="relative mt-2">
                                <Search class="absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-muted-foreground/50" />
                                <Input
                                    v-model="routeSearch"
                                    placeholder="Search routes..."
                                    class="h-8 text-xs pl-8 bg-foreground/[0.03] border-foreground/[0.06] rounded-lg focus-visible:ring-primary/30 focus-visible:border-primary/40"
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
                    class="flex flex-shrink-0 gap-3 items-center px-2 py-1 h-9 text-sm rounded-full border border-border/70 glass glow-accent-sm"
                >
                    <button
                        type="button"
                        class="p-1 rounded-full text-primary shrink-0"
                        title="Show all favorites"
                        @click="applyAllFavorites"
                    >
                        <Star class="w-4 h-4 fill-primary" />
                    </button>
                    <div class="flex flex-nowrap gap-1.5">
                        <button
                            v-for="routeId in favoriteRouteIds"
                            :key="routeId"
                            type="button"
                            class="px-2 py-0.5 font-semibold whitespace-nowrap rounded-full transition shrink-0"
                            :class="
                                isRouteSelected(routeId)
                                    ? 'bg-foreground text-background hover:bg-foreground/90'
                                    : 'text-foreground/70 hover:bg-foreground/10'
                            "
                            @click="openRouteFromFavorite(routeId)"
                            :title="`Show ${getRouteShortName(routeId)}`"
                        >
                            {{ getRouteShortName(routeId) }}
                        </button>
                    </div>
                </div>
                <div
                    ref="statsInfoRef"
                    class="relative flex-shrink-0"
                    @mouseenter="onStatsInfoEnter"
                    @mouseleave="onStatsInfoLeave"
                >
                    <button
                        type="button"
                        class="flex gap-1.5 items-center px-3 py-1 h-9 text-sm font-semibold rounded-full border border-border/70 glass glow-accent-sm"
                        :aria-label="refreshStatusText"
                        :title="isTouchUi ? undefined : refreshStatusText"
                        @click="onStatsInfoTap"
                        @focus="onStatsInfoEnter"
                        @blur="onStatsInfoLeave"
                    >
                        <span class="flex gap-2 items-center text-foreground">
                            <span
                                class="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                            ></span>
                            {{ onlineVehiclesCount }}
                        </span>
                        <span class="text-muted-foreground">|</span>
                        <span class="text-foreground">
                            {{ onlineRoutesCount }} routes
                        </span>
                    </button>
                    <div
                        v-if="statsInfoOpen"
                        class="absolute top-full right-0 mt-2 min-w-44 rounded-lg border border-border bg-card/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur"
                    >
                        <div class="text-foreground">{{ refreshStatusText }}</div>
                        <div
                            v-if="loadState === 'loading'"
                            class="mt-1 text-muted-foreground"
                        >
                            loading...
                        </div>
                        <div
                            v-if="loadState === 'error'"
                            class="mt-1 text-destructive"
                        >
                            {{ errorMessage }}
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    class="flex flex-shrink-0 justify-center items-center w-9 h-9 rounded-full border border-border/70 transition glass text-muted-foreground hover:text-foreground glow-accent-sm"
                    :aria-label="isDark ? 'Switch to light' : 'Switch to dark'"
                    :title="isDark ? 'Light mode' : 'Dark mode'"
                    @click="toggleTheme"
                >
                    <Moon v-if="!isDark" class="w-4 h-4" />
                    <Sun v-else class="w-4 h-4" />
                </button>
                <Dialog v-model:open="debugOpen">
                    <DialogTrigger as-child>
                        <button
                            type="button"
                            class="flex flex-shrink-0 justify-center items-center w-9 h-9 rounded-full border border-border/70 transition glass text-muted-foreground hover:text-foreground glow-accent-sm"
                            aria-label="Open debug"
                            title="Debug"
                        >
                            <Bug class="w-4 h-4" />
                        </button>
                    </DialogTrigger>
                    <DialogContent class="max-w-sm glass-strong">
                        <DialogHeader>
                            <DialogTitle>Debug</DialogTitle>
                        </DialogHeader>
                        <div class="mt-4 space-y-3 text-xs">
                            <label
                                class="flex gap-2 items-center text-muted-foreground"
                            >
                                <Checkbox
                                    :model-value="showAllVehicles"
                                    @update:model-value="setShowAllVehicles"
                                />
                                <span>All vehicles</span>
                            </label>
                            <label
                                class="flex gap-2 items-center text-muted-foreground"
                            >
                                <Checkbox
                                    :model-value="showAllRoutes"
                                    @update:model-value="setShowAllRoutes"
                                />
                                <span>All routes</span>
                            </label>
                            <label
                                class="flex gap-2 items-center text-muted-foreground"
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
                                class="flex gap-2 items-center text-muted-foreground"
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
                                    class=""
                                    @click="downloadDataset('trips', tripsUrl)"
                                >
                                    trips.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class=""
                                    @click="
                                        downloadDataset('shapes', shapesUrl)
                                    "
                                >
                                    shapes.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class=""
                                    @click="downloadDataset('stops', stopsUrl)"
                                >
                                    stops.txt
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class=""
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
                                    class=""
                                    @click="downloadDataset('vehicles', apiUrl)"
                                >
                                    vehicles.txt
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
            <div ref="mapEl" class="absolute inset-0 z-0"></div>

            <div
                v-if="selectedVehicle"
                class="absolute right-4 bottom-4 left-4 p-4 rounded-2xl transition-colors z-1000 md:left-auto md:right-4 md:w-80 xl:w-96 glass-strong glow-accent"
            >
                <div v-if="selectedVehicle">
                    <div class="flex justify-between items-center">
                        <h2 class="text-base font-semibold text-foreground">
                            Vehicle {{ selectedVehicle.label }}
                        </h2>
                        <div class="flex gap-2 items-center">
                            <span class="text-xs text-muted-foreground">
                                ID {{ selectedVehicle.id }}
                            </span>
                            <button
                                type="button"
                                class="rounded-full bg-foreground/10 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-foreground/20 hover:text-foreground"
                                @click="clearSelection"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                    <div
                        class="grid grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground"
                    >
                        <div>
                            Route:
                            <span class="font-semibold text-foreground">
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
                            <span class="font-semibold text-foreground">
                                {{
                                    getVehicleDirectionLabel(
                                        selectedVehicle.trip_id,
                                    )
                                }}
                            </span>
                        </div>
                        <div>
                            Speed:
                            <span class="font-semibold text-foreground">
                                {{ selectedVehicle.speed }} km/h
                            </span>
                        </div>
                        <div>
                            Updated:
                            <span class="font-semibold text-foreground">
                                {{
                                    formatRelativeTime(
                                        selectedVehicle.timestamp,
                                    )
                                }}
                            </span>
                        </div>
                        <div class="col-span-2">
                            Route info:
                            <span class="font-semibold text-foreground">
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
                            <span class="font-semibold text-foreground">
                                {{ selectedVehicle.bike_accessible }}
                            </span>
                        </div>
                        <div>
                            Wheelchair:
                            <span class="font-semibold text-foreground">
                                {{ selectedVehicle.wheelchair_accessible }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <Drawer v-model:open="mobileStopOpen">
                <DrawerContent v-if="selectedStop" class="h-[70vh] glass-strong">
                    <DrawerHeader class="pb-4 border-b border-border">
                        <div class="flex justify-between items-center">
                            <DrawerTitle class="text-foreground">Stop Details</DrawerTitle>
                            <DrawerClose as-child>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="w-8 h-8 text-muted-foreground hover:text-foreground"
                                >
                                    <X class="w-4 h-4" />
                                </Button>
                            </DrawerClose>
                        </div>
                    </DrawerHeader>
                    <div class="overflow-y-auto flex-1 p-4 themed-scroll">
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
                            :ensure-visible-color="ensureVisibleColor"
                        />
                    </div>
                </DrawerContent>
            </Drawer>

            <Dialog v-model:open="desktopStopOpen">
                <DialogContent
                    v-if="selectedStop"
                    no-overlay
                    class="hidden right-4 bottom-4 top-auto left-auto w-80 translate-x-0 translate-y-0 md:block xl:w-96 glass-strong glow-accent"
                >
                    <DialogHeader>
                        <DialogTitle>Stop details</DialogTitle>
                        <button
                            type="button"
                            class="absolute top-4 right-4 transition text-muted-foreground hover:text-foreground"
                            @click="clearSelection"
                        >
                            <X class="w-4 h-4" />
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
        0 0 10px rgba(0, 0, 0, 0.35),
        0 0 0 3px rgba(0, 0, 0, 0.2);
}

:global(.vehicle-marker.is-selected .vehicle-arrow) {
    filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.3));
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
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
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
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

:global(.dark .vehicle-dot) {
    border-color: rgba(255, 255, 255, 0.35);
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.4), 0 0 4px var(--vehicle-color);
}

.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
</style>
