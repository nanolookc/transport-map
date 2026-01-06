import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: [
      "architects-hearts-href-shipping.trycloudflare.com",
      "localhost",
    ],
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:3007",
        changeOrigin: true,
      },
    },
  },
});
