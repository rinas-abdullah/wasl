"use client";
import { use } from "react";
import { useT } from "@/lib/i18n";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { HandoverPanel } from "@/components/handover-panel";

export default function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  return (
    <>
      <PageHeader title={t("مسح رمز الاستلام", "Handover scan")} description={t("تم التحقق من جلستك. يعرض الخادم فقط ما تسمح به صلاحياتك لهذه المنشأة.", "Your session was verified. The server shows only what your permissions allow for this facility.")} />
      <Card className="mx-auto max-w-2xl">
        <CardHeader title={t("سجل الاستلام", "Handover record")} />
        <CardBody><HandoverPanel token={token} /></CardBody>
      </Card>
    </>
  );
}
