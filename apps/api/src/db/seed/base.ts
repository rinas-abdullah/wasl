import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { Role } from "@wasl/shared";
import { schema, type Tx } from "../client";
import type { SeedRefs } from "./facility";

export const DEMO_ORG_SLUG = "wasl-demo";
export const TENANT_B_SLUG = "tenant-b-demo";

export function demoPassword() {
  return process.env.DEMO_PASSWORD && process.env.DEMO_PASSWORD.length >= 8 ? process.env.DEMO_PASSWORD : "Wasl@Demo2026";
}

/** Demo accounts. Synthetic identities only — no real names, phone numbers or IDs. */
export const DEMO_USERS: { key: string; email: string; name: string; role: Role; carrier?: string; driver?: string }[] = [
  { key: "admin", email: "admin@demo.wasl.sa", name: "Org Admin (Demo)", role: "ORGANIZATION_ADMIN" },
  { key: "ops", email: "ops@demo.wasl.sa", name: "Operations Manager (Demo)", role: "OPERATIONS_MANAGER" },
  { key: "dock", email: "dock@demo.wasl.sa", name: "Dock Supervisor (Demo)", role: "DOCK_SUPERVISOR" },
  { key: "quality", email: "quality@demo.wasl.sa", name: "Quality Officer (Demo)", role: "QUALITY_OFFICER" },
  { key: "carrier", email: "carrier@demo.wasl.sa", name: "Carrier Operator · Najd (Demo)", role: "CARRIER_OPERATOR", carrier: "NAJD" },
  { key: "driver", email: "driver@demo.wasl.sa", name: "Driver 01 (Demo)", role: "DRIVER", carrier: "NAJD", driver: "DRV-001" },
  { key: "auditor", email: "auditor@demo.wasl.sa", name: "Auditor (Demo)", role: "AUDITOR" },
];

export const CARRIERS = [
  { code: "NAJD", name: "Najd Freight (Demo)", nameAr: "نجد للشحن (تجريبي)" },
  { code: "REDSEA", name: "Red Sea Haulage (Demo)", nameAr: "البحر الأحمر للنقل (تجريبي)" },
  { code: "EAST", name: "Eastern Cold Chain (Demo)", nameAr: "الشرقية للتبريد (تجريبي)" },
  { code: "QASSIM", name: "Qassim Transport (Demo)", nameAr: "القصيم للنقل (تجريبي)" },
];

export async function seedOrgBase(tx: Tx): Promise<SeedRefs> {
  const hash = await bcrypt.hash(demoPassword(), 10);
  const [org] = await tx.insert(schema.organizations).values({ name: "WASL Demo Logistics", nameAr: "وَصل للخدمات اللوجستية (تجريبي)", slug: DEMO_ORG_SLUG, isDemo: true }).returning();
  const carriers: Record<string, string> = {};
  for (const c of CARRIERS) {
    const [row] = await tx.insert(schema.carriers).values({ orgId: org.id, ...c }).returning();
    carriers[c.code] = row.id;
  }
  const drivers: Record<string, string> = {};
  const carrierOrder = ["NAJD", "NAJD", "REDSEA", "REDSEA", "EAST", "EAST", "EAST", "QASSIM", "QASSIM", "NAJD"];
  for (let i = 1; i <= 10; i++) {
    const ref = `DRV-${String(i).padStart(3, "0")}`;
    const [row] = await tx.insert(schema.drivers).values({ orgId: org.id, carrierId: carriers[carrierOrder[i - 1]], reference: ref, displayName: `Driver ${String(i).padStart(2, "0")}` }).returning();
    drivers[ref] = row.id;
  }
  const users: SeedRefs["users"] = {};
  for (const u of DEMO_USERS) {
    const [row] = await tx.insert(schema.users).values({ email: u.email, name: u.name, passwordHash: hash, isDemo: true }).returning();
    await tx.insert(schema.memberships).values({ userId: row.id, orgId: org.id, role: u.role, carrierId: u.carrier ? carriers[u.carrier] : null, driverId: u.driver ? drivers[u.driver] : null });
    users[u.key] = { id: row.id, name: u.name, role: u.role };
  }
  return { orgId: org.id, carriers, drivers, users };
}

/** A second, isolated tenant used to demonstrate and test organisation isolation. */
export async function seedTenantB(tx: Tx) {
  const hash = await bcrypt.hash(demoPassword(), 10);
  const [org] = await tx.insert(schema.organizations).values({ name: "Tenant B Logistics (Demo)", nameAr: "المستأجر ب (تجريبي)", slug: TENANT_B_SLUG, isDemo: true }).returning();
  const [carrier] = await tx.insert(schema.carriers).values({ orgId: org.id, code: "BCAR", name: "Tenant B Carrier (Demo)", nameAr: "ناقل المستأجر ب" }).returning();
  const [user] = await tx.insert(schema.users).values({ email: "admin@tenant-b.demo.wasl.sa", name: "Tenant B Admin (Demo)", passwordHash: hash, isDemo: true }).returning();
  await tx.insert(schema.memberships).values({ userId: user.id, orgId: org.id, role: "ORGANIZATION_ADMIN" });
  const [f] = await tx.insert(schema.facilities).values({ orgId: org.id, code: "JED-DC1", name: "Jeddah DC (Tenant B demo)", nameAr: "مركز جدة (المستأجر ب)", city: "Jeddah", yardCapacity: 4, gateCapacityPerHour: 8 }).returning();
  await tx.insert(schema.docks).values({ facilityId: f.id, code: "B-D1", name: "Tenant B Dock", position: 1, maxVehicleType: "ARTICULATED", compatibleCargo: ["GENERAL"], features: ["LEVELER"] });
  await tx.insert(schema.workforceTeams).values({ facilityId: f.id, code: "B-T1", name: "Tenant B Team", nameAr: "فريق المستأجر ب", shiftStart: "00:00", shiftEnd: "23:59", size: 3, skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED"] });
  const [sh] = await tx.insert(schema.shipments).values({ orgId: org.id, facilityId: f.id, reference: "SHP-B-0001", cargoType: "GENERAL", palletCount: 10, weightKg: 4000, handlingMethod: "MANUAL" }).returning();
  await tx.insert(schema.trucks).values({ orgId: org.id, facilityId: f.id, code: "TB-0001", plateNumber: "TB 0001 (demo)", carrierId: carrier.id, shipmentId: sh.id, vehicleType: "RIGID", requestedArrival: new Date(Date.now() + 3600_000), serviceEstimateMin: 30, serviceEstimateSource: "PLANNING_TABLE" });
  return { orgId: org.id, facilityId: f.id };
}

export async function orgExists(tx: Tx, slug: string) {
  const r = await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, slug));
  return r[0]?.id ?? null;
}

export async function purgeAuditForOrg(tx: Tx, orgId: string) {
  await tx.execute(sql`set local wasl.audit_purge = 'demo'`);
  await tx.delete(schema.auditEvents).where(eq(schema.auditEvents.orgId, orgId));
}
