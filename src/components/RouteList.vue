<script setup lang="ts">
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const prefix = props.idPrefix ?? "";
</script>

<template>
    <div
        class="text-xs gap-0.5 flex flex-col border rounded-md"
    >
        <div
            v-if="routes.length === 0"
            class="px-2 py-2 text-[11px] text-slate-500"
        >
            No routes loaded yet.
        </div>
        <div
            v-else-if="filteredRoutes.length === 0"
            class="px-2 py-2 text-[11px] text-slate-500"
        >
            No matching routes.
        </div>
        <div
            v-for="route in filteredRoutes"
            :key="route.route_id"
            class="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100"
            :class="isRouteFavorite(route.route_id) ? 'bg-amber-100/75' : ''"
        >
            <Checkbox
                :id="`${prefix}route-${route.route_id}`"
                :model-value="isRouteSelected(route.route_id)"
                @update:model-value="
                    (checked) => toggleRouteSelection(route.route_id, checked)
                "
            />
            <Label
                :for="`${prefix}route-${route.route_id}`"
                class="flex flex-1 cursor-pointer items-center gap-2"
            >
                <div
                    class="flex w-full flex-row items-center gap-2 justify-between"
                >
                    <div class="text-slate-500">
                        {{ route.route_long_name }}
                    </div>
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="text-slate-400 opacity-0 transition group-hover:opacity-100"
                            :class="
                                isRouteFavorite(route.route_id) ? 'opacity-100' : ''
                            "
                            @click.stop="toggleFavoriteRoute(route.route_id)"
                            :aria-label="`Toggle favorite for ${route.route_short_name}`"
                            :title="
                                isRouteFavorite(route.route_id)
                                    ? 'Remove favorite'
                                    : 'Add favorite'
                            "
                        >
                            <Star
                                class="h-4 w-4 text-amber-500"
                                :class="
                                    isRouteFavorite(route.route_id)
                                        ? 'fill-amber-500'
                                        : ''
                                "
                            />
                        </button>
                        <Badge
                            class="font-semibold px-1.5"
                            :style="{ backgroundColor: route.route_color }"
                        >
                            {{ route.route_short_name }}
                        </Badge>
                    </div>
                </div>
            </Label>
        </div>
        <div
            v-if="shouldShowUnknownRoutes && unknownRouteIds.length > 0"
            class="my-2 border-t border-slate-200"
        ></div>
        <div
            v-if="shouldShowUnknownRoutes && unknownRouteIds.length > 0"
            class="px-2 pb-1 pt-2 text-[11px] font-semibold text-slate-500"
        >
            Unknown routes
        </div>
        <template v-if="shouldShowUnknownRoutes">
            <div
                v-for="routeId in unknownRouteIds"
                :key="`${prefix}unknown-${routeId}`"
                class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100"
            >
                <Checkbox
                    :id="`${prefix}route-unknown-${routeId}`"
                    :model-value="isRouteSelected(routeId)"
                    @update:model-value="
                        (checked) => toggleRouteSelection(routeId, checked)
                    "
                />
                <Label
                    :for="`${prefix}route-unknown-${routeId}`"
                    class="flex flex-1 cursor-pointer items-center gap-2"
                >
                    <span class="text-slate-500">Unknown route</span>
                    <Badge class="font-semibold px-1.5">
                        {{ routeId }}
                    </Badge>
                </Label>
            </div>
        </template>
    </div>
</template>
