import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@shared", replacement: path.resolve(__dirname, "../shared") },
      // elkjs main.js lacks ESM default export; resolve bare "elkjs" to elk-api.js
      { find: /^elkjs$/, replacement: path.resolve(__dirname, "node_modules/elkjs/lib/elk-api.js") },
    ],
  },
  optimizeDeps: {
    include: ["elkjs/lib/elk-api.js"],
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
