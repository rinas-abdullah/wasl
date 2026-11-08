"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Power, PowerOff, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";

export default function DocksPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["docks"], queryFn: () => api.get<AnyRec[]>("/api/docks") });
  const [dialog, setDialog] = useState<{ dock: AnyRec; status: "OUT_OF_SERVICE" | "MAINTENANCE" | "AVAILABLE" } | null>(null);
  const [until, setUntil] = useState("");
  const [lastResult, setLastResult] = useState<AnyRec | null>(null);

  const mut = useMutation({
    mutationFn: ({ reason }: { reason: string }) => api.patch<AnyRec>(`/api/docks/${dialog!.dock.id}/status`, { status: dialog!.status, reason, until: until ? new Date(until).toISOString() : null }),
    onSuccess: (r) => {
      setLastResult(r);
      toast.success(dialog!.status === "AVAILABLE" ? t("أعيد الرصيف للخدمة", "Dock restored") : t(`تم تحديث الرصيف — ${r.affectedTrucks.length + r.inServiceTrucks.length} شاحنة متأثرة، وطُلب مقترح إعادة جدولة`, `Dock updated — ${r.affectedTrucks.length + r.inServiceTrucks.length} trucks affected; a re-plan proposal was requested`));
      setDialog(null);
      setUntil("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;

  return (
    <>
      <PageHeader title={t("مركز التحكم بالأرصفة", "Dock control center")} description={t("تعطيل رصيف يغيّر حالته في قاعدة البيانات، ويمنع أي تخصيص جديد عليه، ويحدد الشاحنات المتأثرة ويلغي استدعاءاتها، وينشئ حدثًا وتنبيهًا، ويطلب خطة إعادة جدولة من محرك التحسين — ثم تتحدث كل الواجهات.", "Disabling a dock updates it in the database, blocks new assignments, identifies affected trucks and revokes their releases, records an event and an alert, and requests a re-plan from the optimiser — every screen then updates.")} />
      {lastResult && (lastResult.affectedTrucks.length || lastResult.inServiceTrucks.length) ? (
        <Card className="mb-4 border-warn/40 bg-warn-bg/40 px-5 py-3.5 text-[13px]">
          <p className="font-semibold text-warn">{t(`الشاحنات المتأثرة بتعطل ${lastResult.dock.code}`, `Trucks affected by ${lastResult.dock.code}`)}</p>
          <p className="mt-1">{lastResult.affectedTrucks.map((x: AnyRec) => <span key={x.id} className="me-3"><TruckLink id={x.id} code={x.code} /> → {label("truckStatus", x.status, locale)}</span>)}{lastResult.inServiceTrucks.map((x: AnyRec) => <span key={x.id} className="me-3"><TruckLink id={x.id} code={x.code} /> ({t("قيد الخدمة — قرار مشرف مطلوب", "in service — supervisor decision required")})</span>)}</p>
          <Link href="/optimization" className="mt-1.5 inline-block font-medium text-teal-700 hover:underline">{t("مراجعة مقترح إعادة التخطيط", "Review the re-plan proposal")} →</Link>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data!.map((d) => {
          const down = d.status !== "AVAILABLE";
          return (
            <Card key={d.id}>
              <CardHeader
                title={<span className="flex items-center gap-2"><span className="num">{d.code}</span><span className="text-[12.5px] font-normal text-muted">{d.name}</span></span>}
                actions={<StatusBadge group="dockStatus" value={d.effectiveStatus} />}
              />
              <CardBody className="space-y-4">
                <KeyValue cols={3} items={[
                  { k: t("أقصى مركبة", "Max vehicle"), v: label("vehicle", d.maxVehicleType, locale) },
                  { k: t("المزايا", "Features"), v: d.features.join(", ") || "—" },
                  { k: t("الحمولات المعتمدة", "Certified cargo"), v: d.compatibleCargo.map((c: string) => label("cargo", c, locale)).join("، ") },
                  { k: t("الحالة الإدارية", "Admin status"), v: <StatusBadge group="dockStatus" value={d.status} /> },
                  { k: t("حمل العمل المجدول", "Scheduled workload"), v: <span className="num">{d.scheduledWorkloadMin} {t("د", "min")}</span> },
                  { k: t("متاح تقديريًا", "Est. available"), v: <span className="num">{d.estimatedAvailableAt ? f.time(d.estimatedAvailableAt) : t("غير محدد", "Unknown")}</span> },
                ]} />
                {d.statusReason && down ? <p className="rounded-lg bg-bad-bg px-3 py-2 text-[12.5px] text-bad">{d.statusReason}{d.statusUntil ? ` · ${t("حتى", "until")} ${f.dateTime(d.statusUntil)}` : ""}</p> : null}
                {d.restrictions ? <p className="text-[12px] text-muted">{t("قيود تشغيلية", "Restrictions")}: {d.restrictions}</p> : null}
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("التخصيصات", "Assignments")}</p>
                  {d.assignedTrucks.length ? (
                    <div className="flex flex-wrap gap-1.5">{d.assignedTrucks.map((x: AnyRec) => <span key={x.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 text-[12px]"><TruckLink id={x.id} code={x.code} /><StatusBadge group="truckStatus" value={x.status} />{x.confirmedStart ? <span className="num text-muted">{f.time(x.confirmedStart)}</span> : null}{x.reassignmentRequired ? <Badge tone="bad">{t("تعارض", "Conflict")}</Badge> : null}</span>)}</div>
                  ) : <p className="text-[12px] text-muted">{t("لا توجد شاحنات مخصصة", "No assigned trucks")}</p>}
                </div>
                {can("docks:manage") ? (
                  <div className="flex flex-wrap gap-2 border-t border-line-2 pt-3">
                    {down ? <Button size="sm" variant="teal" onClick={() => setDialog({ dock: d, status: "AVAILABLE" })}><Power />{t("إعادة للخدمة", "Restore dock")}</Button> : (
                      <>
                        <Button size="sm" variant="dangerOutline" onClick={() => setDialog({ dock: d, status: "OUT_OF_SERVICE" })}><PowerOff />{t("تعطيل الرصيف", "Disable dock")}</Button>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ dock: d, status: "MAINTENANCE" })}><Wrench />{t("جدولة صيانة", "Schedule maintenance")}</Button>
                      </>
                    )}
                    <Link href={`/schedule?dock=${d.id}`}><Button size="sm" variant="ghost">{t("عرض الجدول", "View schedule")}</Button></Link>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog ? (dialog.status === "AVAILABLE" ? t(`إعادة ${dialog.dock.code} للخدمة`, `Restore ${dialog.dock.code}`) : dialog.status === "MAINTENANCE" ? t(`صيانة ${dialog.dock.code}`, `Maintenance on ${dialog.dock.code}`) : t(`تعطيل ${dialog.dock.code}`, `Disable ${dialog.dock.code}`)) : ""}
        description={dialog?.status === "AVAILABLE" ? t("سيعود الرصيف متاحًا للتخصيص، ويمكن استدعاء الشاحنات المخصصة له بعد إعادة تقييم الجاهزية.", "The dock becomes assignable again; assigned trucks can be released after a readiness re-evaluation.") : t(`ستُلغى استدعاءات الشاحنات المخصصة لهذا الرصيف (${dialog?.dock.assignedTrucks.length ?? 0}) وتُوضع علامة إعادة تخصيص، ويُطلب مقترح تحسين جديد.`, `Releases of trucks assigned to this dock (${dialog?.dock.assignedTrucks.length ?? 0}) will be revoked and flagged for reassignment, and a new optimisation proposal requested.`)}
        confirmLabel={t("تأكيد", "Confirm")}
        tone={dialog?.status === "AVAILABLE" ? "teal" : "danger"}
        requireReason
        loading={mut.isPending}
        onConfirm={(reason) => mut.mutate({ reason })}
      >
        {dialog?.status === "MAINTENANCE" ? <Field label={t("نهاية الصيانة المخططة (اختياري)", "Planned end (optional)")} htmlFor="until" className="mb-3"><Input id="until" type="datetime-local" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} /></Field> : null}
      </ConfirmDialog>
    </>
  );
}
