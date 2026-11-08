import { defineConfig } from "@playwright/test";

/**
 * End-to-end acceptance journey. Requires the full stack running:
 *   web http://localhost:3000, API http://localhost:4000 (with worker), intelligence http://localhost:8000.
 * The journey resets the DEMO organisation first (never production data).
 */
export default defineConfig({
  testDir: ".",
  timeout: 480_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", locale: "en-US", trace: "off", viewport: { width: 1440, height: 950 } },
});
