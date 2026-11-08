"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Pencil, ShieldCheck } from "lucide-react";
import { availableActions, type TruckAction } from "@wasl/shared";
import { api, newIdempotencyKey } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Table, Td, Textarea } from "@/components/ui";
import { EventTimeline, OutcomeBanner, type AnyRec } from "@/components/domain";

const REASON_REQUIRED: TruckAction[] = ["UNSCHEDULE", "CANCEL", "MARK_NO_SHOW", "RAISE_EXCEPTION", "RESOLVE_EXCEPTION"];
const DANGER: TruckAction[] = ["CANCEL", "MARK_NO_SHOW", "RAISE_EXCEPTION"];

export default function TruckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [action, setAction] = useState<TruckAction | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const q = useQuery({ queryKey: ["trucks", "detail", id], queryFn: () => api.get<AnyRec>(`/api/trucks/${id}`) });

  const transition = useMutation({
    mutationFn: ({ a, reason }: { a: TruckAction; reason: string }) => api.post<AnyRec>(`/api/trucks/${id}/transitions`, { action: a, version: q.data!.version, reason: reason || null }, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (r) => {
      toast.success(t(`الحالة الآن: ${label("truckStatus", r.status, "ar")}`, `Status is now ${label("truckStatus", r.status, "en")}`));
      setAction(null);
      qc.invalidateQueries({ queryKey: ["trucks"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <Card><LoadingBlock rows={10} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const tr = q.data!;
  const appt = tr.appointments.find((a: AnyRec) => ["REQUESTED", "PROPOSED", "CONFIRMED"].includes(a.status)) ?? tr.appointments[0];
  const actions = availableActions(tr.status).filter((a) => a !== "RELEASE" && a !== "SCHEDULE");
  const releasable = ["SCHEDULED", "WAITING"].includes(tr.status);
  const ev = tr.latestEvaluation?.result;

  return (
    <>
      <PageHeader
        title={`${tr.code}`}
        description={`${locale === "ar" ? tr.carrier.nameAr : tr.carrier.name} · ${tr.plateNumber} · ${label("vehicle", tr.vehicleType, locale)}`}
        badges={<><StatusBadge group="truckStatus" value={tr.status} /><StatusBadge group="priority" value={tr.priority} />{tr.reassignmentRequired ? <Badge tone="bad">{t("إعادة تخصيص مطلوبة", "Reassignment required")}</Badge> : null}<SyntheticBadge kind="demo" /></>}
        actions={
          <>
            {can("trucks:update") && !["DEPARTED", "CANCELLED", "NO_SHOW"].includes(tr.status) ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil />{t("تعديل", "Edit")}</Button> : null}
            {can("appointments:manage") ? <Link href={`/schedule?truck=${tr.id}`}><Button variant="outline"><CalendarClock />{t("الموعد والرصيف", "Appointment & dock")}</Button></Link> : null}
            {can("readiness:evaluate") ? <Link href={`/readiness?truck=${tr.id}`}><Button variant="teal" disabledReason={releasable ? null : t("الاستدعاء متاح للشاحنات المجدولة أو المنتظرة فقط", "Release is only for scheduled or waiting trucks")}><ShieldCheck />{t("فحص الجاهزية والاستدعاء", "Readiness & release")}</Button></Link> : null}
          </>
        }
      />

      {can("trucks:transition") && actions.length ? (
        <Card className="mb-4 flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="me-2 text-[12px] font-medium text-muted">{t("إجراءات دورة الحياة المسموحة من الحالة الحالية:", "Lifecycle actions allowed from the current state:")}</span>
          {actions.map((a) => <Button key={a} size="sm" variant={DANGER.includes(a) ? "dangerOutline" : "outline"} onClick={() => setAction(a)}>{label("truckAction", a, locale)}</Button>)}
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title={t("الشحنة والمتطلبات", "Shipment & requirements")} />
          <CardBody>
            <KeyValue items={[
              { k: t("مرجع الشحنة", "Shipment"), v: <span className="num">{tr.shipment.reference}</span> },
              { k: t("الحمولة", "Cargo"), v: label("cargo", tr.shipment.cargoType, locale) },
              { k: t("الطبليات / الوزن", "Pallets / weight"), v: <span className="num">{tr.shipment.palletCount} · {f.num(tr.shipment.weightKg)} kg</span> },
              { k: t("المناولة", "Handling"), v: label("handling", tr.shipment.handlingMethod, locale) },
              { k: t("المستندات", "Documents"), v: tr.shipment.documentsComplete ? <Badge tone="ok">{t("مكتملة", "Complete")}</Badge> : <Badge tone="bad">{t("ناقصة", "Incomplete")}</Badge> },
              { k: t("فحص الجودة", "Inspection"), v: tr.shipment.inspectionRequired ? t("مطلوب", "Required") : t("غير مطلوب", "Not required") },
              { k: t("حالة الجودة", "Quality"), v: <StatusBadge group="quality" value={tr.shipment.qualityStatus} /> },
              { k: t("الظروف المطلوبة", "Required conditions"), v: <span className="num">{Object.entries(tr.shipment.requiredConditions ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}</span> },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("الأزمنة", "Times")} subtitle={t("لا يُخلط بين الموعد المطلوب والمقترح والمؤكد والوصول الفعلي", "Requested, proposed, confirmed and actual times are kept distinct")} />
          <CardBody>
            <KeyValue items={[
              { k: t("الموعد المطلوب (الناقل)", "Requested (carrier)"), v: <span className="num">{f.dateTime(appt?.requestedStart ?? tr.requestedArrival)}</span> },
              { k: t("الموعد المقترح (المخطط)", "Proposed (planner)"), v: <span className="num">{f.dateTime(appt?.proposedStart)}</span> },
              { k: t("الموعد المؤكد", "Confirmed"), v: <span className="num">{f.dateTime(appt?.confirmedStart)}</span> },
              { k: t("الوصول الفعلي", "Actual arrival"), v: <span className="num">{f.dateTime(tr.actualArrival)}</span> },
              { k: t("الاستدعاء", "Called at"), v: <span className="num">{f.dateTime(tr.calledAt)}</span> },
              { k: t("بدء / انتهاء الخدمة", "Service start / end"), v: <span className="num">{f.time(tr.serviceStartedAt)} – {f.time(tr.serviceCompletedAt)}</span> },
              { k: t("المغادرة", "Departed"), v: <span className="num">{f.dateTime(tr.departedAt)}</span> },
              { k: t("مدة الخدمة المقدرة", "Service estimate"), v: <span><span className="num">{tr.serviceEstimateMin} {t("د", "min")}</span>{tr.serviceEstimateLowMin ? <span className="num text-muted"> ({tr.serviceEstimateLowMin}–{tr.serviceEstimateHighMin})</span> : null}<div className="truncate text-[10.5px] text-muted">{tr.serviceEstimateSource}</div></span> },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("التخصيص والحجوزات", "Assignment & reservations")} />
          <CardBody className="space-y-3">
            <KeyValue items={[{ k: t("الرصيف المخصص", "Assigned dock"), v: tr.dock ? <span className="num">{tr.dock.code} · <StatusBadge group="dockStatus" value={tr.dock.status} /></span> : "—" }, { k: t("حالة الموعد", "Appointment"), v: appt?.status ?? "—" }]} />
            {tr.reservations.length ? (
              <ul className="space-y-1.5 text-[12px]">
                {tr.reservations.slice(0, 6).map((r: AnyRec) => (
                  <li key={r.id} className="flex items-center justify-between rounded-lg bg-canvas px-2.5 py-1.5"><span>{r.resourceType}</span><span className="num">{f.time(r.startAt)}–{f.time(r.endAt)}</span><Badge tone={r.status === "ACTIVE" ? "teal" : r.status === "SUSPENDED" ? "warn" : "neutral"}>{r.status}</Badge></li>
                ))}
              </ul>
            ) : <p className="text-[12px] text-muted">{t("لا توجد حجوزات موارد — تُنشأ عند الاستدعاء فقط.", "No resource reservations — created only on release.")}</p>}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title={t("آخر تقييم جاهزية", "Latest readiness evaluation")} actions={tr.latestEvaluation ? <span className="num text-[11.5px] text-muted">{f.dateTime(tr.latestEvaluation.evaluatedAt)} · {tr.latestEvaluation.engineVersion}</span> : null} />
          <CardBody>
            {tr.latestEvaluation ? <OutcomeBanner outcome={tr.latestEvaluation.outcome} summary={ev?.summary} summaryAr={ev?.summaryAr} /> : <EmptyState title={t("لم يُقيّم بعد", "Not evaluated yet")} />}
            {tr.qualityReviews.length ? (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-semibold text-navy-800">{t("مراجعات الجودة", "Quality reviews")}</p>
                <Table><tbody>{tr.qualityReviews.map((r: AnyRec) => <tr key={r.id}><Td><Link className="text-teal-700 hover:underline" href={`/quality?review=${r.id}`}>{r.trigger}</Link></Td><Td><StatusBadge group="quality" value={r.status} /></Td><Td className="num text-muted">{f.dateTime(r.createdAt)}</Td></tr>)}</tbody></Table>
              </div>
            ) : null}
            {tr.handover ? (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-line-2 px-3 py-2.5">
                <span className="text-[12.5px]">{t("سجل الاستلام", "Handover")} <span className="num font-medium">{tr.handover.reference}</span></span>
                <span className="flex items-center gap-2"><StatusBadge group="handover" value={tr.handover.status} /><Link href={`/handover?id=${tr.handover.id}`} className="text-[12px] font-medium text-teal-700 hover:underline">{t("فتح", "Open")}</Link></span>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("سجل أحداث الشاحنة", "Truck event history")} />
          <CardBody className="scroll-thin max-h-96 overflow-y-auto">{tr.events.length ? <EventTimeline events={tr.events} /> : <EmptyState title={t("لا أحداث", "No events")} />}</CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action ? `${label("truckAction", action, locale)} — ${tr.code}` : ""}
        description={t("يتحقق الخادم من قواعد الانتقال والصلاحيات والحراس (مثل وجود استدعاء فعّال لبدء الخدمة، واعتماد الاستلام قبل المغادرة).", "The server checks transition rules, permissions and guards (e.g. an active release to start service, approved handover before departure).")}
        confirmLabel={t("تأكيد", "Confirm")}
        tone={action && DANGER.includes(action) ? "danger" : "primary"}
        requireReason={!!action && REASON_REQUIRED.includes(action)}
        loading={transition.isPending}
        onConfirm={(reason) => action && transition.mutate({ a: action, reason })}
      />
      <EditDialog open={editOpen} onOpenChange={setEditOpen} truck={tr} />
    </>
  );
}

function EditDialog({ open, onOpenChange, truck }: { open: boolean; onOpenChange: (o: boolean) => void; truck: AnyRec }) {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const [v, setV] = useState({ plateNumber: truck.plateNumber, priority: truck.priority, notes: truck.notes ?? "", documentsComplete: truck.shipment.documentsComplete, palletCount: truck.shipment.palletCount });
  const save = useMutation({
    mutationFn: () => api.patch(`/api/trucks/${truck.id}`, { version: truck.version, plateNumber: v.plateNumber, priority: v.priority, notes: v.notes || null, shipment: { documentsComplete: v.documentsComplete, palletCount: Number(v.palletCount) } }),
    onSuccess: () => {
      toast.success(t("تم الحفظ", "Saved"));
      qc.invalidateQueries({ queryKey: ["trucks"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t(`تعديل ${truck.code}`, `Edit ${truck.code}`)} description={t("يُرفض الحفظ إذا عدّل مستخدم آخر السجل منذ فتحه (تحكم تفاؤلي بالتزامن).", "Saving is rejected if someone else modified the record since you opened it (optimistic concurrency).")} footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("إلغاء", "Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("حفظ", "Save")}</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("رقم اللوحة", "Plate")} htmlFor="e-plate"><Input id="e-plate" dir="ltr" value={v.plateNumber} onChange={(e) => setV({ ...v, plateNumber: e.target.value })} /></Field>
        <Field label={t("الأولوية", "Priority")} htmlFor="e-prio"><Select id="e-prio" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{label("priority", p, locale)}</option>)}</Select></Field>
        <Field label={t("عدد الطبليات", "Pallets")} htmlFor="e-pal"><Input id="e-pal" type="number" dir="ltr" value={v.palletCount} onChange={(e) => setV({ ...v, palletCount: e.target.value })} /></Field>
        <label className="mt-6 flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="size-4" checked={v.documentsComplete} onChange={(e) => setV({ ...v, documentsComplete: e.target.checked })} />{t("المستندات مكتملة", "Documents complete")}</label>
        <Field label={t("ملاحظات", "Notes")} htmlFor="e-notes" className="md:col-span-2"><Textarea id="e-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

