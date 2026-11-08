import { eq } from "drizzle-orm";
import { db, pool, schema } from "../client";
import { DEMO_ORG_SLUG, TENANT_B_SLUG, demoPassword, orgExists, purgeAuditForOrg, seedOrgBase, seedTenantB } from "./base";
import { seedFacility } from "./facility";
import { syncModelRegistry } from "../../domain/models";

const force = process.argv.includes("--force");

await db.transaction(async (tx) => {
  for (const slug of [DEMO_ORG_SLUG, TENANT_B_SLUG]) {
    const id = await orgExists(tx, slug);
    if (id && !force) {
      console.log(`[seed] organisation '${slug}' exists — skipping (use --force to recreate demo data)`);
      return;
    }
    if (id) {
      const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, id));
      if (!org.isDemo) throw new Error(`Refusing to delete non-demo organisation ${slug}`);
      await purgeAuditForOrg(tx, id);
      const members = await tx.select({ userId: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.orgId, id));
      await tx.delete(schema.organizations).where(eq(schema.organizations.id, id));
      for (const m of members) await tx.delete(schema.users).where(eq(schema.users.id, m.userId));
    }
  }
  const refs = await seedOrgBase(tx);
  const fac = await seedFacility(tx, refs);
  await seedTenantB(tx);
  console.log(`[seed] demo organisation ${refs.orgId}, facility ${fac.facilityId}, ${Object.keys(fac.trucks).length} trucks`);
  console.log(`[seed] demo accounts use password: ${process.env.DEMO_PASSWORD ? "(from DEMO_PASSWORD)" : demoPassword()}`);
});
await syncModelRegistry().catch((e) => console.warn("[seed] model registry not synced:", (e as Error).message));
await pool.end();
