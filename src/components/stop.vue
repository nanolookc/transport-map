<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

type Stop = {
    stop_id: number;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
    location_type: number;
    stop_code: string;
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
    window: {
        offset: number;
        canGoOlder: boolean;
        canGoNewer: boolean;
    };
};

type LiveStopArrivals = {
    fetchedAt: string | null;
    arrivals: Array<{
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
        status:
            | "arriving"
            | "moving"
            | "stopped_on_route"
            | "waiting_at_terminal"
            | "arrived_terminal"
            | "off_route"
            | "stale"
            | "unknown";
        confidence: "high" | "medium" | "low";
        reason: string;
        vehicleTimestamp: string | null;
        fetchedAt: string;
    }>;
    diagnostics: {
        liveVehicles: number;
        candidateTrips: number;
        excludedPassedStop: number;
        excludedUnusableState: number;
    };
};

const props = defineProps<{
    stop: Stop;
    stopRouteLabels: string[];
    stopRouteIds: number[];
    tripCount: number;
    isStopAllActive: boolean;
    showAllRoutes: boolean;
    isRouteSelected: (routeId: number) => boolean;
    getRouteShortName: (routeId: number) => string;
    getStopLocationTypeLabel: (value: number) => string;
    onApplyStopRoutes: () => void;
    onToggleStopRoute: (routeId: number) => void;
    analytics: StopAnalytics | null;
    analyticsState: "idle" | "loading" | "error";
    analyticsError: string | null;
    onChangeAnalyticsOffset: (offset: number) => void;
    liveArrivals: LiveStopArrivals | null;
    liveArrivalsState: "idle" | "loading" | "error";
    liveArrivalsError: string | null;
    ensureVisibleColor?: (hex: string) => string;
}>();

const safeColor = (hex: string) =>
    props.ensureVisibleColor ? props.ensureVisibleColor(hex) : hex;

const chartEl = ref<HTMLDivElement | null>(null);
const chartScrollEl = ref<HTMLDivElement | null>(null);
const chartHeight = ref(640);
const timelineZoom = ref(1);
const TIMELINE_BASE_HEIGHT = 1536;
const MIN_TIMELINE_ZOOM = 1;
const MAX_TIMELINE_ZOOM = 6;
let resizeObserver: ResizeObserver | null = null;

type TimelinePointer = { clientY: number };

const timelinePointers = new Map<number, TimelinePointer>();
let pinchState: {
    distance: number;
    zoom: number;
    anchorMinutes: number;
} | null = null;

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

const getPinchPointers = () => {
    const pointers = [...timelinePointers.values()];
    if (pointers.length < 2 || !pointers[0] || !pointers[1]) return null;
    return [pointers[0], pointers[1]] as const;
};

const getPinchDistance = (pointers: readonly [TimelinePointer, TimelinePointer]) =>
    Math.abs(pointers[0].clientY - pointers[1].clientY);

const getPinchCenterY = (pointers: readonly [TimelinePointer, TimelinePointer]) =>
    (pointers[0].clientY + pointers[1].clientY) / 2;

const connectResizeObserver = (el: HTMLDivElement | null) => {
    resizeObserver?.disconnect();
    if (!el) return;
    chartHeight.value = el.getBoundingClientRect().height || chartHeight.value;
    resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        chartHeight.value = entry.contentRect.height;
    });
    resizeObserver.observe(el);
};

watch(chartEl, (value) => {
    connectResizeObserver(value);
});

onMounted(() => {
    connectResizeObserver(chartEl.value);
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
});

const scrollToNow = () => {
    if (!chartScrollEl.value) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const range = displayRange.value;
    const view = chartScrollEl.value;
    const maxScroll = view.scrollHeight - view.clientHeight;
    if (nowMinutes <= range.min) {
        view.scrollTop = 0;
        return;
    }
    if (nowMinutes >= range.max) {
        view.scrollTop = maxScroll;
        return;
    }
    const ratio = (nowMinutes - range.min) / range.span;
    view.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio - 80));
};

watch(
    () => props.stop.stop_id,
    () => {
        requestAnimationFrame(scrollToNow);
    },
);

watch(
    () => props.analytics,
    (value) => {
        if (!value) return;
        requestAnimationFrame(scrollToNow);
    },
);

