import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "index.css",
        manualChunks: (id) => {
          if (id.includes("node_modules/react")) return "react";
          if (id.includes("node_modules/react-dom")) return "react-dom";
          if (id.includes("node_modules/reactflow")) return "reactflow";
        },
      },
    },
  },
});
