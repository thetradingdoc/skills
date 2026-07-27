import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/scripts/**/*.spec.ts",
      "**/scripts/**/*.spec.js",
      "**/scripts/**/*.spec.tsx",
      "**/playwright-template.spec.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
