"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { api, newIdempotencyKey } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useLiveUpdates } from "@/lib/live";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";
import { EventTimeline, TruckLink, type AnyRec } from "@/components/domain";

const COLUMNS: { zone: string; ar: string; en: string }[] = [
  { zone: "PLANNED", ar: "مخطط / مجدول", en: "Planned / scheduled" },
  { zone: "APPROACH", ar: "مُستدعى — في الطريق", en: "Called — en route" },
  { zone: "YARD", ar: "في الساحة (انتظار)", en: "In yard (waiting)" },
  { zone: "QUALITY", ar: "بانتظار الجودة", en: "Awaiting quality" },
  { zone: "TO_DOCK", ar: "وصل — متجه للرصيف", en: "Arrived — to dock" },
  { zone: "DOCK", ar: "عند الرصيف", en: "At dock" },
];
const NEXT: Record<string, { action: string; ar: string; en: string } | undefined> = {
  CALLED: { action: "MARK_ARRIVAL", ar: "تسجيل الوصول", en: "Mark arrival" },
  SCHEDULED: { action: "MARK_ARRIVAL", ar: "وصول مبكر", en: "Early arrival" },
  ARRIVED: { action: "START_SERVICE", ar: "بدء الخدمة", en: "Start service" },
  IN_SERVICE: { action: "COMPLETE_SERVICE", ar: "إكمال الخدمة", en: "Complete service" },
};

export default function LivePage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const { connected, lastEventAt } = useLiveUpdates();
  const twin = useQuery({ queryKey: ["twin", "state"], queryFn: () => api.get<AnyRec>("/api/twin/state") });
  const events = useQuery({ queryKey: ["events", "live"], queryFn: () => api.get<AnyRec>("/api/events?pageSize=30") });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const tr = await api.get<AnyRec>(`/api/trucks/${id}`);
      const target = action === "START_SERVICE" && tr.status === "CALLED" ? "START_SERVICE" : action;
      return api.post<AnyRec>(`/api/trucks/${id}/transitions`, { action: target, version: tr.version }, { idempotencyKey: newIdempotencyKey() });
    },
    onSuccess: (r) => { toast.success(`${r.code}: ${label("truckStatus", r.status, locale)}`); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (twin.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (twin.error) return <Card><ErrorState error={twin.error} onRetry={() => twin.refetch()} /></Card>;
  const trucks: AnyRec[] = twin.data!.trucks;
  return (
    <>
      <PageHeader
        title={t("العمليات المباشرة", "Live operations")}
        description={t("لوحة تدفق الشاحنات عبر مراحل الاستقبال. تتحدث فورًا عبر قناة الأحداث المباشرة، وتنفيذ الإجراءات يمر عبر آلة الحالات على الخادم.", "Truck flow board across reception stages. Updates instantly through the live event channel; actions go through the server-side state machine.")}
        badges={<Badge tone={connected ? "ok" : "warn"} dot>{connected ? t("بث مباشر", "Live") : t("غير متصل", "Disconnected")}</Badge>}
        actions={lastEventAt ? <span className="text-[12px] text-muted">{t("آخر حدث", "Last event")} <span className="num">{f.time(lastEventAt)}</span></span> : null}
      />
      <div className="grid gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {COLUMNS.map((c) => {
          const items = trucks.filter((x) => x.zone === c.zone);
          return (
            <Card key={c.zone} className="flex min-h-[260px] flex-col">
              <div className="flex items-center justify-between border-b border-line-2 px-3.5 py-2.5"><span className="text-[12.5px] font-semibold">{locale === "ar" ? c.ar : c.en}</span><span className="num rounded-md bg-line-2 px-1.5 text-[11.5px]">{items.length}</span></div>
              <div className="flex-1 space-y-2 p-2.5">
                {items.length === 0 ? <p className="py-6 text-center text-[11.5px] text-muted">—</p> : items.map((x) => {
                  const next = NEXT[x.status];
                  const dock = twin.data!.docks.find((d: AnyRec) => d.id === x.dockId);
                  return (
                    <div key={x.id} className="rounded-lg border border-line bg-surface p-2.5">
                      <div className="flex items-center justify-between gap-1"><TruckLink id={x.id} code={x.code} /><StatusBadge group="truckStatus" value={x.status} /></div>
                      <p className="mt-1 text-[11.5px] text-muted">{label("cargo", x.cargoType, locale)} · {dock?.code ?? "—"} · <span className="num">{f.time(x.actualArrival ?? x.plannedArrival)}</span></p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {x.qualityStatus !== "NO_ISSUE_OBSERVED" ? <StatusBadge group="quality" value={x.qualityStatus} /> : null}
                        {x.reassignmentRequired ? <Badge tone="bad">{t("إعادة تخصيص", "Reassign")}</Badge> : null}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        {next && can("trucks:transition") && !(x.status === "SCHEDULED") ? <Button size="sm" variant="outline" className="h-7 flex-1 text-[11.5px]" loading={act.isPending && act.variables?.id === x.id} onClick={() => act.mutate({ id: x.id, action: x.status === "CALLED" && x.actualArrival ? "START_SERVICE" : next.action })}>{x.status === "CALLED" && x.actualArrival ? t("بدء الخدمة", "Start service") : locale === "ar" ? next.ar : next.en}</Button> : null}
                        {["SCHEDULED", "WAITING"].includes(x.status) && can("readiness:evaluate") ? <Link href={`/readiness?truck=${x.id}`} className="flex-1"><Button size="sm" variant="teal" className="h-7 w-full text-[11.5px]">{t("الجاهزية", "Readiness")}</Button></Link> : null}
                        {x.status === "COMPLETED" ? <Link href="/handover" className="flex-1"><Button size="sm" variant="outline" className="h-7 w-full text-[11.5px]">{t("الاستلام", "Handover")}</Button></Link> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-4">
        <CardHeader title={t("بث الأحداث", "Event stream")} subtitle={t("آخر 30 حدثًا مسجلًا", "Last 30 recorded events")} />
        <CardBody className="scroll-thin max-h-96 overflow-y-auto">{events.data?.items.length ? <EventTimeline events={events.data.items} /> : <EmptyState title={t("لا أحداث", "No events")} />}</CardBody>
      </Card>
    </>
  );
}
