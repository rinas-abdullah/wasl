"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useCan, useSession } from "@/lib/session";
import { Button, Card, CardBody, CardHeader, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader } from "@/components/ui";
import type { AnyRec } from "@/components/domain";

export default function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const can = useCan();
  const session = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<AnyRec>("/api/settings") });
  const [v, setV] = useState<AnyRec | null>(null);
  useEffect(() => { if (q.data && !v) setV({ yardCapacity: q.data.yardCapacity, gateCapacityPerHour: q.data.gateCapacityPerHour, travelTimeMin: q.data.travelTimeMin, congestionThreshold: q.data.congestionThreshold, defaultWeights: q.data.defaultWeights }); }, [q.data, v]);
  const save = useMutation({ mutationFn: () => api.patch("/api/settings", v), onSuccess: () => { toast.success(t("حُفظت الإعدادات وسُجلت في سجل التدقيق", "Settings saved and recorded in the audit log")); qc.invalidateQueries(); }, onError: (e) => toast.error((e as Error).message) });
  if (q.isLoading || !v) return <Card><LoadingBlock rows={6} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} /></Card>;
  const editable = can("settings:manage");
  const num = (k: string) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) }), disabled: !editable, type: "number", dir: "ltr" as const });
  return (
    <>
      <PageHeader title={t("إعدادات المنشأة", "Organization settings")} description={t("معلمات تشغيلية تستخدمها محركات الجاهزية والتحسين والتوأم الرقمي مباشرة. أي تغيير يرفع إصدار حالة المنشأة ويجعل الخطط المحسوبة سابقًا تُعاد مراجعتها.", "Operational parameters read directly by the readiness, optimisation and twin engines. Any change bumps the facility state version so previously computed plans are re-validated.")} actions={editable ? <Button loading={save.isPending} onClick={() => save.mutate()}><Save />{t("حفظ", "Save")}</Button> : null} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("المنظمة والمنشأة", "Organization & facility")} />
          <CardBody>
            <KeyValue items={[{ k: t("المنظمة", "Organization"), v: locale === "ar" ? session.organization.nameAr : session.organization.name }, { k: t("المنشأة", "Facility"), v: locale === "ar" ? q.data!.nameAr : q.data!.name }, { k: t("الرمز", "Code"), v: q.data!.code }, { k: t("المدينة", "City"), v: q.data!.city }, { k: t("المنطقة الزمنية", "Time zone"), v: q.data!.timezone }, { k: t("إصدار الحالة", "State version"), v: <span className="num">#{q.data!.stateVersion}</span> }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("السعة التشغيلية", "Operational capacity")} subtitle={!editable ? t("للقراءة فقط — يتطلب صلاحية إدارة الإعدادات", "Read-only — requires settings:manage") : undefined} />
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label={t("سعة الساحة (شاحنات)", "Yard capacity (trucks)")} htmlFor="yc"><Input id="yc" {...num("yardCapacity")} /></Field>
            <Field label={t("سعة البوابة (شاحنة/ساعة)", "Gate capacity (trucks/hour)")} htmlFor="gc"><Input id="gc" {...num("gateCapacityPerHour")} /></Field>
            <Field label={t("زمن الطريق بعد الاستدعاء (د)", "Travel time after call (min)")} htmlFor="tt"><Input id="tt" {...num("travelTimeMin")} /></Field>
            <Field label={t("عتبة الاختناق (طول الطابور)", "Congestion threshold (queue length)")} htmlFor="ct"><Input id="ct" {...num("congestionThreshold")} /></Field>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={t("أوزان دالة الهدف الافتراضية", "Default objective weights")} subtitle={t("بوحدة «دقائق انتظار مكافئة». سياسة تشغيلية قابلة للضبط وليست قيمًا مثالية علميًا.", "In “equivalent waiting minutes”. An adjustable operating policy, not scientifically optimal values.")} />
          <CardBody className="grid gap-4 md:grid-cols-3">
            {Object.entries(v.defaultWeights as Record<string, number>).map(([k, val]) => <Field key={k} label={k} htmlFor={k}><Input id={k} type="number" step="0.1" dir="ltr" disabled={!editable} value={val} onChange={(e) => setV({ ...v, defaultWeights: { ...v.defaultWeights, [k]: Number(e.target.value) } })} /></Field>)}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
