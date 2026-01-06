<script setup lang="ts">
// import { useRoute } from "vue-router";

// // const router = useRouter();
// const route = useRoute();
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
          >Moni <span class="text-moni">X</span></Button
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
    </div>
</template>

<style scoped></style>
