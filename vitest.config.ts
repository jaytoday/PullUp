import { defineConfig } from "vitest/config";

// Root config covers the interactive agent surface (agent/**). Package tests run
// via each package's own vitest config (`pnpm -r test`).
export default defineConfig({
  test: {
    include: ["agent/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
