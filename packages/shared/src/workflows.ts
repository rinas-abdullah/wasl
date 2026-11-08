import type { HandoverAction, HandoverStatus, QualityStatus, Role } from "./enums";

/* ------------------------------------------------------------------ */
/* Quality review workflow                                             */
/* ------------------------------------------------------------------ */

export const QUALITY_ACTIONS = ["START_REVIEW", "RELEASE", "ESCALATE", "PLACE_HOLD", "REOPEN"] as const;
export type QualityAction = (typeof QUALITY_ACTIONS)[number];

export const QUALITY_TRANSITIONS: Record<QualityAction, { from: readonly QualityStatus[]; to: QualityStatus; notesRequired: boolean; roles: readonly Role[] }> = {
  START_REVIEW: { from: ["REVIEW_REQUIRED", "HOLD"], to: "UNDER_REVIEW", notesRequired: false, roles: ["QUALITY_OFFICER", "SUPER_ADMIN"] },
  RELEASE: { from: ["UNDER_REVIEW", "ESCALATED"], to: "RELEASED_BY_AUTHORIZED_USER", notesRequired: true, roles: ["QUALITY_OFFICER", "SUPER_ADMIN"] },
  ESCALATE: { from: ["UNDER_REVIEW"], to: "ESCALATED", notesRequired: true, roles: ["QUALITY_OFFICER", "SUPER_ADMIN"] },
  PLACE_HOLD: { from: ["UNDER_REVIEW", "ESCALATED", "REVIEW_REQUIRED"], to: "HOLD", notesRequired: true, roles: ["QUALITY_OFFICER", "SUPER_ADMIN"] },
  REOPEN: { from: ["RELEASED_BY_AUTHORIZED_USER", "NO_ISSUE_OBSERVED"], to: "REVIEW_REQUIRED", notesRequired: true, roles: ["QUALITY_OFFICER", "SUPER_ADMIN"] },
};

export function evaluateQualityAction(current: QualityStatus, action: QualityAction, role: Role, notes?: string | null) {
  const rule = QUALITY_TRANSITIONS[action];
  if (!rule.roles.includes(role)) return { ok: false as const, code: "FORBIDDEN", message: `Role ${role} cannot perform quality action ${action}` };
  if (!rule.from.includes(current)) return { ok: false as const, code: "INVALID_TRANSITION", message: `Quality action ${action} is not allowed from ${current}` };
  if (rule.notesRequired && !(notes && notes.trim().length >= 5)) return { ok: false as const, code: "NOTES_REQUIRED", message: "A decision note (min. 5 characters) is required" };
  return { ok: true as const, to: rule.to };
}

/* ------------------------------------------------------------------ */
/* Handover workflow                                                   */
/* ------------------------------------------------------------------ */

export const HANDOVER_RULES: Record<HandoverAction, { from: readonly HandoverStatus[]; to: HandoverStatus }> = {
  CONFIRM_ARRIVAL: { from: ["PENDING_ARRIVAL"], to: "ARRIVAL_CONFIRMED" },
  START_UNLOADING: { from: ["ARRIVAL_CONFIRMED"], to: "UNLOADING" },
  RECORD_INSPECTION: { from: ["UNLOADING"], to: "INSPECTION_RECORDED" },
  APPROVE_HANDOVER: { from: ["UNLOADING", "INSPECTION_RECORDED"], to: "APPROVED" },
  CLOSE_OPERATION: { from: ["APPROVED"], to: "CLOSED" },
};

export function evaluateHandoverAction(current: HandoverStatus, action: HandoverAction, opts: { inspectionRequired: boolean; inspectionRecorded: boolean }) {
  const rule = HANDOVER_RULES[action];
  if (!rule.from.includes(current)) return { ok: false as const, code: "INVALID_TRANSITION", message: `Handover action ${action} is not allowed from ${current}` };
  if (action === "RECORD_INSPECTION" && !opts.inspectionRequired) return { ok: false as const, code: "GUARD_FAILED", message: "No inspection is required for this shipment" };
  if (action === "APPROVE_HANDOVER" && opts.inspectionRequired && !opts.inspectionRecorded) {
    return { ok: false as const, code: "GUARD_FAILED", message: "Inspection must be recorded before approving the handover" };
  }
  return { ok: true as const, to: rule.to };
}
