import type { Role } from "./enums";

/**
 * Permission catalogue. The API enforces these on every route (see
 * apps/api/src/http/guards.ts). The web client only uses them to decide what to
 * render; hiding a button is never the access control.
 */
export const PERMISSIONS = [
  "dashboard:read",
  "trucks:read",
  "trucks:create",
  "trucks:update",
  "trucks:cancel",
  "trucks:transition",
  "appointments:manage",
  "docks:read",
  "docks:manage",
  "resources:read",
  "resources:manage",
  "readiness:evaluate",
  "release:execute",
  "release:override",
  "optimization:read",
  "optimization:run",
  "optimization:approve",
  "simulation:run",
  "simulation:read",
  "quality:read",
  "quality:review",
  "sensors:generate",
  "handover:read",
  "handover:act",
  "handover:inspect",
  "events:read",
  "reports:read",
  "notifications:read",
  "users:read",
  "users:manage",
  "settings:manage",
  "models:read",
  "demo:reset",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  "dashboard:read",
  "optimization:read",
  "trucks:read",
  "docks:read",
  "resources:read",
  "simulation:read",
  "quality:read",
  "handover:read",
  "events:read",
  "reports:read",
  "notifications:read",
  "models:read",
];

const OPERATIONS: Permission[] = [
  ...READ_ONLY,
  "trucks:create",
  "trucks:update",
  "trucks:cancel",
  "trucks:transition",
  "appointments:manage",
  "docks:manage",
  "resources:manage",
  "readiness:evaluate",
  "release:execute",
  "release:override",
  "optimization:run",
  "optimization:approve",
  "simulation:run",
  "sensors:generate",
  "handover:act",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  ORGANIZATION_ADMIN: [...OPERATIONS, "users:read", "users:manage", "settings:manage", "demo:reset"],
  OPERATIONS_MANAGER: [...OPERATIONS, "users:read", "demo:reset"],
  DOCK_SUPERVISOR: [
    ...READ_ONLY,
    "trucks:transition",
    "docks:manage",
    "readiness:evaluate",
    "release:execute",
    "handover:act",
  ],
  QUALITY_OFFICER: [
    ...READ_ONLY,
    "readiness:evaluate",
    "quality:review",
    "sensors:generate",
    "handover:act",
    "handover:inspect",
  ],
  CARRIER_OPERATOR: ["trucks:read", "trucks:create", "trucks:update", "trucks:cancel", "notifications:read", "handover:read"],
  DRIVER: ["trucks:read", "notifications:read", "handover:read"],
  AUDITOR: [...READ_ONLY, "users:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles whose data visibility is restricted to their own carrier / driver records. */
export const SCOPED_ROLES: readonly Role[] = ["CARRIER_OPERATOR", "DRIVER"];

/** Roles an ORGANIZATION_ADMIN may grant. SUPER_ADMIN can only be granted by SUPER_ADMIN. */
export const ASSIGNABLE_ROLES: Record<Role, readonly Role[]> = {
  SUPER_ADMIN: [
    "SUPER_ADMIN",
    "ORGANIZATION_ADMIN",
    "OPERATIONS_MANAGER",
    "DOCK_SUPERVISOR",
    "QUALITY_OFFICER",
    "CARRIER_OPERATOR",
    "DRIVER",
    "AUDITOR",
  ],
  ORGANIZATION_ADMIN: [
    "OPERATIONS_MANAGER",
    "DOCK_SUPERVISOR",
    "QUALITY_OFFICER",
    "CARRIER_OPERATOR",
    "DRIVER",
    "AUDITOR",
  ],
  OPERATIONS_MANAGER: [],
  DOCK_SUPERVISOR: [],
  QUALITY_OFFICER: [],
  CARRIER_OPERATOR: [],
  DRIVER: [],
  AUDITOR: [],
};
