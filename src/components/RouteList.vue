<script setup lang="ts">
import { Star } from "lucide-vue-next";

type Route = {
    route_id: number;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    route_type: number;
    route_desc: string;
};

const props = defineProps<{
    routes: Route[];
    filteredRoutes: Route[];
    unknownRouteIds: number[];
    isTouchUi: boolean;
    isRouteSelected: (routeId: number) => boolean;
    isRouteFavorite: (routeId: number) => boolean;
    toggleRouteSelection: (
        routeId: number,
        checked: boolean | "indeterminate",
    ) => void;
    toggleFavoriteRoute: (routeId: number) => void;
    idPrefix?: string;
    shouldShowUnknownRoutes: boolean;
}>();

const toggleRoute = (routeId: number) => {
    props.toggleRouteSelection(routeId, !props.isRouteSelected(routeId));
};
</script>

<template>
    <div class="flex flex-col gap-2">
        <div
            v-if="routes.length === 0"
            class="px-3 py-6 text-xs text-center text-muted-foreground"
        >
            No routes loaded yet.
        </div>
        <div
            v-else-if="filteredRoutes.length === 0"
            class="px-3 py-6 text-xs text-center text-muted-foreground"
        >
            No matching routes.
        </div>
        <button
            v-for="route in filteredRoutes"
            :key="route.route_id"
            type="button"
            class="route-item flex relative gap-3 items-center px-0 py-0 text-left rounded-xl border border-transparent transition-all duration-200 group"
            :class="[
                isRouteSelected(route.route_id)
                    ? 'bg-primary/10 dark:bg-primary/15 border-primary/20 shadow-sm'
                    : !isTouchUi
                      ? 'hover:bg-foreground/[0.04]'
                      : '',
                isRouteFavorite(route.route_id) && !isRouteSelected(route.route_id)
                    ? 'bg-primary/[0.03]'
                    : '',
            ]"
            @click="toggleRoute(route.route_id)"
        >
            <!-- Route number badge -->
            <div
                class="flex justify-center items-center px-2 h-10 text-sm font-extrabold text-white rounded-xl shadow-sm min-w-10 shrink-0"
                :style="{ backgroundColor: route.route_color ? (route.route_color.startsWith('#') ? route.route_color : '#' + route.route_color) : 'var(--primary)' }"
            >
                {{ route.route_short_name }}
            </div>

            <!-- Route name with marquee -->
            <div class="overflow-hidden flex-1 min-w-0">
                <div
                    class="text-sm leading-tight whitespace-nowrap route-name"
                    :class="isRouteSelected(route.route_id)
                        ? 'text-foreground font-semibold'
                        : !isTouchUi
                          ? 'font-medium group-hover:text-foreground/80'
                          : 'font-medium'"
                >
                    <span class="route-name-inner">{{ route.route_long_name }}</span>
                </div>
            </div>

            <!-- Favorite star -->
            <button
                type="button"
                class="p-2 rounded-lg transition-all duration-200 shrink-0"
                :class="[
                    isRouteFavorite(route.route_id)
                        ? 'opacity-100 text-primary'
                        : isTouchUi
                          ? 'opacity-100 text-muted-foreground'
                          : 'opacity-0 group-hover:opacity-50 text-muted-foreground hover:text-primary hover:opacity-100',
                ]"
                @click.stop="toggleFavoriteRoute(route.route_id)"
                :aria-label="`Toggle favorite for ${route.route_short_name}`"
            >
                <Star
                    class="w-4 h-4"
                    :class="isRouteFavorite(route.route_id) ? 'fill-primary' : ''"
                />
            </button>
        </button>

        <!-- Unknown routes separator -->
        <div
            v-if="shouldShowUnknownRoutes && unknownRouteIds.length > 0"
            class="my-2 border-t border-border/50"
        />
        <div
            v-if="shouldShowUnknownRoutes && unknownRouteIds.length > 0"
            class="px-3 py-1 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest"
        >
            Unknown
        </div>
        <button
            v-if="shouldShowUnknownRoutes"
            v-for="routeId in unknownRouteIds"
            :key="`unknown-${routeId}`"
            type="button"
            class="flex relative gap-2.5 items-center px-2.5 py-2 text-left rounded-xl border border-transparent transition-all duration-200 group"
            :class="isRouteSelected(routeId)
                ? 'bg-primary/10 dark:bg-primary/15 border-primary/20 shadow-sm'
                : !isTouchUi
                  ? 'hover:bg-foreground/[0.04]'
                  : ''"
            @click="toggleRoute(routeId)"
        >
            <div
                class="flex justify-center items-center px-2 h-10 text-sm font-extrabold text-white rounded-xl min-w-10 bg-muted-foreground/60 shrink-0"
            >
                {{ routeId }}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm text-muted-foreground/60">
                    Unknown route
                </div>
            </div>
        </button>
    </div>
</template>

<style scoped>
.route-name {
    mask-image: linear-gradient(to right, black 85%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
}

@media (hover: hover) and (pointer: fine) {
    .route-item:hover .route-name .route-name-inner {
        display: inline-block;
        animation: marquee 4s linear infinite;
        animation-delay: 0.3s;
    }

    .route-item:hover .route-name {
        mask-image: none;
        -webkit-mask-image: none;
    }
}

@keyframes marquee {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(-50%);
    }
}

/* Only animate if text actually overflows */
.route-name .route-name-inner {
    animation: none;
}
</style>
