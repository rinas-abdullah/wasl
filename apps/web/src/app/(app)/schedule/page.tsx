"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, Drawer, EmptyState, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, Tabs } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

const TZ_OFFSET_MIN = 180; // Asia/Riyadh (no DST)
const DAY_START_H = 4;
const DAY_END_H = 24;
const SPAN_MIN = (DAY_END_H - DAY_START_H) * 60;

function riyadhMidnight(d: Date) {
  const local = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TZ_OFFSET_MIN * 60_000);
}
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function ScheduleInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [view, setView] = useState<"day" | "week">("day");
  const [day, setDay] = useState(() => riyadhMidnight(new Date()));
  const [detail, setDetail] = useState<AnyRec | null>(null);
  const [proposal, setProposal] = useState<{ truck: AnyRec; dockId: string; start: string; durationMin?: number } | null>(null);
  const [validation, setValidation] = useState<AnyRec | null>(null);
  const [form, setForm] = useState<{ truckId: string; dockId: string; start: string } | null>(sp.get("truck") ? { truckId: sp.get("truck")!, dockId: "", start: toLocalInput(new Date(Date.now() + 3600_000)) } : null);
  const [dragging, setDragging] = useState<string | null>(null);

  const from = view === "day" ? day : day;
  const to = new Date(day.getTime() + (view === "day" ? 1 : 7) * 86400_000);
  const docks = useQuery({ queryKey: ["docks"], queryFn: () => api.get<AnyRec[]>("/api/docks") });
  const appts = useQuery({ queryKey: ["appointments", from.toISOString(), view], queryFn: () => api.get<AnyRec>(`/api/appointments${qs({ from: from.toISOString(), to: to.toISOString() })}`) });
  const trucks = useQuery({ queryKey: ["trucks", "schedulable"], queryFn: () => api.get<{ items: AnyRec[] }>("/api/trucks?status=REGISTERED&status=SCHEDULED&status=WAITING&pageSize=100") });

  const validate = useMutation({
    mutationFn: (p: { truckId: string; dockId: string; start: string; durationMin?: number }) => api.post<AnyRec>("/api/appointments/validate", p),
    onSuccess: (r) => setValidation(r),
    onError: (e) => { toast.error((e as Error).message); setProposal(null); },
  });
  const commit = useMutation({
    mutationFn: () => api.post<AnyRec>("/api/appointments", { truckId: proposal!.truck.id, dockId: proposal!.dockId, start: proposal!.start, durationMin: proposal!.durationMin, version: proposal!.truck.version, reason: "Manual scheduling" }),
    onSuccess: () => {
      toast.success(t("تم تأكيد الموعد — أعيد تقييم التعارضات على الخادم", "Appointment confirmed — conflicts re-evaluated server-side"));
      setProposal(null);
      setValidation(null);
      setForm(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    if (proposal) validate.mutate({ truckId: proposal.truck.id, dockId: proposal.dockId, start: proposal.start, durationMin: proposal.durationMin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const list: AnyRec[] = appts.data?.appointments ?? [];
  const confirmed = list.filter((a) => a.status === "CONFIRMED" || a.status === "COMPLETED");
  const requested = (trucks.data?.items ?? []).filter((x) => !x.appointment?.confirmedStart || x.reassignmentRequired);
  const dayStart = new Date(day.getTime() + DAY_START_H * 3600_000);
  const xPct = (d: Date | string) => ((new Date(d).getTime() - dayStart.getTime()) / 60_000 / SPAN_MIN) * 100;
  const nowPct = xPct(new Date());

  function onDrop(e: React.DragEvent<HTMLDivElement>, dockId: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    setDragging(null);
    const a = list.find((x) => x.truck.id === id);
    const tr = (trucks.data?.items ?? []).find((x) => x.id === id);
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const minutes = Math.round((ratio * SPAN_MIN) / 5) * 5;
    const start = new Date(dayStart.getTime() + minutes * 60_000).toISOString();
    const truck = tr ?? (a ? { ...a.truck, id: a.truck.id, code: a.truck.code, version: a.truck.version } : null);
    if (!truck) return;
    setProposal({ truck, dockId, start, durationMin: a?.durationMin });
  }

  const hours = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => DAY_START_H + i);
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(day.getTime() + i * 86400_000));

  return (
    <>
      <PageHeader
        title={t("جدول المواعيد", "Appointment scheduling")}
        description={t("الخط الزمني للأرصفة. اسحب شاحنة إلى رصيف وتوقيت لاقتراح موعد — يتحقق الخادم من التوافق والتعارضات قبل التأكيد. الموعد المطلوب والمقترح والمؤكد والوصول الفعلي تُعرض منفصلة.", "Dock timeline. Drag a truck onto a dock and time to propose a slot — the server checks compatibility and conflicts before confirming. Requested, proposed, confirmed and actual times are shown separately.")}
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as "day" | "week")} items={[{ value: "day", label: t("يوم", "Day") }, { value: "week", label: t("أسبوع", "Week") }]} />
            <Button variant="outline" size="icon" onClick={() => setDay(new Date(day.getTime() - (view === "day" ? 1 : 7) * 86400_000))} aria-label={t("السابق", "Previous")}><ChevronRight className="ltr:rotate-180" /></Button>
            <Button variant="outline" size="sm" onClick={() => setDay(riyadhMidnight(new Date()))}>{t("اليوم", "Today")}</Button>
            <Button variant="outline" size="icon" onClick={() => setDay(new Date(day.getTime() + (view === "day" ? 1 : 7) * 86400_000))} aria-label={t("التالي", "Next")}><ChevronLeft className="ltr:rotate-180" /></Button>
            {can("appointments:manage") ? <Button onClick={() => setForm({ truckId: "", dockId: "", start: toLocalInput(new Date(Date.now() + 3600_000)) })}><CalendarPlus />{t("جدولة موعد", "Schedule")}</Button> : null}
          </>
        }
      />
      <div className="grid gap-4 2xl:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader title={view === "day" ? f.date(day) : `${f.date(day)} – ${f.date(new Date(to.getTime() - 1))}`} subtitle={t("بتوقيت الرياض", "Riyadh time")} />
          {docks.isLoading || appts.isLoading ? <LoadingBlock rows={6} /> : appts.error ? <ErrorState error={appts.error} /> : view === "day" ? (
            <div className="scroll-thin overflow-x-auto p-4" dir="ltr">
              <div className="min-w-[1500px]">
                <div className="relative ms-24 h-6 text-[10.5px] text-muted">
                  {hours.map((h) => <span key={h} className="num absolute -translate-x-1/2" style={{ left: `${((h - DAY_START_H) / (DAY_END_H - DAY_START_H)) * 100}%` }}>{String(h % 24).padStart(2, "0")}:00</span>)}
                </div>
                {docks.data!.map((d) => {
                  const down = d.status !== "AVAILABLE";
                  const rows = confirmed.filter((a) => a.dockId === d.id);
                  const res = (appts.data!.reservations as AnyRec[]).filter((r) => r.resourceId === d.id);
                  return (
                    <div key={d.id} className="flex items-stretch border-t border-line-2">
                      <div className="w-24 shrink-0 py-3 pe-2 text-[12px]">
                        <p className="num font-semibold text-navy-900">{d.code}</p>
                        <StatusBadge group="dockStatus" value={d.effectiveStatus} />
                      </div>
                      <div
                        className={cn("relative h-[72px] flex-1 border-s border-line-2", down ? "bg-[repeating-linear-gradient(45deg,#fdecea,#fdecea_6px,#fff_6px,#fff_12px)]" : "bg-surface", dragging && !down && "bg-teal-50/40")}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDrop(e, d.id)}
                        aria-label={t(`خط زمني ${d.code}`, `${d.code} timeline`)}
                      >
                        {hours.map((h) => <span key={h} className="absolute inset-y-0 w-px bg-line-2" style={{ left: `${((h - DAY_START_H) / (DAY_END_H - DAY_START_H)) * 100}%` }} />)}
                        {nowPct > 0 && nowPct < 100 ? <span className="absolute inset-y-0 z-10 w-0.5 bg-bad/70" style={{ left: `${nowPct}%` }} /> : null}
                        {res.map((r) => <span key={r.id} title={t("حجز مورد فعلي", "Actual resource reservation")} className={cn("absolute bottom-1 h-1.5 rounded-full", r.status === "ACTIVE" ? "bg-teal-500" : "bg-navy-600/40")} style={{ left: `${xPct(r.startAt)}%`, width: `${Math.max(0.4, xPct(r.endAt) - xPct(r.startAt))}%` }} />)}
                        {rows.map((a) => {
                          const start = a.confirmedStart ?? a.proposedStart;
                          const left = xPct(start);
                          const width = (a.durationMin / SPAN_MIN) * 100;
                          const movable = can("appointments:manage") && ["REGISTERED", "SCHEDULED", "WAITING"].includes(a.truck.status);
                          return (
                            <button
                              key={a.id}
                              draggable={movable}
                              onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.truck.id); setDragging(a.truck.id); }}
                              onDragEnd={() => setDragging(null)}
                              onClick={() => setDetail(a)}
                              className={cn("absolute top-2 flex h-11 flex-col justify-center overflow-hidden rounded-md border px-1.5 text-start text-[11px] leading-tight shadow-sm", a.truck.status === "IN_SERVICE" ? "border-ok/40 bg-ok-bg" : a.truck.status === "DEPARTED" || a.status === "COMPLETED" ? "border-line bg-line-2 text-muted" : a.truck.reassignmentRequired ? "border-bad/50 bg-bad-bg" : "border-info/30 bg-info-bg", movable && "cursor-grab active:cursor-grabbing")}
                              style={{ left: `${left}%`, width: `${Math.max(width, 2.5)}%` }}
                              title={`${a.truck.code} ${f.time(start)} · ${a.durationMin}m`}
                            >
                              <span className="num truncate font-semibold">{a.truck.code}</span>
                              <span className="num truncate text-[10px] opacity-80">{f.time(start)} · {label("cargo", a.cargoType, locale)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <p className="mt-3 text-[11px] text-muted">{t("الأشرطة الملونة السفلية = حجوزات الموارد الفعلية بعد الاستدعاء. المواعيد المظللة بالأحمر تتطلب إعادة تخصيص.", "Thin bottom bars = actual resource reservations after release. Red appointments require reassignment.")}</p>
              </div>
            </div>
          ) : (
            <div className="scroll-thin overflow-x-auto p-4">
              <table className="w-full min-w-[800px] border-collapse text-[12px]">
                <thead><tr><th className="p-2 text-start text-muted">{t("الرصيف", "Dock")}</th>{weekDays.map((wd) => <th key={wd.toISOString()} className="p-2 text-start font-medium text-muted">{f.date(wd)}</th>)}</tr></thead>
                <tbody>
                  {docks.data!.map((d) => (
                    <tr key={d.id} className="border-t border-line-2">
                      <td className="num p-2 font-semibold">{d.code}</td>
                      {weekDays.map((wd) => {
                        const items = confirmed.filter((a) => a.dockId === d.id && new Date(a.confirmedStart ?? a.proposedStart) >= wd && new Date(a.confirmedStart ?? a.proposedStart) < new Date(wd.getTime() + 86400_000));
                        const load = items.reduce((s, a) => s + a.durationMin, 0);
                        return (
                          <td key={wd.toISOString()} className="p-2 align-top">
                            {items.length ? <div className="space-y-1">{items.slice(0, 4).map((a) => <button key={a.id} onClick={() => setDetail(a)} className="num block w-full truncate rounded bg-info-bg px-1.5 py-0.5 text-start text-[11px] text-info">{f.time(a.confirmedStart)} {a.truck.code}</button>)}{items.length > 4 ? <span className="text-muted">+{items.length - 4}</span> : null}<p className="num text-[10.5px] text-muted">{t("حمل", "load")} {load}m</p></div> : <span className="text-muted">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader title={t("طلبات بانتظار التأكيد", "Requests awaiting confirmation")} subtitle={t("اسحب إلى خط الرصيف", "Drag onto a dock timeline")} actions={<Badge tone="warn">{requested.length}</Badge>} />
          <CardBody className="space-y-2">
            {requested.length === 0 ? <EmptyState title={t("لا توجد طلبات", "No pending requests")} /> : requested.map((x) => (
              <div key={x.id} draggable={can("appointments:manage")} onDragStart={(e) => { e.dataTransfer.setData("text/plain", x.id); setDragging(x.id); }} onDragEnd={() => setDragging(null)} className="cursor-grab rounded-lg border border-line bg-surface px-3 py-2 hover:border-teal-500 active:cursor-grabbing">
                <div className="flex items-center justify-between"><TruckLink id={x.id} code={x.code} />{x.reassignmentRequired ? <Badge tone="bad">{t("إعادة تخصيص", "Reassign")}</Badge> : <StatusBadge group="truckStatus" value={x.status} />}</div>
                <p className="mt-0.5 text-[11.5px] text-muted">{label("cargo", x.shipment.cargoType, locale)} · {label("vehicle", x.vehicleType, locale)} · <span className="num">{x.serviceEstimateMin}m</span></p>
                <p className="num text-[11.5px] text-muted">{t("مطلوب", "Requested")} {f.dateTime(x.requestedArrival)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Drawer open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail ? t(`موعد ${detail.truck.code}`, `Appointment ${detail.truck.code}`) : ""}>
        {detail ? (
          <div className="space-y-4">
            <KeyValue items={[
              { k: t("الشاحنة", "Truck"), v: <TruckLink id={detail.truck.id} code={detail.truck.code} /> },
              { k: t("حالة الموعد", "Appointment status"), v: detail.status },
              { k: t("الموعد المطلوب", "Requested"), v: <span className="num">{f.dateTime(detail.requestedStart)}</span> },
              { k: t("الموعد المقترح", "Proposed"), v: <span className="num">{f.dateTime(detail.proposedStart)}</span> },
              { k: t("الموعد المؤكد", "Confirmed"), v: <span className="num">{f.dateTime(detail.confirmedStart)}</span> },
              { k: t("الوصول الفعلي", "Actual arrival"), v: <span className="num">{f.dateTime(detail.truck.actualArrival)}</span> },
              { k: t("المدة المقدرة", "Estimated duration"), v: <span className="num">{detail.durationMin} {t("د", "min")}</span> },
              { k: t("المصدر", "Source"), v: detail.source },
              { k: t("الناقل", "Carrier"), v: locale === "ar" ? detail.carrierAr : detail.carrier },
              { k: t("الجودة", "Quality"), v: <StatusBadge group="quality" value={detail.qualityStatus} /> },
            ]} />
          </div>
        ) : null}
      </Drawer>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={t("جدولة موعد", "Schedule an appointment")} footer={<><Button variant="outline" onClick={() => setForm(null)}>{t("إلغاء", "Cancel")}</Button><Button disabled={!form?.truckId || !form?.dockId} onClick={() => { const tr = trucks.data?.items.find((x) => x.id === form!.truckId); if (tr) setProposal({ truck: tr, dockId: form!.dockId, start: new Date(form!.start).toISOString() }); }}>{t("تحقق", "Validate")}</Button></>}>
        {form ? (
          <div className="space-y-4">
            <Field label={t("الشاحنة", "Truck")} htmlFor="s-t"><Select id="s-t" value={form.truckId} onChange={(e) => setForm({ ...form, truckId: e.target.value })}><option value="">—</option>{trucks.data?.items.map((x) => <option key={x.id} value={x.id}>{x.code} · {label("cargo", x.shipment.cargoType, locale)}</option>)}</Select></Field>
            <Field label={t("الرصيف", "Dock")} htmlFor="s-d"><Select id="s-d" value={form.dockId} onChange={(e) => setForm({ ...form, dockId: e.target.value })}><option value="">—</option>{docks.data?.map((d) => <option key={d.id} value={d.id}>{d.code} · {label("dockStatus", d.effectiveStatus, locale)}</option>)}</Select></Field>
            <Field label={t("البدء", "Start")} htmlFor="s-s"><Input id="s-s" type="datetime-local" dir="ltr" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={!!proposal} onOpenChange={(o) => { if (!o) { setProposal(null); setValidation(null); } }} title={proposal ? t(`تأكيد موعد ${proposal.truck.code}`, `Confirm ${proposal.truck.code}`) : ""} description={t("نتيجة التحقق على الخادم", "Server-side validation result")} footer={<><Button variant="outline" onClick={() => { setProposal(null); setValidation(null); }}>{t("إلغاء", "Cancel")}</Button><Button loading={commit.isPending} disabledReason={validation && !validation.ok ? t("يوجد تعارضات تمنع التأكيد", "Conflicts prevent confirmation") : null} disabled={!validation} onClick={() => commit.mutate()}>{t("تأكيد الموعد", "Confirm appointment")}</Button></>}>
        {validate.isPending || !validation ? <LoadingBlock rows={3} /> : (
          <div className="space-y-3 text-[13px]">
            <p className="num">{f.dateTime(validation.start)} – {f.time(validation.end)} · {validation.durationMin} {t("د", "min")} · {docks.data?.find((d) => d.id === proposal?.dockId)?.code}</p>
            {validation.ok ? <p className="rounded-lg bg-ok-bg px-3 py-2 text-ok">{t("لا توجد تعارضات — يمكن التأكيد", "No conflicts — can be confirmed")}</p> : null}
            {validation.errors.map((e: AnyRec) => <p key={e.code} className="rounded-lg bg-bad-bg px-3 py-2 text-bad"><code className="text-[11px]">{e.code}</code> · {locale === "ar" ? e.messageAr : e.message}</p>)}
            {validation.warnings.map((e: AnyRec) => <p key={e.code} className="rounded-lg bg-warn-bg px-3 py-2 text-warn"><code className="text-[11px]">{e.code}</code> · {locale === "ar" ? e.messageAr : e.message}</p>)}
          </div>
        )}
      </Dialog>
    </>
  );
}

export default function SchedulePage() {
  return (
    <Suspense>
      <ScheduleInner />
    </Suspense>
  );
}
