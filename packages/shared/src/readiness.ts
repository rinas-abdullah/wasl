import type { ReadinessOutcome } from "./enums";

/**
 * Readiness-to-Release check catalogue. Each check is evaluated server-side by
 * apps/api/src/domain/readiness/engine.ts. `overridable` is the policy: only
 * checks marked overridable can be bypassed by an authorised manager with a
 * documented reason. Safety / physical-capacity checks are never overridable.
 */
export const READINESS_CHECKS = {
  TRUCK_STATE: { blocking: true, overridable: false, failOutcome: "HOLD" },
  DOCK_ASSIGNED: { blocking: true, overridable: false, failOutcome: "REASSIGNMENT_REQUIRED" },
  DOCK_OPERATIONAL: { blocking: true, overridable: false, failOutcome: "REASSIGNMENT_REQUIRED" },
  DOCK_COMPATIBILITY: { blocking: true, overridable: false, failOutcome: "REASSIGNMENT_REQUIRED" },
  DOCK_FREE_AT_CALL: { blocking: true, overridable: false, failOutcome: "HOLD" },
  WORKFORCE_AVAILABLE: { blocking: true, overridable: false, failOutcome: "HOLD" },
  EQUIPMENT_AVAILABLE: { blocking: true, overridable: false, failOutcome: "HOLD" },
  GATE_CAPACITY: { blocking: true, overridable: true, failOutcome: "HOLD" },
  YARD_CAPACITY: { blocking: true, overridable: false, failOutcome: "HOLD" },
  DOCUMENTS_COMPLETE: { blocking: true, overridable: true, failOutcome: "HOLD" },
  QUALITY_REQUIREMENTS: { blocking: true, overridable: false, failOutcome: "MANUAL_REVIEW_REQUIRED" },
  APPOINTMENT_CONFIRMED: { blocking: true, overridable: true, failOutcome: "HOLD" },
  SCHEDULE_IMPACT: { blocking: false, overridable: false, failOutcome: "HOLD" },
} as const satisfies Record<string, { blocking: boolean; overridable: boolean; failOutcome: ReadinessOutcome }>;

export type ReadinessCheckId = keyof typeof READINESS_CHECKS;
export const READINESS_CHECK_IDS = Object.keys(READINESS_CHECKS) as ReadinessCheckId[];

export type CheckResult = "PASS" | "FAIL" | "WARN" | "NOT_APPLICABLE";

export interface ReadinessCheck {
  checkId: ReadinessCheckId;
  result: CheckResult;
  blocking: boolean;
  overridable: boolean;
  evidenceSource: string;
  evaluatedAt: string;
  reason: string;
  reasonAr: string;
  suggestedAction: string | null;
  suggestedActionAr: string | null;
  /** Machine-readable evidence (resource ids, times, counts). */
  evidence: Record<string, unknown>;
  /** Earliest time this check is expected to pass, if computable. */
  expectedClearAt?: string | null;
}

export interface ReadinessResult {
  truckId: string;
  outcome: ReadinessOutcome;
  proposedCallTime: string;
  expectedDockArrival: string;
  evaluatedAt: string;
  engineVersion: string;
  checks: ReadinessCheck[];
  nextReevaluationAt: string | null;
  affectedResources: { type: string; id: string; code: string }[];
  alternatives: { dockId: string; dockCode: string; earliestStart: string }[];
  summary: string;
  summaryAr: string;
}

export function aggregateOutcome(checks: Pick<ReadinessCheck, "checkId" | "result" | "blocking">[], overridden: readonly string[] = []): ReadinessOutcome {
  const failing = checks.filter((c) => c.result === "FAIL" && c.blocking && !overridden.includes(c.checkId));
  if (failing.length === 0) return "READY";
  const outcomes = failing.map((c) => READINESS_CHECKS[c.checkId as ReadinessCheckId].failOutcome as ReadinessOutcome);
  if (outcomes.includes("REASSIGNMENT_REQUIRED")) return "REASSIGNMENT_REQUIRED";
  if (outcomes.includes("MANUAL_REVIEW_REQUIRED")) return "MANUAL_REVIEW_REQUIRED";
  return "HOLD";
}
