import {
  READINESS_CHECKS,
  aggregateOutcome,
  addMinutes,
  type ReadinessCheck,
  type ReadinessCheckId,
  type ReadinessResult,
} from "@wasl/shared";
import type { FacilitySnapshot, TruckWithShipment } from "../snapshot";
import {
  busyFor,
  dockCompatibility,
  earliestFreeStart,
  isDockDown,
  requiredEquipment,
  requiredSkills,
  teamHasSkills,
  teamShiftWindow,
} from "../requirements";

export const READINESS_ENGINE_VERSION = "readiness-1.2.0";
/** Minutes added to the service window when a quality inspection happens at the dock. */
export const INSPECTION_MIN = 20;
/** Minutes for an on-site truck to move from the yard to its dock. */
export const YARD_TO_DOCK_MIN = 5;

export interface ResourcePlan {
  dockId: string | null;
  teamId: string | null;
  equipmentId: string | null;
  windowStart: Date;
  windowEnd: Date;
}

export interface EngineOutput extends ReadinessResult {
  plan: ResourcePlan;
  inputSnapshot: Record<string, unknown>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hhmm = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/**
 * Pure readiness evaluation over a facility snapshot. Deterministic: same
 * snapshot + truck + call time ⇒ same result. All I/O lives in service.ts.
 */
export function evaluateReadiness(snap: FacilitySnapshot, truck: TruckWithShipment, proposedCallTime: Date): EngineOutput {
  const tz = snap.facility.timezone;
  const now = snap.takenAt;
  const evaluatedAt = now.toISOString();
  const onSite = truck.actualArrival !== null;
  const travel = onSite ? YARD_TO_DOCK_MIN : snap.facility.travelTimeMin;
  const dockArrival = addMinutes(proposedCallTime, travel);
  const qualityOpen = ["REVIEW_REQUIRED", "UNDER_REVIEW"].includes(truck.shipment.qualityStatus);
  const needsInspection = qualityOpen || truck.shipment.inspectionRequired;
  const serviceMin = truck.serviceEstimateMin + (needsInspection && !truck.serviceEstimateSource.includes("+inspection") ? INSPECTION_MIN : 0);
  const windowStart = dockArrival;
  const windowEnd = addMinutes(dockArrival, serviceMin);
  const dock = snap.docks.find((d) => d.id === truck.assignedDockId) ?? null;
  const skills = requiredSkills(truck.shipment.cargoType, truck.shipment.handlingMethod);
  const eqType = requiredEquipment(truck.shipment.handlingMethod);

  const checks: ReadinessCheck[] = [];
  const affected: ReadinessResult["affectedResources"] = [];
  const plan: ResourcePlan = { dockId: dock?.id ?? null, teamId: null, equipmentId: null, windowStart, windowEnd };

  const add = (
    checkId: ReadinessCheckId,
    result: ReadinessCheck["result"],
    evidenceSource: string,
    reason: [string, string],
    suggested: [string, string] | null,
    evidence: Record<string, unknown> = {},
    expectedClearAt: Date | null = null,
  ) => {
    const def = READINESS_CHECKS[checkId];
    checks.push({
      checkId,
      result,
      blocking: def.blocking,
      overridable: def.overridable,
      evidenceSource,
      evaluatedAt,
      reason: reason[0],
      reasonAr: reason[1],
      suggestedAction: suggested?.[0] ?? null,
      suggestedActionAr: suggested?.[1] ?? null,
      evidence,
      expectedClearAt: iso(expectedClearAt),
    });
  };

  /* 1. Truck state */
  if (truck.status === "SCHEDULED" || truck.status === "WAITING") {
    add("TRUCK_STATE", "PASS", "trucks.status", [`Truck is ${truck.status} and eligible for release`, `حالة الشاحنة ${truck.status} وقابلة للاستدعاء`], null, { status: truck.status });
  } else {
    add("TRUCK_STATE", "FAIL", "trucks.status", [`Truck status ${truck.status} cannot be released`, `لا يمكن استدعاء شاحنة بحالة ${truck.status}`], ["Schedule the truck first or check its lifecycle state", "جدولة الشاحنة أولًا أو مراجعة حالتها"], { status: truck.status });
  }

  /* 2-4. Dock assignment, operational status, compatibility */
  const compatibleOperational = snap.docks.filter((d) => !isDockDown(d) && dockCompatibility(d, truck.vehicleType, truck.shipment.cargoType).ok);
  const alternatives = compatibleOperational
    .filter((d) => d.id !== dock?.id)
    .map((d) => {
      const s = earliestFreeStart(busyFor(snap.reservations, "DOCK", d.id, truck.id), dockArrival, serviceMin);
      return { dockId: d.id, dockCode: d.code, earliestStart: (s ?? dockArrival).toISOString() };
    })
    .sort((a, b) => a.earliestStart.localeCompare(b.earliestStart));

  if (!dock) {
    add("DOCK_ASSIGNED", "FAIL", "trucks.assigned_dock_id", ["No dock is assigned", "لم يُخصص رصيف للشاحنة"], ["Assign a compatible dock or run optimisation", "خصص رصيفًا متوافقًا أو شغّل محرك التحسين"], { alternatives: alternatives.length });
    add("DOCK_OPERATIONAL", "NOT_APPLICABLE", "docks.status", ["No dock to check", "لا يوجد رصيف للفحص"], null);
    add("DOCK_COMPATIBILITY", "NOT_APPLICABLE", "docks", ["No dock to check", "لا يوجد رصيف للفحص"], null);
    add("DOCK_FREE_AT_CALL", "NOT_APPLICABLE", "resource_reservations", ["No dock to check", "لا يوجد رصيف للفحص"], null);
  } else {
    affected.push({ type: "DOCK", id: dock.id, code: dock.code });
    add("DOCK_ASSIGNED", "PASS", "trucks.assigned_dock_id", [`Assigned to ${dock.code}`, `مخصص للرصيف ${dock.code}`], null, { dockId: dock.id });
    if (isDockDown(dock)) {
      add("DOCK_OPERATIONAL", "FAIL", "docks.status", [`${dock.code} is ${dock.status}${dock.statusReason ? `: ${dock.statusReason}` : ""}`, `الرصيف ${dock.code} بحالة ${dock.status}${dock.statusReason ? ` — ${dock.statusReason}` : ""}`], alternatives[0] ? [`Reassign to ${alternatives[0].dockCode} (free from ${hhmm(new Date(alternatives[0].earliestStart), tz)})`, `إعادة التخصيص إلى ${alternatives[0].dockCode} (متاح من ${hhmm(new Date(alternatives[0].earliestStart), tz)})`] : ["No compatible dock is operational; wait for restoration", "لا يوجد رصيف متوافق عامل؛ انتظر إعادة التشغيل"], { status: dock.status, until: iso(dock.statusUntil) }, dock.statusUntil);
    } else {
      add("DOCK_OPERATIONAL", "PASS", "docks.status", [`${dock.code} is operational (${dock.status})`, `الرصيف ${dock.code} يعمل (${dock.status})`], null, { status: dock.status });
    }
    const compat = dockCompatibility(dock, truck.vehicleType, truck.shipment.cargoType);
    if (compat.ok) {
      add("DOCK_COMPATIBILITY", "PASS", "docks.max_vehicle_type, docks.compatible_cargo, docks.features", [`${dock.code} accepts ${truck.vehicleType} / ${truck.shipment.cargoType}`, `الرصيف ${dock.code} يقبل ${truck.vehicleType} / ${truck.shipment.cargoType}`], null);
    } else {
      add("DOCK_COMPATIBILITY", "FAIL", "docks.max_vehicle_type, docks.compatible_cargo, docks.features", [compat.problems.map((p) => p.en).join("; "), compat.problems.map((p) => p.ar).join("؛ ")], alternatives[0] ? [`Reassign to ${alternatives[0].dockCode}`, `إعادة التخصيص إلى ${alternatives[0].dockCode}`] : ["No compatible dock available", "لا يوجد رصيف متوافق"], { problems: compat.problems });
    }
    if (!isDockDown(dock)) {
      const busy = busyFor(snap.reservations, "DOCK", dock.id, truck.id);
      const conflicts = busy.filter((b) => b.startAt < windowEnd && windowStart < b.endAt);
      if (conflicts.length === 0) {
        add("DOCK_FREE_AT_CALL", "PASS", "resource_reservations", [`${dock.code} is free ${hhmm(windowStart, tz)}–${hhmm(windowEnd, tz)}`, `الرصيف ${dock.code} متاح ${hhmm(windowStart, tz)}–${hhmm(windowEnd, tz)}`], null, { windowStart: iso(windowStart), windowEnd: iso(windowEnd) });
      } else {
        const free = earliestFreeStart(busy, windowStart, serviceMin)!;
        const conflictTrucks = conflicts.map((c) => snap.trucks.find((t) => t.id === c.truckId)?.code ?? c.truckId);
        add("DOCK_FREE_AT_CALL", "FAIL", "resource_reservations", [`${dock.code} is occupied until ${hhmm(free, tz)} (${conflictTrucks.join(", ")})`, `الرصيف ${dock.code} مشغول حتى ${hhmm(free, tz)} (${conflictTrucks.join("، ")})`], [`Call at ${hhmm(addMinutes(free, -travel), tz)} or reassign`, `الاستدعاء عند ${hhmm(addMinutes(free, -travel), tz)} أو إعادة التخصيص`], { conflicts: conflicts.map((c) => c.id), freeAt: iso(free) }, addMinutes(free, -travel));
      }
    } else {
      add("DOCK_FREE_AT_CALL", "NOT_APPLICABLE", "resource_reservations", ["Dock is not operational", "الرصيف غير عامل"], null);
    }
  }

  /* 5. Workforce */
  const day = windowStart;
  const skilled = snap.teams.filter((t) => teamHasSkills(t, skills));
  const teamOptions = skilled.map((t) => {
    const shift = teamShiftWindow(t, day, tz);
    const busy = busyFor(snap.reservations, "TEAM", t.id, truck.id);
    const inShift = windowStart >= shift.start && windowEnd <= shift.end;
    const free = !busy.some((b) => b.startAt < windowEnd && windowStart < b.endAt);
    const nextFree = earliestFreeStart(busy, windowStart < shift.start ? shift.start : windowStart, serviceMin, shift.end);
    return { team: t, inShift, free, available: t.status === "AVAILABLE", nextFree };
  });
  const usable = teamOptions.find((o) => o.inShift && o.free && o.available);
  if (usable) {
    plan.teamId = usable.team.id;
    affected.push({ type: "TEAM", id: usable.team.id, code: usable.team.code });
    add("WORKFORCE_AVAILABLE", "PASS", "workforce_teams, resource_reservations", [`${usable.team.name} (${usable.team.size} staff) is on shift and free; skills: ${skills.join(", ")}`, `${usable.team.nameAr} (${usable.team.size} أفراد) في الوردية ومتاح؛ المهارات: ${skills.join("، ")}`], null, { teamId: usable.team.id, requiredSkills: skills });
  } else {
    const next = teamOptions.filter((o) => o.available && o.nextFree).sort((a, b) => a.nextFree!.getTime() - b.nextFree!.getTime())[0];
    const why = skilled.length === 0 ? [`No team holds required skills (${skills.join(", ")})`, `لا يوجد فريق يملك المهارات المطلوبة (${skills.join("، ")})`] : [`All qualified teams are busy, off shift or unavailable in ${hhmm(windowStart, tz)}–${hhmm(windowEnd, tz)}`, `جميع الفرق المؤهلة مشغولة أو خارج الوردية أو غير متاحة خلال ${hhmm(windowStart, tz)}–${hhmm(windowEnd, tz)}`];
    for (const o of teamOptions) affected.push({ type: "TEAM", id: o.team.id, code: o.team.code });
    add("WORKFORCE_AVAILABLE", "FAIL", "workforce_teams, resource_reservations", why as [string, string], next ? [`${next.team.name} expected free at ${hhmm(next.nextFree!, tz)}`, `${next.team.nameAr} متوقع توفره عند ${hhmm(next.nextFree!, tz)}`] : ["Adjust shifts or assign a qualified team", "عدّل الورديات أو خصص فريقًا مؤهلًا"], { requiredSkills: skills, teams: teamOptions.map((o) => ({ code: o.team.code, inShift: o.inShift, free: o.free, status: o.team.status })) }, next ? addMinutes(next.nextFree!, -travel) : null);
  }

  /* 6. Equipment */
  if (!eqType) {
    add("EQUIPMENT_AVAILABLE", "NOT_APPLICABLE", "shipments.handling_method", ["Manual handling — no equipment required", "مناولة يدوية — لا تتطلب معدات"], null);
  } else {
    const units = snap.equipment.filter((e) => e.type === eqType);
    const freeUnit = units.find((e) => e.status === "AVAILABLE" && !busyFor(snap.reservations, "EQUIPMENT", e.id, truck.id).some((b) => b.startAt < windowEnd && windowStart < b.endAt));
    if (freeUnit) {
      plan.equipmentId = freeUnit.id;
      affected.push({ type: "EQUIPMENT", id: freeUnit.id, code: freeUnit.code });
      add("EQUIPMENT_AVAILABLE", "PASS", "equipment, resource_reservations", [`${freeUnit.code} (${eqType}) is available`, `المعدة ${freeUnit.code} (${eqType}) متاحة`], null, { equipmentId: freeUnit.id });
    } else {
      const nexts = units.filter((e) => e.status === "AVAILABLE").map((e) => earliestFreeStart(busyFor(snap.reservations, "EQUIPMENT", e.id, truck.id), windowStart, serviceMin)!).sort((a, b) => a.getTime() - b.getTime());
      add("EQUIPMENT_AVAILABLE", "FAIL", "equipment, resource_reservations", [`No ${eqType} available (${units.length} units; ${units.filter((u) => u.status !== "AVAILABLE").length} in maintenance/out of service)`, `لا تتوفر معدة ${eqType} (${units.length} وحدات؛ ${units.filter((u) => u.status !== "AVAILABLE").length} في الصيانة/خارج الخدمة)`], nexts[0] ? [`Expected free at ${hhmm(nexts[0], tz)}`, `متوقع توفرها عند ${hhmm(nexts[0], tz)}`] : ["Restore equipment from maintenance", "إعادة المعدات من الصيانة"], { equipmentType: eqType }, nexts[0] ? addMinutes(nexts[0], -travel) : null);
    }
  }

  /* 7. Gate capacity */
  const openEntry = snap.gates.filter((g) => g.type === "ENTRY" && g.status === "OPEN");
  if (onSite) {
    add("GATE_CAPACITY", "NOT_APPLICABLE", "gates", ["Truck already inside the facility", "الشاحنة داخل المنشأة بالفعل"], null);
  } else if (openEntry.length === 0) {
    add("GATE_CAPACITY", "FAIL", "gates.status", ["No entry gate is open", "لا توجد بوابة دخول مفتوحة"], ["Open an entry gate", "افتح بوابة دخول"], {});
  } else {
    const cap = Math.min(snap.facility.gateCapacityPerHour, openEntry.reduce((s, g) => s + g.capacityPerHour, 0));
    const gateTime = addMinutes(proposedCallTime, travel);
    const from = addMinutes(gateTime, -30);
    const to = addMinutes(gateTime, 30);
    const expected = snap.trucks.filter((t) => {
      if (t.id === truck.id || t.actualArrival) return false;
      const eta = t.status === "CALLED" && t.calledAt ? addMinutes(t.calledAt, snap.facility.travelTimeMin) : t.appointment?.confirmedStart ?? null;
      return eta !== null && eta >= from && eta < to;
    }).length;
    const res = expected + 1 > cap ? "FAIL" : expected + 1 >= cap * 0.8 ? "WARN" : "PASS";
    add("GATE_CAPACITY", res, "gates, trucks, appointments", [`${expected + 1}/${cap} gate entries expected within ±30 min of ${hhmm(gateTime, tz)}`, `${expected + 1}/${cap} دخولًا متوقعًا خلال ±30 دقيقة من ${hhmm(gateTime, tz)}`], res === "FAIL" ? ["Stagger the call by 15–30 minutes", "أجّل الاستدعاء 15–30 دقيقة"] : null, { expected: expected + 1, capacity: cap });
  }

  /* 8. Yard capacity */
  const yardOccupancy = snap.trucks.filter((t) => t.status === "WAITING" || t.status === "ARRIVED" || t.status === "EXCEPTION").length;
  const yardCap = snap.facility.yardCapacity;
  if (onSite) {
    add("YARD_CAPACITY", "NOT_APPLICABLE", "trucks", [`Truck already in yard (${yardOccupancy}/${yardCap})`, `الشاحنة في الساحة بالفعل (${yardOccupancy}/${yardCap})`], null, { occupancy: yardOccupancy, capacity: yardCap });
  } else {
    const res = yardOccupancy >= yardCap ? "FAIL" : yardOccupancy >= Math.ceil(yardCap * 0.8) ? "WARN" : "PASS";
    add("YARD_CAPACITY", res, "trucks.status", [`Yard occupancy ${yardOccupancy}/${yardCap}`, `إشغال الساحة ${yardOccupancy}/${yardCap}`], res === "FAIL" ? ["Hold until yard space frees up", "التأجيل حتى تتوفر مساحة في الساحة"] : res === "WARN" ? ["Yard near limit — prefer direct-to-dock calls", "الساحة قريبة من الامتلاء — يفضل الاستدعاء المباشر للرصيف"] : null, { occupancy: yardOccupancy, capacity: yardCap });
  }

  /* 9. Documents */
  if (truck.shipment.documentsComplete) add("DOCUMENTS_COMPLETE", "PASS", "shipments.documents_complete", ["Required documents recorded", "المستندات المطلوبة مسجلة"], null);
  else add("DOCUMENTS_COMPLETE", "FAIL", "shipments.documents_complete", ["Shipment documents incomplete", "مستندات الشحنة غير مكتملة"], ["Request documents from carrier, or override with reason if verified at gate", "اطلب المستندات من الناقل أو تجاوز بسبب موثق إذا تم التحقق عند البوابة"]);

  /* 10. Quality */
  const qs = truck.shipment.qualityStatus;
  const review = snap.openQualityReviews.find((r) => r.shipmentId === truck.shipmentId) ?? null;
  if (qs === "HOLD" || qs === "ESCALATED") {
    add("QUALITY_REQUIREMENTS", "FAIL", "quality_reviews", [`Quality status ${qs} — release blocked`, `حالة الجودة ${qs} — الاستدعاء موقوف`], ["Quality officer must resolve the review", "يجب على مسؤول الجودة معالجة المراجعة"], { qualityStatus: qs, reviewId: review?.id ?? null });
  } else if (qs === "REVIEW_REQUIRED") {
    add("QUALITY_REQUIREMENTS", "FAIL", "quality_reviews", ["Quality review required and not yet started — no inspector coordinated", "مراجعة جودة مطلوبة ولم تبدأ — لم يُنسّق مفتش"], ["Quality officer must start the review (assigns inspector)", "يجب أن يبدأ مسؤول الجودة المراجعة (تعيين مفتش)"], { qualityStatus: qs, reviewId: review?.id ?? null });
  } else if (qs === "UNDER_REVIEW") {
    add("QUALITY_REQUIREMENTS", "WARN", "quality_reviews", [`Inspection coordinated; +${INSPECTION_MIN} min inspection added to the service window`, `تم تنسيق الفحص؛ أضيفت ${INSPECTION_MIN} دقيقة فحص لنافذة الخدمة`], null, { qualityStatus: qs, reviewId: review?.id ?? null });
  } else if (truck.shipment.inspectionRequired) {
    if (snap.qualityOfficerCount > 0) add("QUALITY_REQUIREMENTS", "WARN", "shipments.inspection_required", [`Policy inspection required; +${INSPECTION_MIN} min added`, `فحص إلزامي حسب السياسة؛ أضيفت ${INSPECTION_MIN} دقيقة`], null, { qualityStatus: qs });
    else add("QUALITY_REQUIREMENTS", "FAIL", "memberships", ["Inspection required but no quality officer exists", "الفحص مطلوب ولا يوجد مسؤول جودة"], ["Assign a quality officer", "عيّن مسؤول جودة"]);
  } else {
    add("QUALITY_REQUIREMENTS", "PASS", "shipments.quality_status", [`Quality status ${qs}`, `حالة الجودة ${qs}`], null, { qualityStatus: qs });
  }

  /* 11. Appointment */
  if (truck.appointment?.status === "CONFIRMED") add("APPOINTMENT_CONFIRMED", "PASS", "appointments", ["Confirmed appointment on record", "يوجد موعد مؤكد"], null, { appointmentId: truck.appointment.id });
  else add("APPOINTMENT_CONFIRMED", "FAIL", "appointments", ["No confirmed appointment", "لا يوجد موعد مؤكد"], ["Confirm an appointment, or override for an unscheduled arrival", "أكد موعدًا أو تجاوز لوصول غير مجدول"]);

  /* 12. Schedule impact (advisory) */
  if (dock) {
    const impacted = snap.trucks.filter(
      (t) => t.id !== truck.id && t.assignedDockId === dock.id && t.appointment?.confirmedStart && !snap.reservations.some((r) => r.truckId === t.id) && t.appointment.confirmedStart < windowEnd && addMinutes(t.appointment.confirmedStart, t.appointment.durationMin) > windowStart,
    );
    if (impacted.length) add("SCHEDULE_IMPACT", "WARN", "appointments", [`Overlaps confirmed appointments of ${impacted.map((t) => t.code).join(", ")} on ${dock.code}`, `يتداخل مع مواعيد مؤكدة لـ ${impacted.map((t) => t.code).join("، ")} على ${dock.code}`], ["Re-run optimisation to re-sequence affected appointments", "أعد تشغيل التحسين لإعادة ترتيب المواعيد المتأثرة"], { impacted: impacted.map((t) => t.id) });
    else add("SCHEDULE_IMPACT", "PASS", "appointments", ["No impact on other confirmed appointments", "لا أثر على المواعيد المؤكدة الأخرى"], null);
  } else add("SCHEDULE_IMPACT", "NOT_APPLICABLE", "appointments", ["No dock", "لا يوجد رصيف"], null);

  const outcome = aggregateOutcome(checks);
  const failing = checks.filter((c) => c.result === "FAIL" && c.blocking);
  const clearTimes = failing.map((c) => c.expectedClearAt).filter((x): x is string => !!x);
  const nextReevaluationAt = outcome === "HOLD" && clearTimes.length === failing.length && clearTimes.length > 0 ? clearTimes.sort().at(-1)! : null;

  const summary =
    outcome === "READY"
      ? `All mandatory conditions met. Release ${truck.code} to ${dock?.code} for ${hhmm(windowStart, tz)}.`
      : `${outcome}: ${failing.map((c) => c.reason).join(" | ")}`;
  const summaryAr =
    outcome === "READY"
      ? `جميع الشروط الإلزامية متحققة. يمكن استدعاء ${truck.code} إلى ${dock?.code} عند ${hhmm(windowStart, tz)}.`
      : `${outcome}: ${failing.map((c) => c.reasonAr).join(" | ")}`;

  return {
    truckId: truck.id,
    outcome,
    proposedCallTime: proposedCallTime.toISOString(),
    expectedDockArrival: dockArrival.toISOString(),
    evaluatedAt,
    engineVersion: READINESS_ENGINE_VERSION,
    checks,
    nextReevaluationAt,
    affectedResources: affected,
    alternatives,
    summary,
    summaryAr,
    plan,
    inputSnapshot: {
      truck: { id: truck.id, code: truck.code, status: truck.status, vehicleType: truck.vehicleType, assignedDockId: truck.assignedDockId, actualArrival: iso(truck.actualArrival), serviceEstimateMin: truck.serviceEstimateMin, serviceEstimateSource: truck.serviceEstimateSource },
      shipment: { id: truck.shipment.id, cargoType: truck.shipment.cargoType, handlingMethod: truck.shipment.handlingMethod, palletCount: truck.shipment.palletCount, documentsComplete: truck.shipment.documentsComplete, inspectionRequired: truck.shipment.inspectionRequired, qualityStatus: qs },
      dock: dock ? { id: dock.id, code: dock.code, status: dock.status, maxVehicleType: dock.maxVehicleType, features: dock.features } : null,
      facility: { yardCapacity: yardCap, gateCapacityPerHour: snap.facility.gateCapacityPerHour, travelTimeMin: snap.facility.travelTimeMin, stateVersion: snap.facility.stateVersion },
      reservationsConsidered: snap.reservations.length,
      serviceWindowMin: serviceMin,
      requiredSkills: skills,
      requiredEquipment: eqType,
      takenAt: snap.takenAt.toISOString(),
    },
  };
}
