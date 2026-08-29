<script setup lang="ts">
import { ref } from "vue";
import { registerSW } from "virtual:pwa-register";

const updateAvailable = ref(false);

const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
        updateAvailable.value = true;
    },
    onRegisterError(error) {
        console.warn("PWA service worker registration failed", error);
    },
});

const applyUpdate = () => {
    void updateServiceWorker(true);
};
</script>

<template>
    <div class="min-h-screen bg-background">
        <!-- Top navigation bar
    <header class="border-b border-border">
      <div class="flex justify-between items-center px-4 h-12">
        <!-- Left: logo + nav
    <div class="flex gap-4 items-center">
      <h1
        @click="router.push('/events')"
        class="text-xl font-bold cursor-pointer"
      >
        <Button variant="ghost" class="text-xl font-bold"
          >Moni <span class="text-primary">X</span></Button
        >
      </h1>

      <div class="flex gap-2 items-center">
        <Button
          v-for="item in navItems"
          :key="item.path"
          variant="ghost"
          @click="router.push(item.path)"
          :class="navButtonClasses(isActive(item.path))"
        >
          {{ item.title }}
        </Button>
      </div>
    </div>

    <!-- Right side reserved for future controls (empty for now)
        <div></div>
      </div>
    </header> -->

        <!-- Main content -->
        <main>
            <router-view />
        </main>

        <div
            v-if="updateAvailable"
            class="fixed inset-x-4 bottom-4 z-[3000] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm shadow-lg"
            role="status"
        >
            <span class="min-w-0 flex-1">A new version is available.</span>
            <button
                type="button"
                class="rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
                @click="applyUpdate"
            >
                Reload
            </button>
        </div>
    </div>
</template>

<style scoped></style>
