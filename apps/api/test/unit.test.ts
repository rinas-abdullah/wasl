import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "../src/domain/readiness/engine";
import { dockCompatibility, earliestFreeStart, requiredEquipment, requiredSkills, teamShiftWindow } from "../src/domain/requirements";
import { detectEvents } from "../src/domain/sensors/detect";
import { generateSeries, resolveThresholds } from "../src/domain/sensors/generator";
import { toCsv } from "../src/domain/analytics";
import { planningTableEstimate } from "../src/domain/estimates";
import { NOW, id, snapshot, truck } from "./fixtures";

const check = (out: ReturnType<typeof evaluateReadiness>, cid: string) => out.checks.find((c) => c.checkId === cid)!;
const resv = (resourceType: "DOCK" | "TEAM" | "EQUIPMENT", resourceId: string, startMin: number, endMin: number, truckId = id("other")) => ({ id: id("r" + startMin + resourceType), facilityId: id("f1"), resourceType, resourceId, truckId, decisionId: null, startAt: new Date(NOW.getTime() + startMin * 60_000), endAt: new Date(NOW.getTime() + endMin * 60_000), status: "ACTIVE" as const, createdAt: NOW, updatedAt: NOW });

describe("readiness engine", () => {
  it("READY when every mandatory condition holds, and plans dock/team/equipment", () => {
    const t = truck();
    const out = evaluateReadiness(snapshot({ trucks: [t] }), t, NOW);
    expect(out.outcome).toBe("READY");
    expect(out.plan).toMatchObject({ dockId: id("d1"), teamId: id("t1"), equipmentId: id("e1") });
    expect(new Date(out.expectedDockArrival).getTime() - NOW.getTime()).toBe(15 * 60_000);
  });
  it("REASSIGNMENT_REQUIRED when the assigned dock is out of service, with alternatives", () => {
    const s = snapshot();
    s.docks[0] = { ...s.docks[0], status: "OUT_OF_SERVICE", statusReason: "leveler" };
    const t = truck();
    const out = evaluateReadiness({ ...s, trucks: [t] }, t, NOW);
    expect(out.outcome).toBe("REASSIGNMENT_REQUIRED");
    expect(check(out, "DOCK_OPERATIONAL").result).toBe("FAIL");
    expect(check(out, "DOCK_OPERATIONAL").overridable).toBe(false);
    expect(out.alternatives.map((a) => a.dockCode)).toEqual(["D2"]);
  });
  it("HOLD when the dock is occupied at arrival, with an expected clear time", () => {
    const t = truck();
    const out = evaluateReadiness(snapshot({ trucks: [t], reservations: [resv("DOCK", id("d1"), 0, 40)] }), t, NOW);
    expect(out.outcome).toBe("HOLD");
    const c = check(out, "DOCK_FREE_AT_CALL");
    expect(c.result).toBe("FAIL");
    expect(new Date(c.expectedClearAt!).getTime()).toBe(NOW.getTime() + (40 - 15) * 60_000);
    expect(out.nextReevaluationAt).not.toBeNull();
  });
  it("does not double-book a crew: busy team → HOLD (missing resource)", () => {
    const t = truck();
    const out = evaluateReadiness(snapshot({ trucks: [t], reservations: [resv("TEAM", id("t1"), 0, 90)] }), t, NOW);
    expect(check(out, "WORKFORCE_AVAILABLE").result).toBe("FAIL");
    expect(out.outcome).toBe("HOLD");
  });
  it("requires matching skills (pharma needs PHARMA_GDP) and compatible dock", () => {
    const s = snapshot();
    s.teams[0] = { ...s.teams[0], skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED"] };
    const t = truck({ vehicleType: "REEFER_TRAILER" }, { cargoType: "PHARMA" });
    const out = evaluateReadiness({ ...s, trucks: [t] }, t, NOW);
    expect(check(out, "WORKFORCE_AVAILABLE").result).toBe("FAIL");
    const onD2 = evaluateReadiness({ ...s, trucks: [t] }, { ...t, assignedDockId: id("d2") }, NOW);
    expect(onD2.outcome).toBe("REASSIGNMENT_REQUIRED");
  });
  it("quality REVIEW_REQUIRED blocks release (manual review); UNDER_REVIEW adds inspection time", () => {
    const t1 = truck({}, { qualityStatus: "REVIEW_REQUIRED" });
    expect(evaluateReadiness(snapshot({ trucks: [t1] }), t1, NOW).outcome).toBe("MANUAL_REVIEW_REQUIRED");
    const t2 = truck({}, { qualityStatus: "UNDER_REVIEW" });
    const out = evaluateReadiness(snapshot({ trucks: [t2] }), t2, NOW);
    expect(out.outcome).toBe("READY");
    expect(out.plan.windowEnd.getTime() - out.plan.windowStart.getTime()).toBe(60 * 60_000);
  });
  it("missing documents fail but are overridable; yard full is not overridable", () => {
    const t = truck({}, { documentsComplete: false });
    const out = evaluateReadiness(snapshot({ trucks: [t] }), t, NOW);
    expect(check(out, "DOCUMENTS_COMPLETE")).toMatchObject({ result: "FAIL", overridable: true });
    const waiting = Array.from({ length: 4 }, (_, i) => truck({ id: id("w" + i), status: "WAITING", actualArrival: NOW }));
    const out2 = evaluateReadiness(snapshot({ trucks: [truck(), ...waiting] }), truck(), NOW);
    expect(check(out2, "YARD_CAPACITY")).toMatchObject({ result: "FAIL", overridable: false });
  });
  it("only SCHEDULED/WAITING trucks are releasable", () => {
    const t = truck({ status: "IN_SERVICE" });
    expect(check(evaluateReadiness(snapshot({ trucks: [t] }), t, NOW), "TRUCK_STATE").result).toBe("FAIL");
  });
  it("is deterministic for the same snapshot", () => {
    const t = truck();
    const s = snapshot({ trucks: [t] });
    expect(evaluateReadiness(s, t, NOW)).toEqual(evaluateReadiness(s, t, NOW));
  });
});

describe("resource availability", () => {
  it("earliestFreeStart skips overlapping intervals and respects latest end", () => {
    const busy = [{ startAt: new Date(10 * 60_000), endAt: new Date(40 * 60_000) }, { startAt: new Date(50 * 60_000), endAt: new Date(70 * 60_000) }];
    expect(earliestFreeStart(busy, new Date(0), 10)!.getTime()).toBe(0);
    expect(earliestFreeStart(busy, new Date(0), 15)!.getTime()).toBe(70 * 60_000);
    expect(earliestFreeStart(busy, new Date(0), 15, new Date(60 * 60_000))).toBeNull();
  });
  it("skills, equipment and compatibility rules", () => {
    expect(requiredSkills("FROZEN", "FORKLIFT_PALLET")).toEqual(expect.arrayContaining(["COLD_CHAIN", "FORKLIFT_LICENSED"]));
    expect(requiredEquipment("MANUAL")).toBeNull();
    const d = snapshot().docks[1];
    expect(dockCompatibility(d, "ARTICULATED", "GENERAL").ok).toBe(false);
    expect(dockCompatibility(d, "RIGID", "CHILLED").ok).toBe(false);
  });
  it("planning-table estimate is labelled and monotonic in pallets", () => {
    const a = planningTableEstimate({ cargoType: "GENERAL", palletCount: 10, handlingMethod: "FORKLIFT_PALLET", vehicleType: "RIGID", teamSize: 4, dockHasLeveler: true, inspectionRequired: false });
    const b = planningTableEstimate({ cargoType: "GENERAL", palletCount: 20, handlingMethod: "FORKLIFT_PALLET", vehicleType: "RIGID", teamSize: 4, dockHasLeveler: true, inspectionRequired: false });
    expect(a.source).toBe("PLANNING_TABLE");
    expect(b.minutes).toBeGreaterThan(a.minutes);
  });
});

describe("overnight shifts", () => {
  const team = snapshot().teams[0];
  const night = { ...team, shiftStart: "20:00", shiftEnd: "04:00" };
  it("an instant after midnight belongs to the shift that started the previous evening", () => {
    const at = new Date("2026-11-08T22:30:00Z"); // 01:30 Riyadh on the 9th
    const w = teamShiftWindow(night, at, "Asia/Riyadh");
    expect(w.start.toISOString()).toBe("2026-11-08T17:00:00.000Z"); // 20:00 on the 8th
    expect(w.end.toISOString()).toBe("2026-11-09T01:00:00.000Z"); // 04:00 on the 9th
  });
  it("before the evening start returns the upcoming shift", () => {
    const w = teamShiftWindow(night, new Date("2026-11-08T12:00:00Z"), "Asia/Riyadh"); // 15:00 local
    expect(w.start.toISOString()).toBe("2026-11-08T17:00:00.000Z");
  });
  it("day shifts are unchanged", () => {
    const w = teamShiftWindow(team, NOW, "Asia/Riyadh");
    expect(w.start.toISOString()).toBe("2026-11-08T03:00:00.000Z");
  });
});

describe("virtual sensors", () => {
  const th = resolveThresholds("CHILLED", {});
  it("same seed ⇒ identical series (reproducible)", () => {
    expect(generateSeries("TEMP_EXCURSION", 42, NOW, 360, th)).toEqual(generateSeries("TEMP_EXCURSION", 42, NOW, 360, th));
  });
  it("normal journey produces no events", () => {
    expect(detectEvents(generateSeries("NORMAL", 7, NOW, 360, th).readings, th)).toEqual([]);
  });
  it("detects excursion, shock and missing data with their rules", () => {
    expect(detectEvents(generateSeries("TEMP_EXCURSION", 1, NOW, 360, th).readings, th).map((e) => e.ruleId)).toContain("R-TEMP-01");
    expect(detectEvents(generateSeries("SHOCK", 1, NOW, 360, th).readings, th).map((e) => e.ruleId)).toContain("R-SHOCK-01");
    expect(detectEvents(generateSeries("MISSING_DATA", 1, NOW, 360, th).readings, th).map((e) => e.ruleId)).toContain("R-MISS-01");
  });
  it("a single out-of-range reading is treated as noise", () => {
    const r = generateSeries("NORMAL", 3, NOW, 120, th).readings;
    r[5] = { ...r[5], temperatureC: 20 };
    expect(detectEvents(r, th).filter((e) => e.type === "TEMP_EXCURSION")).toEqual([]);
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formula injection and escapes quotes", () => {
    const csv = toCsv([{ a: "=HYPERLINK(1)", b: 'x,"y"' }]);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"x,""y"""');
  });
});
