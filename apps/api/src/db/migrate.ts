import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/ (tsx) and dist/ (bundled): migrations live in apps/api/drizzle
const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, here.includes(`${path.sep}dist`) ? ".." : "../..", "drizzle");

await pool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
await migrate(db, { migrationsFolder });
console.log(`[migrate] applied migrations from ${migrationsFolder}`);
await pool.end();
