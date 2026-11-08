"use client";
/* Shared domain components: event timeline, dock card, readiness checklist, decision panel. */
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle, XCircle } from "lucide-react";
import { READINESS_CHECKS, type ReadinessCheck, type ReadinessCheckId } from "@wasl/shared";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Badge, StatusBadge } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyRec = Record<string, any>;

const EVENT_TONE: Record<string, string> = {
  DOCK_FAILED: "bg-bad",
  DOCK_MAINTENANCE_SCHEDULED: "bg-warn",
  RESOURCE_UNAVAILABLE: "bg-bad",
  QUALITY_ALERT_CREATED: "bg-warn",
  TRUCK_RELEASED: "bg-teal-500",
  PLAN_APPROVED: "bg-teal-500",
  RELEASE_OVERRIDDEN: "bg-warn",
  OPTIMIZATION_FAILED: "bg-bad",
  TRUCK_DEPARTED: "bg-navy-600",
  SERVICE_STARTED: "bg-ok",
  SERVICE_COMPLETED: "bg-ok",
};

export const EVENT_LABELS: Record<string, [string, string]> = {
  TRUCK_CREATED: ["تسجيل شاحنة", "Truck registered"],
  TRUCK_UPDATED: ["تعديل شاحنة", "Truck updated"],
  TRUCK_CANCELLED: ["إلغاء شاحنة", "Truck cancelled"],
  TRUCK_STATUS_CHANGED: ["تغيير حالة شاحنة", "Truck status changed"],
  APPOINTMENT_SCHEDULED: ["تأكيد موعد", "Appointment confirmed"],
  APPOINTMENT_RESCHEDULED: ["إعادة جدولة موعد", "Appointment rescheduled"],
  DOCK_FAILED: ["تعطل رصيف", "Dock failed"],
  DOCK_RESTORED: ["استعادة رصيف", "Dock restored"],
  DOCK_MAINTENANCE_SCHEDULED: ["صيانة رصيف", "Dock maintenance"],
  RESOURCE_UNAVAILABLE: ["مورد غير متاح", "Resource unavailable"],
  RESOURCE_RESTORED: ["استعادة مورد", "Resource restored"],
  READINESS_EVALUATED: ["تقييم الجاهزية", "Readiness evaluated"],
  OPTIMIZATION_REQUESTED: ["طلب تحسين", "Optimization requested"],
  OPTIMIZATION_COMPLETED: ["اكتمال التحسين", "Optimization completed"],
  OPTIMIZATION_FAILED: ["فشل التحسين", "Optimization failed"],
  PLAN_APPROVED: ["اعتماد خطة", "Plan approved"],
  PLAN_REJECTED: ["رفض خطة", "Plan rejected"],
  TRUCK_RELEASED: ["استدعاء شاحنة", "Truck called"],
  RELEASE_OVERRIDDEN: ["تجاوز إداري", "Release override"],
  TRUCK_ARRIVED: ["وصول شاحنة", "Truck arrived"],
  SERVICE_STARTED: ["بدء التفريغ", "Unloading started"],
  SERVICE_COMPLETED: ["اكتمال التفريغ", "Unloading completed"],
  QUALITY_ALERT_CREATED: ["طلب مراجعة جودة", "Quality review requested"],
  QUALITY_REVIEW_UPDATED: ["تحديث مراجعة جودة", "Quality review updated"],
  SENSOR_SCENARIO_GENERATED: ["توليد سيناريو حساس", "Sensor scenario generated"],
  HANDOVER_ACTION_RECORDED: ["إجراء استلام", "Handover action"],
  HANDOVER_APPROVED: ["اعتماد الاستلام", "Handover approved"],
  TRUCK_DEPARTED: ["مغادرة شاحنة", "Truck departed"],
  SIMULATION_COMPLETED: ["اكتمال محاكاة", "Simulation completed"],
  USER_CREATED: ["إنشاء مستخدم", "User created"],
  USER_ROLE_CHANGED: ["تغيير دور", "Role changed"],
  SETTINGS_UPDATED: ["تحديث إعدادات", "Settings updated"],
  DEMO_RESET: ["إعادة ضبط التجربة", "Demo reset"],
  AUTH_LOGIN: ["تسجيل دخول", "Sign-in"],
};

export function eventLabel(type: string, locale: "ar" | "en") {
  const e = EVENT_LABELS[type];
  return e ? (locale === "ar" ? e[0] : e[1]) : type;
}

