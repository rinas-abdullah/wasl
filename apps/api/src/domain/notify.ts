import type { NotificationType, Role, Severity } from "@wasl/shared";
import type { DbOrTx } from "../db/client";
import { schema } from "../db/client";

export interface NotifyInput {
  orgId: string;
  facilityId: string | null;
  type: NotificationType;
  severity: Severity;
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
  roles?: Role[];
  userId?: string | null;
  carrierId?: string | null;
  entityType?: string;
  entityId?: string | null;
  actionRequired?: boolean;
}

const OPS: Role[] = ["ORGANIZATION_ADMIN", "OPERATIONS_MANAGER", "DOCK_SUPERVISOR", "SUPER_ADMIN"];
export const ROLE_GROUPS = {
  ops: OPS,
  managers: ["ORGANIZATION_ADMIN", "OPERATIONS_MANAGER", "SUPER_ADMIN"] as Role[],
  quality: ["QUALITY_OFFICER", "OPERATIONS_MANAGER", "SUPER_ADMIN"] as Role[],
};

export async function notify(tx: DbOrTx, n: NotifyInput) {
  await tx.insert(schema.notifications).values({
    orgId: n.orgId,
    facilityId: n.facilityId,
    userId: n.userId ?? null,
    targetRoles: n.roles ?? [],
    carrierId: n.carrierId ?? null,
    type: n.type,
    severity: n.severity,
    title: n.title,
    titleAr: n.titleAr,
    body: n.body,
    bodyAr: n.bodyAr,
    entityType: n.entityType ?? null,
    entityId: n.entityId ?? null,
    actionRequired: n.actionRequired ?? false,
  });
}
