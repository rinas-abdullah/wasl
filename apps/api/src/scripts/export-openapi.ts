import { writeFileSync } from "node:fs";
import { buildApp } from "../app";
import { pool } from "../db/client";

const app = await buildApp({ logger: false });
const spec = await app.inject({ method: "GET", url: "/api/openapi.json" });
writeFileSync(new URL("../../../../docs/openapi.json", import.meta.url), JSON.stringify(spec.json(), null, 2));
console.log(`[openapi] ${Object.keys(spec.json().paths).length} paths written to docs/openapi.json`);
await app.close();
await pool.end();