export function EventTimeline({ events, compact }: { events: AnyRec[]; compact?: boolean }) {
  const f = useFormat();
  const locale = useLocale();
  return (
    <ol className="relative space-y-0">
      {events.map((e, i) => (
        <li key={e.id ?? i} className="relative flex gap-3 pb-3.5 last:pb-0">
          {i < events.length - 1 ? <span className="absolute start-[5px] top-3 h-full w-px bg-line" aria-hidden /> : null}
          <span className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-surface", EVENT_TONE[e.eventType] ?? "bg-line")} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13px] font-medium text-ink">
                {eventLabel(e.eventType, locale)}
                {e.entityLabel ? <>{" "}<span className="num font-semibold text-navy-700">{e.entityLabel}</span></> : null}
              </p>
              <time className="num text-[11.5px] text-muted" dateTime={e.occurredAt}>{f.time(e.occurredAt)}</time>
            </div>
            {!compact ? (
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                {e.actorLabel} · {e.source}
                {e.newState?.status ? <> · <span className="text-ink-2">{String(e.previousState?.status ?? "∅")} → {String(e.newState.status)}</span></> : null}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const resultIcon = { PASS: CheckCircle2, FAIL: XCircle, WARN: AlertTriangle, NOT_APPLICABLE: MinusCircle } as const;
const resultCls = { PASS: "text-ok", FAIL: "text-bad", WARN: "text-warn", NOT_APPLICABLE: "text-muted" } as const;

/** Readiness checklist — renders engine output verbatim (no client-side re-interpretation). */
export function ReadinessChecklist({ checks, selectable, selected, onToggle }: { checks: ReadinessCheck[]; selectable?: boolean; selected?: string[]; onToggle?: (id: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const order = { FAIL: 0, WARN: 1, PASS: 2, NOT_APPLICABLE: 3 };
  return (
    <ul className="divide-y divide-line-2">
      {[...checks].sort((a, b) => order[a.result] - order[b.result]).map((c) => {
        const Icon = resultIcon[c.result];
        const canOverride = selectable && c.result === "FAIL" && c.blocking && READINESS_CHECKS[c.checkId as ReadinessCheckId]?.overridable;
        return (
          <li key={c.checkId} className="flex gap-3 py-3">
            <Icon className={cn("mt-0.5 size-[18px] shrink-0", resultCls[c.result])} aria-label={c.result} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-ink">{label("check", c.checkId, locale)}</span>
                <code className="num rounded bg-line-2 px-1 text-[10.5px] text-muted">{c.checkId}</code>
                {c.blocking ? <Badge tone="neutral">{t("إلزامي", "Blocking")}</Badge> : <Badge tone="info">{t("استشاري", "Advisory")}</Badge>}
                {c.result === "FAIL" && c.blocking ? (READINESS_CHECKS[c.checkId as ReadinessCheckId]?.overridable ? <Badge tone="warn">{t("قابل للتجاوز بسبب موثق", "Overridable with reason")}</Badge> : <Badge tone="bad">{t("غير قابل للتجاوز", "Not overridable")}</Badge>) : null}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{locale === "ar" ? c.reasonAr : c.reason}</p>
              {c.suggestedAction ? <p className="mt-1 text-[12px] text-teal-700">↳ {locale === "ar" ? c.suggestedActionAr : c.suggestedAction}</p> : null}
              <p className="mt-1 text-[11px] text-muted">
                {t("مصدر الدليل", "Evidence")}: <code className="num">{c.evidenceSource}</code> · {f.time(c.evaluatedAt)}
                {c.expectedClearAt ? <> · {t("متوقع زوال المانع", "Expected to clear")} <span className="num">{f.time(c.expectedClearAt)}</span></> : null}
              </p>
            </div>
            {canOverride ? (
              <label className="flex shrink-0 items-start gap-1.5 text-[11.5px] text-ink-2">
                <input type="checkbox" checked={selected?.includes(c.checkId)} onChange={() => onToggle?.(c.checkId)} className="mt-0.5 size-4 accent-[var(--color-warn)]" />
                {t("تجاوز", "Override")}
              </label>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function OutcomeBanner({ outcome, summary, summaryAr }: { outcome: string; summary?: string; summaryAr?: string }) {
  const locale = useLocale();
  const tone = outcome === "READY" ? "border-ok/30 bg-ok-bg text-ok" : outcome === "HOLD" ? "border-warn/30 bg-warn-bg text-warn" : "border-bad/30 bg-bad-bg text-bad";
  const Icon = outcome === "READY" ? CheckCircle2 : outcome === "HOLD" ? CircleDashed : XCircle;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", tone)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label("outcome", outcome, locale)}</p>
        {summary ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{locale === "ar" ? summaryAr : summary}</p> : null}
      </div>
    </div>
  );
}

export function TruckLink({ id, code }: { id: string; code: string }) {
  return <Link href={`/trucks/${id}`} className="num whitespace-nowrap font-semibold text-navy-700 hover:text-teal-700 hover:underline">{code}</Link>;
}

export function DockCard({ dock, onClick }: { dock: AnyRec; onClick?: () => void }) {
  const t = useT();
  const f = useFormat();
  const status = dock.effectiveStatus ?? dock.status;
  const bar = { AVAILABLE: "bg-ok", OCCUPIED: "bg-info", RESERVED: "bg-teal-500", OUT_OF_SERVICE: "bg-bad", MAINTENANCE: "bg-warn" }[status as string] ?? "bg-line";
  return (
    <button onClick={onClick} className="group relative w-full overflow-hidden rounded-xl border border-line bg-surface p-3.5 text-start transition-colors hover:border-teal-500/60">
      <span className={cn("absolute inset-y-0 start-0 w-1", bar)} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-[15px] font-semibold text-navy-900">{dock.code}</p>
          <p className="truncate text-[11px] text-muted" title={(dock.features ?? []).join(" · ")}>{(dock.features ?? []).join(" · ") || "—"}</p>
        </div>
        <StatusBadge group="dockStatus" value={status} className="shrink-0" />
      </div>
      <p className="mt-2.5 text-[12px] text-ink-2">
        {dock.currentTruck ? <>{t("الخدمة", "Serving")} <span className="num font-semibold">{dock.currentTruck.code}</span> · {t("الانتهاء المتوقع", "ETA")} <span className="num">{f.time(dock.currentTruck.estimatedCompletion)}</span></> : dock.statusReason && (status === "OUT_OF_SERVICE" || status === "MAINTENANCE") ? <span className="text-bad">{dock.statusReason}</span> : t("لا توجد خدمة جارية", "No active service")}
      </p>
    </button>
  );
}
