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
      // Audit dump of trading middleware — not Blanko vitest (jest-based).
      "docs/ops/_audit_86a9ac1/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
