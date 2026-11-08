import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wasl_test",
      DEMO_PASSWORD: "Wasl@Demo2026",
      DEMO_MODE: "true",
      LOG_LEVEL: "silent",
      RATE_LIMIT_LOGIN: "1000",
    },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
