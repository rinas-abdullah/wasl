"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import type { AnyRec } from "@/components/domain";

export default function ResourcesPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["resources"], queryFn: () => api.get<AnyRec>("/api/resources") });
  const [target, setTarget] = useState<{ kind: "teams" | "equipment"; row: AnyRec; status: string } | null>(null);
  const mut = useMutation({
    mutationFn: (reason: string) => api.patch<AnyRec>(`/api/resources/${target!.kind}/${target!.row.id}/status`, { status: target!.status, reason }),
    onSuccess: (r) => {
      toast.success(t(`تم التحديث — أُلغي ${r.affectedTrucks.length} استدعاء متأثر`, `Updated — ${r.affectedTrucks.length} affected release(s) revoked`));
      setTarget(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data!;
  const now = Date.now();
  const winStart = now - 3 * 3600_000;
  const winEnd = now + 6 * 3600_000;
  const pos = (x: string) => Math.min(100, Math.max(0, ((new Date(x).getTime() - winStart) / (winEnd - winStart)) * 100));
  const resources = [...d.teams.map((x: AnyRec) => ({ ...x, kind: "TEAM" })), ...d.equipment.map((x: AnyRec) => ({ ...x, kind: "EQUIPMENT" }))];

  return (
    <>
      <PageHeader title={t("تخطيط الموارد", "Resource planning")} description={t("فرق العمل والمعدات وحجوزاتها الزمنية. يمنع قيد قاعدة بيانات (EXCLUDE) تخصيص مورد واحد لعمليتين متداخلتين، ويستخدم محركا الجاهزية والتحسين هذه البيانات مباشرة.", "Workforce teams, equipment and their time-bounded reservations. A database EXCLUDE constraint prevents one resource being booked for overlapping operations; the readiness and optimisation engines read this data directly.")} />
      {d.conflicts.length ? (
        <Card className="mb-4 border-bad/30 bg-bad-bg/40 px-5 py-3 text-[13px] text-bad">
          {t("تعارضات", "Conflicts")}: {d.conflicts.map((c: AnyRec) => `${c.truckCode} — ${c.message}`).join(" · ")}
        </Card>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("فرق العمل", "Workforce teams")} />
          <Table>
            <thead><tr><Th>{t("الفريق", "Team")}</Th><Th>{t("الوردية", "Shift")}</Th><Th>{t("العدد", "Size")}</Th><Th>{t("المهارات", "Skills")}</Th><Th>{t("الحالة", "Status")}</Th><Th /></tr></thead>
            <tbody>
              {d.teams.map((tm: AnyRec) => {
                const active = d.reservations.find((r: AnyRec) => r.resourceId === tm.id && r.status === "ACTIVE" && new Date(r.startAt).getTime() <= now && new Date(r.endAt).getTime() > now);
                return (
                  <tr key={tm.id}>
                    <Td><p className="font-medium">{locale === "ar" ? tm.nameAr : tm.name}</p><p className="num text-[11px] text-muted">{tm.code}{active ? ` · ${t("يعمل على", "on")} ${active.truckCode}` : ""}</p></Td>
                    <Td className="num">{tm.shiftStart}–{tm.shiftEnd}</Td>
                    <Td className="num">{tm.size}</Td>
                    <Td><div className="flex max-w-[220px] flex-wrap gap-1">{tm.skills.map((s: string) => <Badge key={s} tone="neutral">{s}</Badge>)}</div></Td>
                    <Td><StatusBadge group="resource" value={tm.status} />{tm.statusReason && tm.status !== "AVAILABLE" ? <p className="mt-0.5 text-[11px] text-muted">{tm.statusReason}</p> : null}</Td>
                    <Td>{can("resources:manage") ? <Button size="sm" variant={tm.status === "AVAILABLE" ? "dangerOutline" : "outline"} onClick={() => setTarget({ kind: "teams", row: tm, status: tm.status === "AVAILABLE" ? "UNAVAILABLE" : "AVAILABLE" })}>{tm.status === "AVAILABLE" ? t("غير متاح", "Mark unavailable") : t("متاح", "Mark available")}</Button> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("المعدات", "Equipment")} />
          <Table>
            <thead><tr><Th>{t("المعدة", "Unit")}</Th><Th>{t("النوع", "Type")}</Th><Th>{t("العمليات المتوافقة", "Compatible ops")}</Th><Th>{t("الحالة", "Status")}</Th><Th /></tr></thead>
            <tbody>
              {d.equipment.map((e: AnyRec) => (
                <tr key={e.id}>
                  <Td className="num font-medium">{e.code}</Td>
                  <Td>{e.type}</Td>
                  <Td className="text-[12px] text-muted">{e.compatibleOperations.join(", ")}</Td>
                  <Td><StatusBadge group="resource" value={e.status} />{e.statusReason && e.status !== "AVAILABLE" ? <p className="mt-0.5 text-[11px] text-muted">{e.statusReason}</p> : null}</Td>
                  <Td>{can("resources:manage") ? <Button size="sm" variant={e.status === "AVAILABLE" ? "dangerOutline" : "outline"} onClick={() => setTarget({ kind: "equipment", row: e, status: e.status === "AVAILABLE" ? "MAINTENANCE" : "AVAILABLE" })}>{e.status === "AVAILABLE" ? t("صيانة", "Maintenance") : t("إعادة للخدمة", "Restore")}</Button> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title={t("الخط الزمني للحجوزات", "Reservation timeline")} subtitle={t("من 3 ساعات مضت إلى 6 ساعات قادمة · الخط العمودي = الآن", "From 3 h ago to 6 h ahead · vertical line = now")} />
        <CardBody>
          {resources.length === 0 ? <EmptyState title={t("لا موارد", "No resources")} /> : (
            <div className="space-y-1.5">
              {resources.map((r: AnyRec) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="num w-20 shrink-0 text-[12px] font-medium">{r.code}</span>
                  <div className="relative h-7 flex-1 rounded-md bg-canvas" dir="ltr">
                    <span className="absolute inset-y-0 w-px bg-bad/60" style={{ left: `${pos(new Date(now).toISOString())}%` }} />
                    {d.reservations.filter((x: AnyRec) => x.resourceId === r.id && x.status !== "CANCELLED").map((x: AnyRec) => (
                      <span key={x.id} title={`${x.truckCode} ${f.time(x.startAt)}–${f.time(x.endAt)} (${x.status})`} className={`absolute inset-y-1 flex items-center overflow-hidden rounded px-1.5 text-[10.5px] font-medium text-white ${x.status === "ACTIVE" ? "bg-teal-600" : x.status === "SUSPENDED" ? "bg-warn" : "bg-navy-600/50"}`} style={{ left: `${pos(x.startAt)}%`, width: `${Math.max(1.5, pos(x.endAt) - pos(x.startAt))}%` }}>
                        {x.truckCode}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-4 pt-2 text-[11.5px] text-muted"><span className="flex items-center gap-1"><span className="size-2.5 rounded bg-teal-600" />{t("فعّال", "Active")}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded bg-warn" />{t("معلق", "Suspended")}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded bg-navy-600/50" />{t("منتهٍ", "Released")}</span></div>
            </div>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? `${target.row.code} → ${target.status}` : ""} description={t("إذا أصبح المورد غير متاح تُعلّق حجوزاته المستقبلية وتُلغى استدعاءات الشاحنات المعتمدة عليه ويُطلب مقترح تحسين.", "If the resource becomes unavailable its future reservations are suspended, dependent releases revoked, and an optimisation proposal requested.")} confirmLabel={t("تأكيد", "Confirm")} tone={target?.status === "AVAILABLE" ? "teal" : "danger"} requireReason loading={mut.isPending} onConfirm={(r) => mut.mutate(r)} />
    </>
  );
}
