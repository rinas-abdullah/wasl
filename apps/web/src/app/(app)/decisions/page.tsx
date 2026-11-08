"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge } from "@/components/ui";
import { EventTimeline, OutcomeBanner, ReadinessChecklist, TruckLink, type AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

function DecisionsInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const sp = useSearchParams();
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<string | null>(sp.get("id"));
  const list = useQuery({ queryKey: ["decisions", "list", status], queryFn: () => api.get<AnyRec[]>(`/api/decisions${status ? `?status=${status}` : ""}`) });
  const current = sel ?? list.data?.[0]?.id ?? null;
  const d = useQuery({ queryKey: ["decisions", "detail", current], queryFn: () => api.get<AnyRec>(`/api/decisions/${current}`), enabled: !!current });
  const x = d.data;
  return (
    <>
      <PageHeader title={t("مركز القرارات القابلة للتفسير", "Explainable decision center")} description={t("كل قرار استدعاء أو تأجيل أو إعادة تخصيص أو اعتماد خطة مع لقطة المدخلات والشروط والبدائل والأثر وحالة الاعتماد ونتيجة التنفيذ. التفسيرات مأخوذة حرفيًا من نتائج محرك القواعد أو المحلل — لا يوجد نموذج لغوي يولّد أسبابًا.", "Every release, hold, reassignment or plan approval with its input snapshot, constraints, alternatives, impact, approval status and execution result. Explanations are taken verbatim from the rules engine or solver — no language model generates reasons.")} />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <CardHeader title={t("القرارات", "Decisions")} actions={<Select className="h-8 w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("الحالة", "Status")}><option value="">{t("الكل", "All")}</option>{["PENDING_REVIEW", "EXECUTED", "SUPERSEDED"].map((s) => <option key={s} value={s}>{label("decisionStatus", s, locale)}</option>)}</Select>} />
          {list.isLoading ? <LoadingBlock /> : !list.data?.length ? <EmptyState title={t("لا قرارات", "No decisions")} /> : (
            <ul className="scroll-thin max-h-[720px] divide-y divide-line-2 overflow-y-auto">{list.data.map((y) => (
              <li key={y.id}><button onClick={() => setSel(y.id)} className={cn("w-full px-4 py-3 text-start hover:bg-canvas", current === y.id && "bg-teal-50/60")}>
                <div className="flex items-center justify-between gap-2"><span className="text-[12.5px] font-medium">{y.truckCode ? <span className="num text-navy-700">{y.truckCode} · </span> : null}{label("decisionType", y.type, locale)}</span><StatusBadge group="decisionStatus" value={y.status} /></div>
                <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted">{(y.reasons ?? []).map((r: AnyRec) => (locale === "ar" ? r.ar : r.en)).join(" · ")}</p>
                <p className="num text-[11px] text-muted">{f.dateTime(y.createdAt)}</p>
              </button></li>
            ))}</ul>
          )}
        </Card>
        {!current ? <Card><EmptyState title={t("اختر قرارًا", "Select a decision")} /></Card> : d.isLoading ? <Card><LoadingBlock rows={8} /></Card> : d.error ? <Card><ErrorState error={d.error} /></Card> : x ? (
          <div className="space-y-4">
            <Card>
              <CardHeader title={<span>{x.truckCode ? <TruckLink id={x.truckId} code={x.truckCode} /> : null} {label("decisionType", x.type, locale)}</span>} subtitle={<span className="num">{x.id}</span>} actions={<StatusBadge group="decisionStatus" value={x.status} />} />
              <CardBody className="space-y-4">
                {x.outcome ? <OutcomeBanner outcome={x.outcome} summary={x.evaluation?.result?.summary} summaryAr={x.evaluation?.result?.summaryAr} /> : null}
                <KeyValue cols={3} items={[
                  { k: t("وقت القرار", "Decision time"), v: <span className="num">{f.dateTime(x.createdAt)}</span> },
                  { k: t("حالة الاعتماد", "Approval status"), v: label("decisionStatus", x.status, locale) },
                  { k: t("حُسم في", "Resolved"), v: <span className="num">{f.dateTime(x.resolvedAt)}</span> },
                  { k: t("بواسطة", "By"), v: x.actorName ?? "—" },
                  { k: t("شروط متجاوزة", "Overridden checks"), v: x.overriddenChecks?.length ? x.overriddenChecks.join(", ") : "—" },
                  { k: t("سبب التجاوز", "Override reason"), v: x.overrideReason ?? "—" },
                ]} />
                <div><p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("الأسباب", "Reasons")}</p><ul className="space-y-1">{(x.reasons ?? []).map((r: AnyRec, i: number) => <li key={i} className="flex gap-2 text-[13px]"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500" />{locale === "ar" ? r.ar : r.en}</li>)}</ul></div>
                {x.suggestedAction ? <p className="rounded-lg bg-teal-50 px-3 py-2 text-[12.5px] text-teal-700">{t("الإجراء المقترح", "Suggested action")}: {locale === "ar" ? x.suggestedAction.ar : x.suggestedAction.en}</p> : null}
                {x.alternatives?.length ? <div><p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("البدائل", "Alternatives")}</p><div className="flex flex-wrap gap-1.5">{x.alternatives.map((a: AnyRec) => <Badge key={a.dockId} tone="info"><span className="num">{a.dockCode} · {f.time(a.earliestStart)}</span></Badge>)}</div></div> : null}
                {x.executionResult ? <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("نتيجة التنفيذ", "Execution result")}</p><pre className="num rounded-lg bg-canvas p-3 text-start text-[11px]" dir="ltr">{JSON.stringify(x.executionResult, null, 2)}</pre></div> : null}
                {x.impact && Object.keys(x.impact).length ? <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("تقدير الأثر", "Impact estimate")}</p><pre className="num rounded-lg bg-canvas p-3 text-start text-[11px]" dir="ltr">{JSON.stringify(x.impact, null, 2)}</pre></div> : null}
                {x.optimizationRun ? <Link href={`/optimization?run=${x.optimizationRun.id}`} className="inline-block text-[12.5px] font-medium text-teal-700 hover:underline">{t("فتح تشغيل التحسين المرتبط", "Open the linked optimisation run")} →</Link> : null}
              </CardBody>
            </Card>
            {x.evaluation?.checks?.length ? (
              <Card><CardHeader title={t("القيود والشروط المقيّمة", "Evaluated constraints")} subtitle={<span className="num">{x.evaluation.engineVersion}</span>} /><CardBody><ReadinessChecklist checks={x.evaluation.checks} /></CardBody></Card>
            ) : null}
            {x.evaluation?.inputSnapshot ? (
              <Card><CardHeader title={t("لقطة المدخلات", "Input snapshot")} /><CardBody><pre className="num scroll-thin max-h-72 overflow-auto rounded-lg bg-navy-950 p-3 text-start text-[11px] leading-relaxed text-[#cfe6f3]" dir="ltr">{JSON.stringify(x.evaluation.inputSnapshot, null, 2)}</pre></CardBody></Card>
            ) : null}
            {x.relatedEvents?.length ? <Card><CardHeader title={t("الأحداث المرتبطة", "Related events")} /><CardBody><EventTimeline events={x.relatedEvents} /></CardBody></Card> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function DecisionsPage() {
  return (
    <Suspense>
      <DecisionsInner />
    </Suspense>
  );
}
