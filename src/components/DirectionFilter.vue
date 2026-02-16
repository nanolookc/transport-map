<script setup lang="ts">
import { Button } from "@/components/ui/button";

const props = defineProps<{
    directionFilter: "all" | "0" | "1";
}>();

const emit = defineEmits<{
    change: [value: "all" | "0" | "1"];
}>();
</script>

<template>
    <div class="mt-4">
        <div class="text-xs font-semibold text-foreground/70">
            Direction
        </div>
        <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
            <Button
                size="sm"
                :variant="directionFilter === 'all' ? 'default' : 'outline'"
                :class="directionFilter === 'all' ? 'bg-primary hover:bg-primary/80 text-primary-foreground' : ''"
                @click="emit('change', 'all')"
            >
                Both
            </Button>
            <Button
                size="sm"
                :variant="directionFilter === '0' ? 'default' : 'outline'"
                :class="directionFilter === '0' ? 'bg-primary hover:bg-primary/80 text-primary-foreground' : ''"
                @click="emit('change', '0')"
            >
                Way
            </Button>
            <Button
                size="sm"
                :variant="directionFilter === '1' ? 'default' : 'outline'"
                :class="directionFilter === '1' ? 'bg-primary hover:bg-primary/80 text-primary-foreground' : ''"
                @click="emit('change', '1')"
            >
                Roundway
            </Button>
        </div>
    </div>
</template>
