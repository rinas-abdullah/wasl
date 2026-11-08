"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Badge, Card, CardBody, CardHeader, PageHeader, SyntheticBadge } from "@/components/ui";

const STEPS: [string, string, string, string][] = [
  ["/overview", "افتح لوحة التحكم ولاحظ المؤشرات المشتقة من البيانات.", "Open the dashboard and review indicators derived from stored data.", "ops"],
  ["/trucks", "اطّلع على الشاحنات وسجّل شاحنة جديدة بمتطلبات شحنتها.", "Browse trucks and register a new truck with its shipment requirements.", "ops"],
  ["/schedule", "اسحب الشاحنة الجديدة إلى رصيف وتوقيت وأكّد الموعد بعد تحقق الخادم.", "Drag the new truck onto a dock and time; confirm after server validation.", "ops"],
  ["/twin", "ادخل إلى التوأم الرقمي وانقر على رصيف وشاحنة.", "Enter the digital twin and click a dock and a truck.", "ops"],
  ["/docks", "عطّل الرصيف D3 مع سبب، ولاحظ الشاحنات المتأثرة ومنع التخصيص الجديد.", "Disable dock D3 with a reason; note affected trucks and blocked assignments.", "ops/dock"],
  ["/optimization", "راجع خطة إعادة التخطيط التي أنشأها المحلل تلقائيًا أو شغّل تحسينًا جديدًا، وافحص أسباب كل تخصيص.", "Review the re-plan the solver created automatically (or run one) and inspect each assignment's reasons.", "ops"],
  ["/optimization", "قارن الخطة الحالية بالمقترحة ثم اعتمدها.", "Compare current vs. proposed and approve the plan.", "ops"],
  ["/simulation", "شغّل محاكاة «تعطل رصيف» وقارن السياسات الأربع بفترات ثقة.", "Run the “Dock failure” simulation and compare the four policies with CIs.", "ops"],
  ["/sensors", "ولّد تجاوزًا حراريًا لشحنة WSL-1007 (أدوية) ولاحظ إنشاء طلب مراجعة جودة.", "Generate a temperature excursion for WSL-1007 (pharma) and see the quality review appear.", "quality"],
  ["/readiness", "افحص جاهزية WSL-1007: مراجعة يدوية مطلوبة. بعد بدء المراجعة بحساب الجودة تعود جاهزة.", "Check WSL-1007 readiness: manual review required. After the quality officer starts the review it becomes READY.", "ops/quality"],
  ["/readiness", "أصدر الاستدعاء عندما تتحقق الشروط (جرّب WSL-1005: تأجيل حتى يتوفر الفريق المؤهل).", "Release when conditions are met (try WSL-1005: on hold until the qualified crew is free).", "dock"],
  ["/handover", "وثّق الوصول والتفريغ والاعتماد والإغلاق عبر رمز QR.", "Record arrival, unloading, approval and closure via the QR handover.", "dock"],
  ["/events", "افتح سجل الأحداث وتحقق من تسجيل كل العمليات.", "Open the event log and verify every operation was recorded.", "auditor"],
  ["/analytics", "افتح التقارير وتحقق من اتساقها مع ما حدث.", "Open the reports and check they are consistent with what happened.", "ops"],
];

