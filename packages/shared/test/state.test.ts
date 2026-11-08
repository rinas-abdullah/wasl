import { describe, expect, it } from "vitest";
import { aggregateOutcome, availableActions, evaluateHandoverAction, evaluateQualityAction, evaluateTransition, hasPermission, presetParams, simulationParamsSchema, startOfLocalDay, tzOffsetMinutes } from "../src";

const ctx = { hasActiveRelease: false, hasArrived: false, handoverApprovedOrNotRequired: true, reason: null };

describe("truck state machine", () => {
  it("allows the nominal path and rejects illogical jumps", () => {
    expect(evaluateTransition("SCHEDULED", "MARK_ARRIVAL", ctx)).toEqual({ ok: true, to: "WAITING" });
    expect(evaluateTransition("CALLED", "MARK_ARRIVAL", { ...ctx, hasActiveRelease: true })).toEqual({ ok: true, to: "ARRIVED" });
    expect(evaluateTransition("REGISTERED", "COMPLETE_SERVICE", ctx)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(evaluateTransition("DEPARTED", "CANCEL", { ...ctx, reason: "x".repeat(10) })).toMatchObject({ ok: false });
  });
  it("guards service start on release and arrival", () => {
    expect(evaluateTransition("ARRIVED", "START_SERVICE", { ...ctx, hasArrived: true })).toMatchObject({ ok: false, code: "GUARD_FAILED" });
    expect(evaluateTransition("CALLED", "START_SERVICE", { ...ctx, hasActiveRelease: true })).toMatchObject({ ok: false, code: "GUARD_FAILED" });
    expect(evaluateTransition("CALLED", "START_SERVICE", { ...ctx, hasActiveRelease: true, hasArrived: true })).toEqual({ ok: true, to: "IN_SERVICE" });
  });
  it("requires a reason for cancellation and exceptions", () => {
    expect(evaluateTransition("SCHEDULED", "CANCEL", ctx)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(evaluateTransition("SCHEDULED", "CANCEL", { ...ctx, reason: "carrier cancelled" })).toEqual({ ok: true, to: "CANCELLED" });
  });
  it("requires an approved handover before departure", () => {
    expect(evaluateTransition("COMPLETED", "REGISTER_DEPARTURE", { ...ctx, handoverApprovedOrNotRequired: false })).toMatchObject({ ok: false, code: "GUARD_FAILED" });
  });
  it("never exposes RELEASE as a generic action from terminal states", () => {
    expect(availableActions("DEPARTED")).toEqual([]);
  });
});

describe("readiness aggregation", () => {
  it("prioritises reassignment over manual review over hold", () => {
    expect(aggregateOutcome([{ checkId: "DOCK_OPERATIONAL", result: "FAIL", blocking: true }, { checkId: "QUALITY_REQUIREMENTS", result: "FAIL", blocking: true }])).toBe("REASSIGNMENT_REQUIRED");
    expect(aggregateOutcome([{ checkId: "QUALITY_REQUIREMENTS", result: "FAIL", blocking: true }, { checkId: "WORKFORCE_AVAILABLE", result: "FAIL", blocking: true }])).toBe("MANUAL_REVIEW_REQUIRED");
    expect(aggregateOutcome([{ checkId: "WORKFORCE_AVAILABLE", result: "FAIL", blocking: true }])).toBe("HOLD");
    expect(aggregateOutcome([{ checkId: "SCHEDULE_IMPACT", result: "FAIL", blocking: false }, { checkId: "YARD_CAPACITY", result: "WARN", blocking: true }])).toBe("READY");
  });
  it("treats overridden checks as passed", () => {
    expect(aggregateOutcome([{ checkId: "DOCUMENTS_COMPLETE", result: "FAIL", blocking: true }], ["DOCUMENTS_COMPLETE"])).toBe("READY");
  });
});

describe("quality & handover workflows", () => {
  it("only quality officers can release, with notes", () => {
    expect(evaluateQualityAction("UNDER_REVIEW", "RELEASE", "OPERATIONS_MANAGER", "ok notes")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(evaluateQualityAction("UNDER_REVIEW", "RELEASE", "QUALITY_OFFICER", "")).toMatchObject({ ok: false, code: "NOTES_REQUIRED" });
    expect(evaluateQualityAction("UNDER_REVIEW", "RELEASE", "QUALITY_OFFICER", "temperature within tolerance after inspection")).toEqual({ ok: true, to: "RELEASED_BY_AUTHORIZED_USER" });
    expect(evaluateQualityAction("REVIEW_REQUIRED", "RELEASE", "QUALITY_OFFICER", "skip review")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
  it("handover requires inspection before approval when required", () => {
    expect(evaluateHandoverAction("UNLOADING", "APPROVE_HANDOVER", { inspectionRequired: true, inspectionRecorded: false })).toMatchObject({ ok: false });
    expect(evaluateHandoverAction("INSPECTION_RECORDED", "APPROVE_HANDOVER", { inspectionRequired: true, inspectionRecorded: true })).toEqual({ ok: true, to: "APPROVED" });
    expect(evaluateHandoverAction("APPROVED", "CONFIRM_ARRIVAL", { inspectionRequired: false, inspectionRecorded: false })).toMatchObject({ ok: false });
  });
});

describe("permissions", () => {
  it("auditors are read-only; carriers cannot approve plans", () => {
    expect(hasPermission("AUDITOR", "events:read")).toBe(true);
    expect(hasPermission("AUDITOR", "trucks:create")).toBe(false);
    expect(hasPermission("CARRIER_OPERATOR", "optimization:approve")).toBe(false);
    expect(hasPermission("QUALITY_OFFICER", "release:override")).toBe(false);
  });
});

describe("time & presets", () => {
  it("computes Riyadh offset and local midnight without DST errors", () => {
    const at = new Date("2026-11-08T22:30:00Z"); // 01:30 next day in Riyadh
    expect(tzOffsetMinutes(at, "Asia/Riyadh")).toBe(180);
    expect(startOfLocalDay(at, "Asia/Riyadh").toISOString()).toBe("2026-11-08T21:00:00.000Z");
  });
  it("all presets validate against the simulation schema", () => {
    for (const p of ["NORMAL", "PEAK_ARRIVALS", "DOCK_FAILURE", "WORKFORCE_SHORTAGE", "DELAYED_TRUCKS", "QUALITY_SURGE", "MIXED_DISRUPTION"] as const) {
      expect(simulationParamsSchema.safeParse(presetParams(p)).success).toBe(true);
    }
  });
});