const graphRoutes = computed(() => props.analytics?.routes ?? []);
const graphSelectedSet = computed(() => {
    if (props.showAllRoutes) {
        return new Set(props.stopRouteIds);
    }
    return new Set(
        props.stopRouteIds.filter((routeId) => props.isRouteSelected(routeId)),
    );
});

const graphDays = computed(() => props.analytics?.days ?? []);
const dayCount = computed(() => Math.max(graphDays.value.length, 1));
const routeColorMap = computed(() => {
    const map = new Map<number, string>();
    graphRoutes.value.forEach((route) => {
        if (route.routeColor) {
            map.set(route.routeId, route.routeColor);
        }
    });
    return map;
});

const graphPoints = computed(() => {
    const points: Array<{
        key: string;
        dayIndex: number;
        minutes: number;
        timestamp: string;
        routeId: number;
        predicted: boolean;
        color: string;
    }> = [];
    graphDays.value.forEach((day, dayIndex) => {
        day.points.forEach((group) => {
            if (!graphSelectedSet.value.has(group.routeId)) return;
            const rawColor = routeColorMap.value.get(group.routeId) ?? "#111111";
            const color = safeColor(rawColor);
            group.timestamps.forEach((timestamp, index) => {
                const minutes = timestampToMinutes(timestamp);
                points.push({
                    key: `${day.date}-${group.routeId}-${timestamp}-${index}`,
                    dayIndex,
                    minutes,
                    timestamp,
                    routeId: group.routeId,
                    predicted: group.predicted,
                    color,
                });
            });
        });
    });
    return points;
});

const formatDayLabel = (value: string, isToday: boolean) => {
    if (isToday) return "Today";
    return value.slice(5);
};

const formatMinutes = (value: number) => {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const timestampToMinutes = (isoString: string) => {
    const date = new Date(isoString);
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
};

const displayRange = computed(() => {
    if (graphPoints.value.length === 0) {
        return { min: 0, max: 1440, span: 1440 };
    }
    const times = graphPoints.value.map((point) => point.minutes);
    const minValue = Math.min(...times);
    const maxValue = Math.max(...times);
    const min = Math.max(0, Math.floor((minValue - 60) / 15) * 15);
    const max = Math.min(1440, Math.ceil((maxValue + 60) / 15) * 15);
    const span = Math.max(1, max - min);
    return { min, max, span };
});

const chartStyle = computed(() => ({
    height: `${TIMELINE_BASE_HEIGHT * timelineZoom.value}px`,
}));

const getTimelineMinutesAt = (clientY: number) => {
    const chart = chartEl.value;
    if (!chart) return null;
    const rect = chart.getBoundingClientRect();
    if (rect.height === 0) return null;
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    const range = displayRange.value;
    return range.min + ratio * range.span;
};

const beginPinch = () => {
    const pointers = getPinchPointers();
    if (!pointers) return;
    const anchorMinutes = getTimelineMinutesAt(getPinchCenterY(pointers));
    if (anchorMinutes === null) return;
    pinchState = {
        distance: Math.max(getPinchDistance(pointers), 1),
        zoom: timelineZoom.value,
        anchorMinutes,
    };
};

const updatePinch = () => {
    if (!pinchState) return;
    const pointers = getPinchPointers();
    if (!pointers) return;
    const distance = Math.max(getPinchDistance(pointers), 1);
    timelineZoom.value = clamp(
        pinchState.zoom * (distance / pinchState.distance),
        MIN_TIMELINE_ZOOM,
        MAX_TIMELINE_ZOOM,
    );

    const scroll = chartScrollEl.value;
    if (!scroll) return;
    const centerY = getPinchCenterY(pointers);
    const range = displayRange.value;
    const anchorRatio = (pinchState.anchorMinutes - range.min) / range.span;
    requestAnimationFrame(() => {
        const viewportY = centerY - scroll.getBoundingClientRect().top;
        const anchorY = anchorRatio * TIMELINE_BASE_HEIGHT * timelineZoom.value;
        scroll.scrollTop = clamp(
            anchorY - viewportY,
            0,
            scroll.scrollHeight - scroll.clientHeight,
        );
    });
};

const onTimelinePointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    timelinePointers.set(event.pointerId, { clientY: event.clientY });
    if (timelinePointers.size === 2) beginPinch();
};