export default function HelpPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("المساعدة والتوثيق", "Help & documentation")} description={t("دليل التجربة للمحكّمين، وكيف تعمل الدورة التشغيلية، ومصادر البيانات والقيود المعروفة.", "Judge walkthrough, how the decision loop works, data provenance and known limitations.")} actions={<a href="/api/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-teal-700 hover:underline">OpenAPI <ExternalLink className="size-3.5" /></a>} />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={t("سيناريو التجربة (≈ 10 دقائق)", "Demo walkthrough (≈ 10 minutes)")} subtitle={t("حسابات التجربة: ops / dock / quality / admin / carrier / driver / auditor @demo.wasl.sa — كلمة المرور في DEMO_GUIDE.md. يمكن إعادة الضبط من شارة «وضع التجربة».", "Demo accounts: ops / dock / quality / admin / carrier / driver / auditor @demo.wasl.sa — password in DEMO_GUIDE.md. Reset from the “Demo mode” chip.")} />
          <CardBody>
            <ol className="space-y-2.5">
              {STEPS.map(([href, ar, en, role], i) => (
                <li key={i} className="flex gap-3">
                  <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-navy-800 text-[11px] font-semibold text-white">{i + 1}</span>
                  <div className="text-[13px] leading-relaxed"><Link href={href} className="font-medium text-navy-800 hover:text-teal-700 hover:underline">{t(ar, en)}</Link> <Badge tone="neutral">{role}</Badge></div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("دورة القرار", "Decision loop")} />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
              <p><b>{t("تقدير", "Predict")}</b> — {t("نموذج مدة الخدمة ونموذج خطر الاختناق (scikit-learn، بيانات اصطناعية).", "Service-time and congestion-risk models (scikit-learn, synthetic data).")}</p>
              <p><b>{t("تحسين", "Optimize")}</b> — {t("OR-Tools CP-SAT للرصيف والفريق ووقت البدء ضمن القيود.", "OR-Tools CP-SAT for dock, crew and start time under constraints.")}</p>
              <p><b>{t("محاكاة", "Simulate")}</b> — {t("SimPy بأربع سياسات وبذور قابلة لإعادة الإنتاج.", "SimPy with four policies and reproducible seeds.")}</p>
              <p><b>{t("تحقق", "Verify")}</b> — {t("محرك الجاهزية: 13 شرطًا على الخادم.", "Readiness engine: 13 server-side checks.")}</p>
              <p><b>{t("استدعاء", "Release")}</b> — {t("حجز ذري للموارد مع قيد منع التداخل في قاعدة البيانات.", "Atomic resource reservation with a database no-overlap constraint.")}</p>
              <p><b>{t("تعلّم", "Learn")}</b> — {t("تُسجل الأزمنة الفعلية مقابل المقدرة في التقارير؛ إعادة التدريب على بيانات حقيقية غير منفذة بعد.", "Actual vs. estimated times are recorded in reports; retraining on real data is not implemented yet.")}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("مصادر البيانات", "Data provenance")} />
            <CardBody className="space-y-2 text-[12.5px]">
              <p><SyntheticBadge kind="demo" /> {t("سجلات تشغيلية مزروعة ومحدثة بأفعال المستخدمين.", "Seeded operational records updated by user actions.")}</p>
              <p><SyntheticBadge kind="simulation" /> {t("نتائج محسوبة من تشغيلات SimPy محفوظة.", "Results computed from stored SimPy runs.")}</p>
              <p><SyntheticBadge kind="model" /> {t("تقديرات نماذج تجريبية.", "Experimental model estimates.")}</p>
              <p><SyntheticBadge kind="synthetic" /> {t("قراءات حساسات افتراضية بالكامل.", "Fully virtual sensor readings.")}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("قيود معروفة", "Known limitations")} />
            <CardBody>
              <ul className="list-disc space-y-1.5 ps-5 text-[12.5px] leading-relaxed text-ink-2">
                <li>{t("لا يوجد مستودع حقيقي متصل ولا حساسات مادية؛ كل البيانات اصطناعية.", "No real warehouse or physical sensors are connected; all data is synthetic.")}</li>
                <li>{t("النماذج مدربة على عملية توليد معلنة؛ لا تثبت الدقة على بيانات حقيقية.", "Models are trained on a declared generating process; accuracy on real data is unproven.")}</li>
                <li>{t("نتائج المحاكاة لا تثبت الأداء في مستودع حقيقي، وفي بعض السيناريوهات تكون سياسة FCFS أفضل في التأخير الكلي.", "Simulation results do not prove real-warehouse performance; in some scenarios FCFS is better on total delay.")}</li>
                <li>{t("التحديثات المباشرة تفترض نسخة API واحدة (حافلة داخلية).", "Live updates assume a single API instance (in-process bus).")}</li>
                <li>{t("لا يوجد إرسال بريد أو SMS أو WhatsApp.", "No email, SMS or WhatsApp delivery.")}</li>
                <li>{t("تصدير PDF عبر طباعة المتصفح.", "PDF export uses browser printing.")}</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
