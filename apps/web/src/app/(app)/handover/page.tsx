"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";
import { HandoverPanel } from "@/components/handover-panel";
import { cn } from "@/lib/utils";

function HandoverInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const sp = useSearchParams();
  const q = useQuery({ queryKey: ["handover", "list"], queryFn: () => api.get<AnyRec[]>("/api/handover") });
  const [selId, setSelId] = useState<string | null>(sp.get("id"));
  const sel = q.data?.find((h) => h.id === (selId ?? q.data?.[0]?.id));
  return (
    <>
      <PageHeader title={t("مركز الاستلام", "Handover center")} description={t("لكل شحنة سجل استلام برمز QR يحمل معرّفًا عشوائيًا غير قابل للتخمين فقط — لا أسرار ولا بيانات شخصية. عند المسح يتحقق الخادم من هوية المستخدم وصلاحياته ونطاق منشأته قبل عرض السجل أو السماح بأي إجراء.", "Each shipment has a handover record with a QR code holding only an unguessable random identifier — no secrets or personal data. On scan, the server verifies identity, permissions and facility scope before showing the record or allowing any action.")} />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title={t("سجلات الاستلام", "Handover records")} />
          {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? <EmptyState title={t("لا توجد سجلات", "No records")} description={t("يُنشأ سجل الاستلام تلقائيًا عند استدعاء الشاحنة.", "A handover record is created automatically when a truck is released.")} /> : (
            <Table>
              <thead><tr><Th>{t("المرجع", "Reference")}</Th><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الشحنة", "Shipment")}</Th><Th>{t("الفحص", "Inspection")}</Th><Th>{t("الحالة", "Status")}</Th><Th>{t("آخر تحديث", "Updated")}</Th></tr></thead>
              <tbody>{q.data.map((h) => <tr key={h.id} className={cn("cursor-pointer hover:bg-canvas/60", sel?.id === h.id && "bg-teal-50/50")} onClick={() => setSelId(h.id)}><Td className="num font-medium">{h.reference}</Td><Td><TruckLink id={h.truck.id} code={h.truck.code} /></Td><Td>{h.shipment.reference} · {label("cargo", h.shipment.cargoType, locale)}</Td><Td>{h.shipment.inspectionRequired ? (h.inspectionRecorded ? t("مسجل", "Recorded") : t("مطلوب", "Required")) : "—"}</Td><Td><StatusBadge group="handover" value={h.status} /></Td><Td className="num text-muted">{f.dateTime(h.updatedAt)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
        {sel ? (
          <Card>
            <CardHeader title={sel.reference} subtitle={sel.truck.code} />
            <CardBody className="space-y-5">
              {sel.qrToken && can("handover:act") ? (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line-2 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/handover/${sel.id}/qr.svg`} alt={t("رمز QR للاستلام", "Handover QR code")} className="size-36 rounded-lg border border-line-2" />
                  <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">
                    <p className="flex items-center gap-1.5 font-semibold text-navy-800"><QrCode className="size-4" />{t("رمز الاستلام", "Handover QR")}</p>
                    <p className="mt-1">{t("يفتح الرمز صفحة المسح، ويتطلب تسجيل دخول بحساب مخوّل من نفس المنشأة.", "The code opens the scan page and requires sign-in with an authorised account of the same facility.")}</p>
                    <a href={`/handover/scan/${sel.qrToken}`} className="mt-1 inline-block font-medium text-teal-700 hover:underline">{t("محاكاة المسح على هذا الجهاز", "Simulate a scan on this device")} →</a>
                  </div>
                </div>
              ) : null}
              {sel.qrToken ? <HandoverPanel token={sel.qrToken} /> : <p className="text-[12.5px] text-muted">{t("يمكنك متابعة حالة الاستلام فقط؛ الإجراءات من صلاحية فريق المنشأة.", "You can follow handover status only; actions belong to facility staff.")} <StatusBadge group="handover" value={sel.status} /></p>}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export default function HandoverPage() {
  return (
    <Suspense>
      <HandoverInner />
    </Suspense>
  );
}