const onTimelinePointerMove = (event: PointerEvent) => {
    if (!timelinePointers.has(event.pointerId)) return;
    timelinePointers.set(event.pointerId, { clientY: event.clientY });
    if (!pinchState) return;
    if (event.cancelable) event.preventDefault();
    updatePinch();
};

const onTimelinePointerEnd = (event: PointerEvent) => {
    timelinePointers.delete(event.pointerId);
    if (timelinePointers.size < 2) pinchState = null;
};

const labelStepMinutes = computed(() => {
    const height = chartHeight.value;
    const span = displayRange.value.span;
    const per15 = height / (span / 15);
    if (per15 >= 8) return 15;
    const per30 = height / (span / 30);
    if (per30 >= 8) return 30;
    const per60 = height / (span / 60);
    if (per60 >= 8) return 60;
    return 120;
});

const timeLabels = computed(() => {
    const step = labelStepMinutes.value;
    const labels: Array<{ minutes: number; label: string }> = [];
    const range = displayRange.value;
    for (let value = range.min; value <= range.max; value += step) {
        labels.push({ minutes: value, label: formatMinutes(value) });
    }
    return labels;
});

const quarterTicks = computed(() => {
    if (labelStepMinutes.value <= 15) return [];
    const span = displayRange.value.span;
    const per15 = chartHeight.value / (span / 15);
    if (per15 < 4) return [];
    const values: number[] = [];
    const range = displayRange.value;
    for (let value = range.min; value <= range.max; value += 15) {
        values.push(value);
    }
    return values;
});

const pointStyle = (point: {
    dayIndex: number;
    minutes: number;
    timestamp: string;
    predicted: boolean;
    color: string;
}) => {
    const x = ((point.dayIndex + 0.5) / dayCount.value) * 100;
    const range = displayRange.value;
    const y = ((point.minutes - range.min) / range.span) * 100;
    return {
        left: `${x}%`,
        top: `${y}%`,
        backgroundColor: point.predicted ? "transparent" : point.color,
        borderColor: point.color,
    };
};

const nowLineStyle = computed(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const range = displayRange.value;
    if (nowMinutes < range.min || nowMinutes > range.max) {
        return null;
    }
    const y = ((nowMinutes - range.min) / range.span) * 100;
    return { top: `${y}%` };
});

const formatPointLabel = (point: {
    timestamp: string;
    predicted: boolean;
}) =>
    point.predicted
        ? `Predicted ${formatTimestamp(point.timestamp)}`
        : formatTimestamp(point.timestamp);

const liveArrivalRows = computed(() => props.liveArrivals?.arrivals ?? []);

