"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HANDOVER_ACTIONS } from "@wasl/shared";
import { api, newIdempotencyKey } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Badge, Button, EmptyState, ErrorState, KeyValue, LoadingBlock, StatusBadge } from "./ui";
import { TruckLink, type AnyRec } from "./domain";

/** Handover record resolved by its opaque token; actions are validated server-side and idempotent. */
export function HandoverPanel({ token }: { token: string }) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["handover", "scan", token], queryFn: () => api.get<AnyRec>(`/api/handover/scan/${token}`) });
  const act = useMutation({
    mutationFn: (action: string) => api.post<AnyRec>("/api/handover/actions", { token, action }, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (r) => {
      toast.success(t(`سُجل الإجراء — حالة الاستلام: ${label("handover", r.status, "ar")}`, `Action recorded — handover status: ${label("handover", r.status, "en")}`));
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} />;
  const h = q.data!;
  const steps = ["PENDING_ARRIVAL", "ARRIVAL_CONFIRMED", "UNLOADING", ...(h.shipment.inspectionRequired ? ["INSPECTION_RECORDED"] : []), "APPROVED", "CLOSED"];
  const idx = steps.indexOf(h.status);
  return (
    <div className="space-y-5">
      <KeyValue items={[
        { k: t("مرجع الاستلام", "Handover reference"), v: <span className="num">{h.reference}</span> },
        { k: t("الحالة الحالية", "Current status"), v: <StatusBadge group="handover" value={h.status} /> },
        { k: t("الشحنة", "Shipment"), v: <span className="num">{h.shipment.reference} · {label("cargo", h.shipment.cargoType, locale)} · {h.shipment.palletCount}</span> },
        { k: t("الشاحنة", "Truck"), v: <span><TruckLink id={h.truck.id} code={h.truck.code} /> · <StatusBadge group="truckStatus" value={h.truck.status} /></span> },
        { k: t("الفحوصات المطلوبة", "Required inspections"), v: h.requiredInspections.length ? h.requiredInspections.join(", ") : t("لا يوجد", "None") },
        { k: t("الفحص مسجل", "Inspection recorded"), v: h.inspectionRecorded ? t("نعم", "Yes") : t("لا", "No") },
      ]} />
      <ol className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => <li key={s}><Badge tone={i < idx ? "ok" : i === idx ? "teal" : "neutral"}>{i + 1}. {label("handover", s, locale)}</Badge></li>)}
      </ol>
      <div>
        <p className="mb-2 text-[12px] font-semibold text-navy-800">{t("الإجراءات المصرح بها لك الآن", "Actions authorised for you now")}</p>
        {h.authorizedActions.length ? (
          <div className="flex flex-wrap gap-2">{HANDOVER_ACTIONS.filter((a) => h.authorizedActions.includes(a)).map((a) => <Button key={a} variant={a === "APPROVE_HANDOVER" ? "teal" : "outline"} loading={act.isPending && act.variables === a} onClick={() => act.mutate(a)}>{label("handoverAction", a, locale)}</Button>)}</div>
        ) : <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">{t("لا توجد إجراءات متاحة لدورك في هذه الحالة.", "No actions are available to your role in this state.")}</p>}
        <p className="mt-2 text-[11.5px] text-muted">{t("كل إجراء يرسل مفتاح عدم تكرار (Idempotency-Key)، ويرفض الخادم تكرار الإجراء نفسه أو تنفيذه من حالة غير صحيحة.", "Each action sends an Idempotency-Key; the server rejects repeating the same action or performing it from the wrong state.")}</p>
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold text-navy-800">{t("سجل الأحداث", "Event history")}</p>
        {h.history.length ? <ol className="space-y-1.5 text-[12px]">{h.history.map((x: AnyRec, i: number) => <li key={i} className="rounded-lg bg-canvas px-3 py-2"><span className="num text-muted">{f.dateTime(x.at)}</span> · {label("handoverAction", x.action, locale)} · {x.actor}<span className="text-muted"> ({x.from} → {x.to})</span></li>)}</ol> : <EmptyState title={t("لا إجراءات بعد", "No actions yet")} />}
      </div>
    </div>
  );
}
