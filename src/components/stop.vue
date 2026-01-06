<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
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
            minutes: number[];
            predicted: boolean;
        }>;
    }>;
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
}>();

const chartEl = ref<HTMLDivElement | null>(null);
const chartScrollEl = ref<HTMLDivElement | null>(null);
const chartHeight = ref(640);
let resizeObserver: ResizeObserver | null = null;

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
    const minutes = now.getHours() * 60 + now.getMinutes();
    const range = displayRange.value;
    const view = chartScrollEl.value;
    const maxScroll = view.scrollHeight - view.clientHeight;
    if (minutes <= range.min) {
        view.scrollTop = 0;
        return;
    }
    if (minutes >= range.max) {
        view.scrollTop = maxScroll;
        return;
    }
    const ratio = (minutes - range.min) / range.span;
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
        routeId: number;
        predicted: boolean;
        color: string;
    }> = [];
    graphDays.value.forEach((day, dayIndex) => {
        day.points.forEach((group) => {
            if (!graphSelectedSet.value.has(group.routeId)) return;
            const color = routeColorMap.value.get(group.routeId) ?? "#0f172a";
            group.minutes.forEach((minutes, index) => {
                points.push({
                    key: `${day.date}-${group.routeId}-${minutes}-${index}`,
                    dayIndex,
                    minutes,
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
    const minutes = now.getHours() * 60 + now.getMinutes();
    const range = displayRange.value;
    if (minutes < range.min || minutes > range.max) {
        return null;
    }
    const y = ((minutes - range.min) / range.span) * 100;
    return { top: `${y}%` };
});

const formatPointLabel = (point: { minutes: number; predicted: boolean }) =>
    point.predicted
        ? `Predicted ${formatMinutes(point.minutes)}`
        : formatMinutes(point.minutes);
</script>

<template>
    <div>
        <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-900">
                {{ stop.stop_name }}
            </h2>
            <span class="text-xs text-slate-500">Stop {{ stop.stop_id }}</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
                Lat:
                <span class="font-semibold text-slate-800">
                    {{ stop.stop_lat.toFixed(5) }}
                </span>
            </div>
            <div>
                Lon:
                <span class="font-semibold text-slate-800">
                    {{ stop.stop_lon.toFixed(5) }}
                </span>
            </div>
            <div>
                Type:
                <span class="font-semibold text-slate-800">
                    {{ getStopLocationTypeLabel(stop.location_type) }}
                </span>
            </div>
            <div>
                Stop code:
                <span class="font-semibold text-slate-800">
                    {{ stop.stop_code || "N/A" }}
                </span>
            </div>
            <div class="col-span-2">
                Open routes:
                <div class="mt-2 flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        :variant="isStopAllActive ? 'default' : 'outline'"
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
                        @click="onToggleStopRoute(routeId)"
                    >
                        {{ getRouteShortName(routeId) }}
                    </Button>
                </div>
            </div>
            <div class="col-span-2">
                Trips observed:
                <span class="font-semibold text-slate-800">
                    {{ tripCount }}
                </span>
            </div>
        </div>

        <div class="mt-4">
            <div class="text-xs font-semibold text-slate-700">Timeline</div>
        </div>

        <div class="mt-3 rounded-lg border border-slate-200 bg-white p-3">
            <div
                v-if="analyticsState === 'loading'"
                class="text-[11px] text-slate-500"
            >
                Loading chart...
            </div>
            <div
                v-else-if="analyticsState === 'error'"
                class="text-[11px] text-red-600"
            >
                {{ analyticsError }}
            </div>
            <div v-else>
                <div
                    v-if="!analytics || graphDays.length === 0"
                    class="text-[11px] text-slate-500"
                >
                    No history for the last 7 days.
                </div>
                <div v-else>
                    <div
                        class="flex justify-between pl-9 pr-2 text-[10px] text-slate-500"
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
                        class="mt-2 h-96 overflow-y-auto pr-1"
                    >
                        <div ref="chartEl" class="relative h-384">
                            <div class="absolute inset-y-0 left-0 w-8">
                                <span
                                    v-for="label in timeLabels"
                                    :key="label.minutes"
                                    class="absolute -translate-y-1/2 text-[10px]"
                                    :class="
                                        label.minutes % 60 === 0
                                            ? 'text-slate-500'
                                            : 'text-slate-400/70'
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
                                                ? 'border-slate-200'
                                                : 'border-slate-200/50'
                                        "
                                        :style="{
                                            top: `${((label.minutes - displayRange.min) / displayRange.span) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-for="tick in quarterTicks"
                                        :key="`tick-${tick}`"
                                        class="absolute left-0 right-0 border-t border-slate-100"
                                        :style="{
                                            top: `${((tick - displayRange.min) / displayRange.span) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-for="(_, idx) in graphDays"
                                        :key="`day-${idx}`"
                                        class="absolute inset-y-0 border-l border-slate-100"
                                        :style="{
                                            left: `${((idx + 0.5) / dayCount) * 100}%`,
                                        }"
                                    />
                                    <div
                                        v-if="nowLineStyle"
                                        class="absolute left-0 right-0 border-t border-blue-400/60"
                                        :style="nowLineStyle"
                                    />
                                    <Tooltip
                                        v-for="point in graphPoints"
                                        :key="point.key"
                                    >
                                        <TooltipTrigger as-child>
                                            <div
                                                class="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                                                :class="
                                                    point.predicted
                                                        ? 'bg-white/70 opacity-60'
                                                        : 'shadow-sm'
                                                "
                                                :style="pointStyle(point)"
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="top"
                                            class="text-[11px]"
                                        >
                                            {{ formatPointLabel(point) }}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            </TooltipProvider>
                        </div>
                    </div>
                </div>
                <div
                    class="mt-2 flex items-center gap-3 text-[10px] text-slate-500"
                >
                    <span class="flex items-center gap-1">
                        <span class="h-2 w-2 rounded-full bg-slate-500" />
                        Actual
                    </span>
                    <span class="flex items-center gap-1">
                        <span
                            class="h-2 w-2 rounded-full border border-slate-500 bg-white"
                        />
                        Predicted for today
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>
