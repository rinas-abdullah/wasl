import type { Permission, Role } from "@wasl/shared";

export interface Actor {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  facilityId: string;
  carrierId: string | null;
  driverId: string | null;
  permissions: readonly Permission[];
  isDemo: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}
