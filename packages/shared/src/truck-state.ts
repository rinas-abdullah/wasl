import type { TruckStatus } from "./enums";

/**
 * Truck lifecycle state machine.
 *
 *   REGISTERED → SCHEDULED → CALLED → ARRIVED → IN_SERVICE → COMPLETED → DEPARTED
 *                    │          ▲                   │
 *                    └→ WAITING ┘ (arrived before    └→ EXCEPTION → WAITING | CANCELLED
 *                         being released)
 *
 * - SCHEDULED: confirmed appointment, not on site, not released.
 * - CALLED:    released by the readiness engine; dock/crew/equipment are reserved.
 * - ARRIVED:   checked in at the gate AND already released → proceeds to the dock.
 * - WAITING:   checked in at the gate but not yet released → holds in the yard.
 *
 * "RELEASE" is NOT a free transition: it is only reachable through the readiness
 * engine endpoint, which re-evaluates all checks and reserves resources atomically.
 */
export const TRUCK_ACTIONS = [
  "SCHEDULE",
  "UNSCHEDULE",
  "RELEASE",
  "MARK_ARRIVAL",
  "START_SERVICE",
  "COMPLETE_SERVICE",
  "REGISTER_DEPARTURE",
  "CANCEL",
  "MARK_NO_SHOW",
  "RAISE_EXCEPTION",
  "RESOLVE_EXCEPTION",
] as const;
export type TruckAction = (typeof TRUCK_ACTIONS)[number];

export interface TransitionRule {
  action: TruckAction;
  from: readonly TruckStatus[];
  /** Target status. MARK_ARRIVAL resolves to ARRIVED or WAITING depending on release state. */
  to: TruckStatus | "ARRIVED_OR_WAITING";
  reasonRequired: boolean;
  /** Only reachable through a dedicated workflow endpoint (not the generic transition route). */
  workflowOnly?: boolean;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { action: "SCHEDULE", from: ["REGISTERED"], to: "SCHEDULED", reasonRequired: false, workflowOnly: true },
  { action: "UNSCHEDULE", from: ["SCHEDULED"], to: "REGISTERED", reasonRequired: true },
  { action: "RELEASE", from: ["SCHEDULED", "WAITING"], to: "CALLED", reasonRequired: false, workflowOnly: true },
  { action: "MARK_ARRIVAL", from: ["SCHEDULED", "CALLED"], to: "ARRIVED_OR_WAITING", reasonRequired: false },
  { action: "START_SERVICE", from: ["ARRIVED", "CALLED"], to: "IN_SERVICE", reasonRequired: false },
  { action: "COMPLETE_SERVICE", from: ["IN_SERVICE"], to: "COMPLETED", reasonRequired: false },
  { action: "REGISTER_DEPARTURE", from: ["COMPLETED"], to: "DEPARTED", reasonRequired: false },
  { action: "CANCEL", from: ["REGISTERED", "SCHEDULED", "CALLED", "WAITING", "EXCEPTION"], to: "CANCELLED", reasonRequired: true },
  { action: "MARK_NO_SHOW", from: ["SCHEDULED", "CALLED"], to: "NO_SHOW", reasonRequired: true },
  { action: "RAISE_EXCEPTION", from: ["ARRIVED", "WAITING", "IN_SERVICE"], to: "EXCEPTION", reasonRequired: true },
  { action: "RESOLVE_EXCEPTION", from: ["EXCEPTION"], to: "WAITING", reasonRequired: true },
];

export interface TransitionContext {
  /** Truck has active (non-suspended) dock reservation from a release. */
  hasActiveRelease: boolean;
  /** Truck has physically checked in at the gate. */
  hasArrived: boolean;
  /** Handover for the shipment is approved (or no handover is required). */
  handoverApprovedOrNotRequired: boolean;
  reason?: string | null;
}

export type TransitionResult =
  | { ok: true; to: TruckStatus }
  | { ok: false; code: "INVALID_TRANSITION" | "REASON_REQUIRED" | "GUARD_FAILED"; message: string };

export function getRule(action: TruckAction): TransitionRule {
  const rule = TRANSITIONS.find((r) => r.action === action);
  if (!rule) throw new Error(`Unknown action ${action}`);
  return rule;
}

export function evaluateTransition(current: TruckStatus, action: TruckAction, ctx: TransitionContext): TransitionResult {
  const rule = getRule(action);
  if (!rule.from.includes(current)) {
    return { ok: false, code: "INVALID_TRANSITION", message: `Action ${action} is not allowed from status ${current}` };
  }
  if (rule.reasonRequired && !(ctx.reason && ctx.reason.trim().length >= 3)) {
    return { ok: false, code: "REASON_REQUIRED", message: `Action ${action} requires a documented reason` };
  }
  switch (action) {
    case "MARK_ARRIVAL":
      if (ctx.hasArrived) return { ok: false, code: "GUARD_FAILED", message: "Truck has already checked in" };
      return { ok: true, to: current === "CALLED" && ctx.hasActiveRelease ? "ARRIVED" : "WAITING" };
    case "START_SERVICE":
      if (!ctx.hasActiveRelease) return { ok: false, code: "GUARD_FAILED", message: "Service cannot start without an active release (dock and crew reservation)" };
      if (!ctx.hasArrived) return { ok: false, code: "GUARD_FAILED", message: "Truck has not checked in at the gate" };
      return { ok: true, to: "IN_SERVICE" };
    case "REGISTER_DEPARTURE":
      if (!ctx.handoverApprovedOrNotRequired) return { ok: false, code: "GUARD_FAILED", message: "Handover must be approved before departure" };
      return { ok: true, to: "DEPARTED" };
    default:
      return { ok: true, to: rule.to as TruckStatus };
  }
}

export function availableActions(current: TruckStatus): TruckAction[] {
  return TRANSITIONS.filter((r) => r.from.includes(current)).map((r) => r.action);
}

/** Statuses that represent a truck physically on site. */
export const ON_SITE_STATUSES: readonly TruckStatus[] = ["ARRIVED", "WAITING", "IN_SERVICE", "COMPLETED", "EXCEPTION"];
/** Statuses counted as "waiting" in KPIs: on site, not yet in service. */
export const WAITING_STATUSES: readonly TruckStatus[] = ["WAITING", "ARRIVED"];
/** Statuses that are terminal for the operational day. */
export const TERMINAL_STATUSES: readonly TruckStatus[] = ["DEPARTED", "CANCELLED", "NO_SHOW"];
/** Statuses that still need a dock decision (candidates for optimisation). */
export const PLANNABLE_STATUSES: readonly TruckStatus[] = ["REGISTERED", "SCHEDULED", "WAITING"];
