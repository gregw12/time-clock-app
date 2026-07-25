import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Koast Time Clock",
        short_name: "Time Clock",
        description: "Clock in/out and view your shift history.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0d0e20",
        theme_color: "#0d0e20",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App data (roster, punches) must always be fresh — never served
        // from cache. Only the app shell itself (JS/CSS/icons) is cached
        // so the icon/full-screen experience works offline-ish, without
        // ever risking a stale punch state.
        navigateFallbackDenylist: [/^https:\/\/script\.google\.com/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/script\.google\.com\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