const formatEta = (seconds: number | null, status: string) => {
    if (status === "arriving") return "arriving";
    if (seconds === null) return null;
    if (seconds < 60) return "<1 min";
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes} min`;
};

const formatLiveStatus = (status: string) => {
    if (status === "waiting_at_terminal") return "standing at terminal";
    if (status === "stopped_on_route") return "stopped";
    if (status === "moving") return "on the way";
    if (status === "arriving") return "arriving";
    return status.replace(/_/g, " ");
};

const formatDistance = (meters: number | null) => {
    if (meters === null) return "";
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
};

const formatFetchedAt = (value: string | null) => {
    if (!value) return "never";
    return formatTimestamp(value);
};
</script>

<template>
    <div>
        <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-foreground">
                {{ stop.stop_name }}
            </h2>
            <span class="text-xs text-muted-foreground">Stop {{ stop.stop_id }}</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
                Lat:
                <span class="font-semibold text-foreground">
                    {{ stop.stop_lat.toFixed(5) }}
                </span>
            </div>
            <div>
                Lon:
                <span class="font-semibold text-foreground">
                    {{ stop.stop_lon.toFixed(5) }}
                </span>
            </div>
            <div>
                Type:
                <span class="font-semibold text-foreground">
                    {{ getStopLocationTypeLabel(stop.location_type) }}
                </span>
            </div>
            <div>
                Stop code:
                <span class="font-semibold text-foreground">
                    {{ stop.stop_code || "N/A" }}
                </span>
            </div>
            <div class="col-span-2">
                Open routes:
                <div class="mt-2 flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        :variant="isStopAllActive ? 'default' : 'outline'"
                        :class="isStopAllActive ? 'bg-primary hover:bg-primary/80 text-primary-foreground' : ''"
                        @click="onApplyStopRoutes"
                    >
                        All
                    </Button>
                    <Button
                        v-for="routeId in stopRouteIds"
                        :key="routeId"
                        size="sm"
                        :variant="
                            !showAllRoutes && isRouteSelected(routeId)
                                ? 'default'
                                : 'outline'
                        "
                        :class="!showAllRoutes && isRouteSelected(routeId) ? 'bg-primary hover:bg-primary/80 text-primary-foreground' : ''"
                        @click="onToggleStopRoute(routeId)"
                    >
                        {{ getRouteShortName(routeId) }}
                    </Button>
                </div>
            </div>
            <div class="col-span-2">
                Trips observed:
                <span class="font-semibold text-foreground">
                    {{ tripCount }}
                </span>
            </div>
        </div>

        <div class="mt-4">
            <div class="flex items-center justify-between">
                <div class="text-xs font-semibold text-foreground/70">
                    Live arrivals
                </div>
                <div class="text-[10px] text-muted-foreground">
                    updated {{ formatFetchedAt(liveArrivals?.fetchedAt ?? null) }}
                </div>
            </div>
            <div class="mt-2 rounded-lg border border-border bg-primary/[0.04] p-3">
                <div
                    v-if="liveArrivalsState === 'loading'"
                    class="text-[11px] text-muted-foreground"
                >
                    Loading live ETA...
                </div>
                <div
                    v-else-if="liveArrivalsState === 'error'"
                    class="text-[11px] text-destructive"
                >
                    {{ liveArrivalsError }}
                </div>
                <div
                    v-else-if="liveArrivalRows.length === 0"
                    class="text-[11px] text-muted-foreground"
                >
                    No live vehicles currently matched to this stop.
                </div>
                <div v-else class="space-y-2">
                    <div
                        v-for="arrival in liveArrivalRows.slice(0, 8)"
                        :key="`${arrival.vehicleId}-${arrival.tripId}`"
                        class="rounded-md border border-border/70 bg-background/60 p-2"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="h-2.5 w-2.5 rounded-full"
                                        :style="{
                                            backgroundColor: safeColor(arrival.routeColor ?? '#111111'),
                                        }"
                                    />
                                    <span class="font-semibold text-foreground">
                                        {{ arrival.routeShortName ?? arrival.routeId }}
                                    </span>
                                    <span class="text-[10px] text-muted-foreground">
                                        #{{ arrival.vehicleId }}
                                    </span>
                                </div>
                                <div class="mt-1 text-[10px] text-muted-foreground">
                                    {{ formatLiveStatus(arrival.status) }}
                                    <span v-if="formatDistance(arrival.distanceMeters)">
                                        · {{ formatDistance(arrival.distanceMeters) }}
                                    </span>
                                </div>
                            </div>
                            <div class="text-right">
                                <div
                                    class="text-sm font-semibold"
                                    :class="
                                        arrival.etaSeconds === null
                                            ? 'text-muted-foreground'
                                            : 'text-foreground'
                                    "
                                >
                                    {{
                                        formatEta(
                                            arrival.etaSeconds,
                                            arrival.status,
                                        ) ?? "no ETA"
                                    }}
                                </div>
                                <div class="text-[10px] text-muted-foreground">
                                    {{ arrival.confidence }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div
                        v-if="liveArrivalRows.length > 8"
                        class="text-[10px] text-muted-foreground"
                    >
                        +{{ liveArrivalRows.length - 8 }} more matched vehicles
                    </div>
                </div>
            </div>
        </div>

        <div class="mt-4 flex items-center justify-between">
            <div class="text-xs font-semibold text-foreground/70">Timeline</div>
            <div class="flex items-center gap-1" aria-label="Timeline date range">
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    :disabled="analyticsState === 'loading' || !analytics?.window.canGoOlder"
                    aria-label="Show one day earlier"
                    title="One day earlier"
                    @click="onChangeAnalyticsOffset((analytics?.window.offset ?? 0) + 1)"
                >
                    <ChevronLeft class="size-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    :disabled="analyticsState === 'loading' || !analytics?.window.canGoNewer"
                    aria-label="Show one day later"
                    title="One day later"
                    @click="onChangeAnalyticsOffset((analytics?.window.offset ?? 0) - 1)"
                >
                    <ChevronRight class="size-4" />
                </Button>
            </div>
        </div>

        <div class="mt-3 rounded-lg border border-border bg-foreground/[0.02] p-3">
            <div
                v-if="analyticsState === 'loading'"
                class="text-[11px] text-muted-foreground"
            >
                Loading chart...
            </div>
            <div
                v-else-if="analyticsState === 'error'"
                class="text-[11px] text-destructive"
            >
                {{ analyticsError }}
            </div>
            <div v-else>
                <div
                    v-if="!analytics || graphDays.length === 0"
                    class="text-[11px] text-muted-foreground"
                >
                    No history for these 8 days.
                </div>
                <div v-else>
                    <div
                        class="flex justify-between pl-9 pr-2 text-[10px] text-muted-foreground"
                    >
                        <span
                            v-for="day in graphDays"
                            :key="day.date"
                            class="flex-1 text-center"
                        >
                            {{ formatDayLabel(day.date, day.isToday) }}
                        </span>
                    </div>
                    <div
                        ref="chartScrollEl"
                        class="mt-2 h-96 overflow-y-auto pr-1 themed-scroll"
                        style="touch-action: pan-y"
                        @pointerdown="onTimelinePointerDown"
                        @pointermove="onTimelinePointerMove"
                        @pointerup="onTimelinePointerEnd"
                        @pointercancel="onTimelinePointerEnd"
                    >
                        <div ref="chartEl" class="relative" :style="chartStyle">
                            <div class="absolute inset-y-0 left-0 w-8">
                                <span
                                    v-for="label in timeLabels"
                                    :key="label.minutes"
                                    class="absolute -translate-y-1/2 text-[10px]"
                                    :class="
                                        label.minutes % 60 === 0
                                            ? 'text-muted-foreground'
                                            : 'text-muted-foreground/50'
                                    "
                                    :style="{
                                        top: `${((label.minutes - displayRange.min) / displayRange.span) * 100}%`,
                                    }"
                                >
                                    {{ label.label }}
                                </span>
                            </div>
                            <TooltipProvider :delay-duration="100">
                                <div class="absolute inset-y-0 left-8 right-0">
                                    <div
                                        v-for="label in timeLabels"
                                        :key="`line-${label.minutes}`"
                                        class="absolute left-0 right-0 border-t"
                                        :class="
                                            label.minutes % 60 === 0
                                                ? 'border-border'
                                                : 'border-border/50'
                                        "
                                        :style="{
                                            top: `${((label.minutes - displayRange.min) / displayRange.span) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-for="tick in quarterTicks"
                                        :key="`tick-${tick}`"
                                        class="absolute left-0 right-0 border-t border-border/30"
                                        :style="{
                                            top: `${((tick - displayRange.min) / displayRange.span) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-for="(_, idx) in graphDays"
                                        :key="`day-${idx}`"
                                        class="absolute inset-y-0 border-l border-border/30"
                                        :style="{
                                            left: `${((idx + 0.5) / dayCount) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-if="nowLineStyle"
                                        class="absolute left-0 right-0 border-t border-primary/50"
                                        :style="nowLineStyle"
                                    />
                                    <Tooltip
                                        v-for="point in graphPoints"
                                        :key="point.key"
                                    >
                                        <TooltipTrigger as-child>
                                            <button
                                                type="button"
                                                class="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
                                                :style="{
                                                    left: pointStyle(point).left,
                                                    top: pointStyle(point).top,
                                                }"
                                                :aria-label="formatPointLabel({ timestamp: point.timestamp, predicted: point.predicted })"
                                            >
                                                <span
                                                    class="size-3 rounded-full border shadow-sm"
                                                    :class="
                                                        point.predicted
                                                            ? 'bg-transparent opacity-50'
                                                            : ''
                                                    "
                                                    :style="{
                                                        backgroundColor: point.predicted ? 'transparent' : point.color,
                                                        borderColor: point.color,
                                                    }"
                                                />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="top"
                                            class="text-[11px]"
                                        >
                                            {{ formatPointLabel({ timestamp: point.timestamp, predicted: point.predicted }) }}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            </TooltipProvider>
                        </div>
                    </div>
                </div>
                <div
                    class="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground"
                >
                    <span class="flex items-center gap-1">
                        <span class="h-2 w-2 rounded-full bg-primary" />
                        Actual
                    </span>
                    <span class="flex items-center gap-1">
                        <span
                            class="h-2 w-2 rounded-full border border-primary bg-transparent"
                        />
                        Predicted for today
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>
