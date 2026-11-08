"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { QUALITY_STATUSES, QUALITY_TRANSITIONS, type QualityAction } from "@wasl/shared";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan, useSession } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, Drawer, EmptyState, ErrorState, Field, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";

const ACTION_LABEL: Record<QualityAction, [string, string]> = {
  START_REVIEW: ["بدء المراجعة وتعيين نفسي مفتشًا", "Start review (assign me as inspector)"],
  RELEASE: ["إفراج بواسطة مخوّل", "Release (authorised)"],
  ESCALATE: ["تصعيد", "Escalate"],
  PLACE_HOLD: ["إيقاف", "Place on hold"],
  REOPEN: ["إعادة فتح", "Reopen"],
};

function QualityInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const session = useSession();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(sp.get("review"));
  const [act, setAct] = useState<QualityAction | null>(null);
  const [notes, setNotes] = useState("");
  const list = useQuery({ queryKey: ["quality", "list", status], queryFn: () => api.get<AnyRec[]>(`/api/quality/reviews${status ? `?status=${status}` : ""}`) });
  const detail = useQuery({ queryKey: ["quality", "detail", open], queryFn: () => api.get<AnyRec>(`/api/quality/reviews/${open}`), enabled: !!open });
  const mut = useMutation({
    mutationFn: () => api.post<AnyRec>(`/api/quality/reviews/${open}/actions`, { action: act, version: detail.data!.version, notes: notes || null }),
    onSuccess: (r) => {
      toast.success(t(`الحالة الآن: ${label("quality", r.status, "ar")} — أعيد تقييم جاهزية الشاحنة`, `Status: ${label("quality", r.status, "en")} — truck readiness re-evaluated`));
      setAct(null);
      setNotes("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = detail.data;
  const allowed = d ? (Object.keys(QUALITY_TRANSITIONS) as QualityAction[]).filter((a) => QUALITY_TRANSITIONS[a].from.includes(d.status) && QUALITY_TRANSITIONS[a].roles.includes(session.role)) : [];

  return (
    <>
      <PageHeader title={t("إدارة جودة الشحنات", "Shipment quality management")} description={t("مراجعات الجودة تؤثر مباشرة في محرك الجاهزية والتحسين: «مراجعة مطلوبة» تمنع الاستدعاء حتى يبدأ مسؤول الجودة المراجعة، و«موقوفة/مصعّدة» تستبعد الشحنة من التخطيط.", "Quality reviews directly affect readiness and optimisation: REVIEW_REQUIRED blocks release until a quality officer starts the review; HOLD/ESCALATED excludes the shipment from planning.")} badges={<SyntheticBadge kind="synthetic" />} />
      <Card className="mb-4 flex items-start gap-3 border-info/30 bg-info-bg/50 px-5 py-3 text-[12.5px] leading-relaxed text-info">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>{t("عدم وجود تجاوز في سجل الحساسات الافتراضية لا يعني إثبات سلامة المنتج. الحساسات في وَصل افتراضية بالكامل ولا تُستخدم للحكم النهائي على شحنة حقيقية؛ القرار يعود لمستخدم مخوّل وفق قواعد السيناريو.", "The absence of an excursion in the virtual sensor record does not prove product safety. WASL sensors are entirely virtual and are never used as the final judgement on a real shipment; the decision belongs to an authorised user under the scenario rules.")}</p>
      </Card>
      <Card>
        <CardHeader title={t("سجلات الجودة", "Quality records")} actions={<Select className="h-8 w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("الحالة", "Status")}><option value="">{t("كل الحالات", "All statuses")}</option>{QUALITY_STATUSES.map((s) => <option key={s} value={s}>{label("quality", s, locale)}</option>)}</Select>} />
        {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorState error={list.error} /> : !list.data?.length ? <EmptyState title={t("لا توجد مراجعات", "No reviews")} description={t("ولّد سيناريو حساس افتراضي لإنشاء حالة جودة.", "Generate a virtual sensor scenario to create a quality case.")} action={<Link href="/sensors"><Button variant="outline">{t("الحساسات الافتراضية", "Virtual sensors")}</Button></Link>} /> : (
          <Table>
            <thead><tr><Th>{t("الشحنة", "Shipment")}</Th><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الحمولة", "Cargo")}</Th><Th>{t("السبب", "Trigger")}</Th><Th>{t("المخالفات", "Violations")}</Th><Th>{t("المفتش", "Inspector")}</Th><Th>{t("الحالة", "Status")}</Th><Th>{t("آخر تحديث", "Updated")}</Th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => setOpen(r.id)}>
                  <Td className="num font-medium">{r.shipment.reference}</Td>
                  <Td>{r.truck ? <TruckLink id={r.truck.id} code={r.truck.code} /> : "—"}</Td>
                  <Td>{label("cargo", r.shipment.cargoType, locale)}</Td>
                  <Td><Badge tone="neutral">{r.trigger}</Badge></Td>
                  <Td className="max-w-xs text-[12px] text-ink-2"><span className="line-clamp-1">{(r.violations as AnyRec[]).map((v) => (locale === "ar" ? v.descriptionAr : v.description)).join(" · ") || (r.missingData ? t("بيانات مفقودة", "Missing data") : "—")}</span></Td>
                  <Td className="text-[12px]">{r.inspector?.name ?? "—"}</Td>
                  <Td><StatusBadge group="quality" value={r.status} /></Td>
                  <Td className="num text-muted">{f.dateTime(r.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={d ? t(`مراجعة ${d.shipment.reference}`, `Review ${d.shipment.reference}`) : t("مراجعة جودة", "Quality review")} actions={d ? <StatusBadge group="quality" value={d.status} /> : null}>
        {detail.isLoading ? <LoadingBlock /> : d ? (
          <div className="space-y-5">
            <KeyValue items={[
              { k: t("الشحنة", "Shipment ID"), v: <span className="num">{d.shipment.reference}</span> },
              { k: t("الشاحنة", "Truck"), v: d.truck ? <TruckLink id={d.truck.id} code={d.truck.code} /> : "—" },
              { k: t("نوع الحمولة", "Cargo type"), v: label("cargo", d.shipment.cargoType, locale) },
              { k: t("الظروف المطلوبة", "Required conditions"), v: <span className="num">{Object.entries(d.shipment.requiredConditions ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || t("افتراضية حسب الحمولة", "Cargo defaults")}</span> },
              { k: t("متطلب الفحص", "Inspection"), v: d.inspectionRequired ? t("مطلوب", "Required") : t("غير مطلوب", "Not required") },
              { k: t("بيانات مفقودة", "Missing data"), v: d.missingData ? t("نعم", "Yes") : t("لا", "No") },
              { k: t("القرار", "Decision"), v: d.decision ?? "—" },
              { k: t("تاريخ القرار", "Decided"), v: <span className="num">{f.dateTime(d.decidedAt)}</span> },
            ]} />
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("أحداث الحساس الافتراضي", "Virtual sensor events")}</p>
              {d.sensorEvents.length ? (
                <ul className="space-y-1.5">{d.sensorEvents.map((e: AnyRec) => <li key={e.id} className="rounded-lg border border-line-2 px-3 py-2 text-[12.5px]"><div className="flex items-center justify-between"><span className="font-medium">{label("sensorEvent", e.type, locale)}</span><StatusBadge group="severity" value={e.severity} /></div><p className="num mt-0.5 text-[11.5px] text-muted">{e.ruleId} · {f.time(e.startedAt)}–{f.time(e.endedAt)} · {t("الذروة", "peak")} {e.peakValue ?? "—"} / {t("الحد", "limit")} {e.threshold ?? "—"}</p></li>)}</ul>
              ) : <p className="text-[12px] text-muted">{t("لا توجد أحداث حساس مرتبطة", "No linked sensor events")}</p>}
              <Link href={`/sensors?shipment=${d.shipmentId}`} className="mt-1.5 inline-block text-[12px] font-medium text-teal-700 hover:underline">{t("عرض السلسلة الزمنية", "View time series")} →</Link>
            </div>
            {can("quality:review") && allowed.length ? (
              <div className="flex flex-wrap gap-2 border-t border-line-2 pt-4">{allowed.map((a) => <Button key={a} size="sm" variant={a === "RELEASE" ? "teal" : a === "PLACE_HOLD" || a === "ESCALATE" ? "dangerOutline" : "outline"} onClick={() => setAct(a)}>{locale === "ar" ? ACTION_LABEL[a][0] : ACTION_LABEL[a][1]}</Button>)}</div>
            ) : <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">{t("إجراءات الجودة متاحة لمسؤول الجودة المخوّل فقط (يُتحقق على الخادم).", "Quality actions are available to authorised quality officers only (enforced server-side).")}</p>}
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("سجل التدقيق", "Audit trail")}</p>
              <ol className="space-y-1.5 text-[12px]">{(d.history as AnyRec[]).slice().reverse().map((h, i) => <li key={i} className="rounded-lg bg-canvas px-3 py-2"><span className="num text-muted">{f.dateTime(h.at)}</span> · {h.actor} · <span className="font-medium">{h.from ?? "∅"} → {h.to}</span>{h.notes ? <p className="mt-0.5 text-ink-2">{h.notes}</p> : null}</li>)}</ol>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Dialog open={!!act} onOpenChange={(o) => !o && setAct(null)} title={act ? (locale === "ar" ? ACTION_LABEL[act][0] : ACTION_LABEL[act][1]) : ""} description={act === "RELEASE" ? t("إفراج الجودة قرار مسؤول مخوّل ويُسجّل باسمك. لا يُصدر استدعاءً تلقائيًا — يُعاد تقييم الجاهزية فقط.", "A quality release is an authorised decision recorded under your name. It does not call the truck — readiness is re-evaluated only.") : undefined} footer={<><Button variant="outline" onClick={() => setAct(null)}>{t("إلغاء", "Cancel")}</Button><Button loading={mut.isPending} disabled={!!act && QUALITY_TRANSITIONS[act].notesRequired && notes.trim().length < 5} onClick={() => mut.mutate()}>{t("تأكيد", "Confirm")}</Button></>}>
        <Field label={act && QUALITY_TRANSITIONS[act].notesRequired ? t("ملاحظات القرار (إلزامية)", "Decision notes (required)") : t("ملاحظات (اختيارية)", "Notes (optional)")} htmlFor="qn"><Textarea id="qn" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

export default function QualityPage() {
  return (
    <Suspense>
      <QualityInner />
    </Suspense>
  );
}
