import { execSync } from "node:child_process";

/** Migrates and seeds the dedicated test database (never the development database). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wasl_test";
  if (!/wasl_test|_test\b/.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  const env = { ...process.env, DATABASE_URL: url, DEMO_PASSWORD: "Wasl@Demo2026" };
  execSync("npx tsx src/db/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx src/db/seed/run.ts --force", { env, stdio: "inherit" });
}
