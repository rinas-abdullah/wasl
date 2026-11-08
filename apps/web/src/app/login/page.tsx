"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe, LogIn, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { setLocale, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Button, Field, Input } from "@/components/ui";

const schema = z.object({ email: z.email(), password: z.string().min(1), remember: z.boolean() });
type Form = z.infer<typeof schema>;

const DEMO = [
  { email: "ops@demo.wasl.sa", role: "OPERATIONS_MANAGER" },
  { email: "dock@demo.wasl.sa", role: "DOCK_SUPERVISOR" },
  { email: "quality@demo.wasl.sa", role: "QUALITY_OFFICER" },
  { email: "admin@demo.wasl.sa", role: "ORGANIZATION_ADMIN" },
  { email: "carrier@demo.wasl.sa", role: "CARRIER_OPERATOR" },
  { email: "driver@demo.wasl.sa", role: "DRIVER" },
  { email: "auditor@demo.wasl.sa", role: "AUDITOR" },
];

function LoginInner() {
  const t = useT();
  const locale = useLocale();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", remember: false } });

  async function onSubmit(v: Form) {
    setError(null);
    try {
      await api.post("/api/auth/login", v);
      const next = params.get("next");
      const me = await api.get<{ permissions: string[] }>("/api/auth/me");
      const fallback = me.permissions.includes("dashboard:read") ? "/overview" : "/trucks";
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t("محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.", "Too many attempts. Wait a minute and try again."));
      else setError(t("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "Invalid email or password."));
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <div className="relative inline-flex w-fit rounded-2xl bg-white px-5 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wasl-logo-trim.png" alt="وَصل | WASL" className="h-12 w-auto" />
        </div>
        <div className="relative max-w-lg">
          <p className="text-sm font-medium text-teal-500">{t("منظومة ذكاء تشغيلي وتوأم رقمي", "Operational decision intelligence & digital twin")}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-snug">{t("وجود موعد مؤكد للشاحنة لا يعني بالضرورة أن المنشأة جاهزة لاستقبالها.", "A confirmed appointment does not mean the facility is ready to receive the truck.")}</h1>
          <ol className="mt-8 grid grid-cols-3 gap-3 text-[12.5px]">
            {[["تقدير", "Predict"], ["تحسين", "Optimize"], ["محاكاة", "Simulate"], ["تحقق", "Verify"], ["استدعاء", "Release"], ["تعلّم", "Learn"]].map(([a, e], i) => (
              <li key={e} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <span className="num text-teal-500">0{i + 1}</span> <span className="ms-1">{locale === "ar" ? a : e}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-[#9fb4c6]">{t("نموذج أولي لهاكاثون نقل ثون 5 · بيانات اصطناعية · حساسات افتراضية · لا يوجد مستودع حقيقي متصل", "Naqlthon 5 prototype · synthetic data · virtual sensors · no real warehouse connected")}</p>
      </section>

      <section className="flex flex-col bg-surface">
        <div className="flex justify-end p-5">
          <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-line-2"><Globe className="size-4" />{locale === "ar" ? "English" : "العربية"}</button>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wasl-logo-trim.png" alt="وَصل | WASL" className="mb-8 h-11 w-auto self-start lg:hidden" />
          <h2 className="text-xl font-semibold text-navy-900">{t("تسجيل الدخول", "Sign in")}</h2>
          <p className="mt-1 text-[13px] text-muted">{t("ادخل إلى مركز القيادة التشغيلي لمنشأتك.", "Access your facility's operational command center.")}</p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
            <Field label={t("البريد الإلكتروني", "Email")} htmlFor="email" error={formState.errors.email ? t("أدخل بريدًا إلكترونيًا صحيحًا", "Enter a valid email") : null}>
              <Input id="email" type="email" autoComplete="username" dir="ltr" aria-invalid={!!formState.errors.email} {...register("email")} />
            </Field>
            <Field label={t("كلمة المرور", "Password")} htmlFor="password" error={formState.errors.password ? t("أدخل كلمة المرور", "Enter your password") : null}>
              <Input id="password" type="password" autoComplete="current-password" dir="ltr" aria-invalid={!!formState.errors.password} {...register("password")} />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" className="size-4 accent-[var(--color-teal-600)]" {...register("remember")} />
              {t("تذكر الجلسة على هذا الجهاز (14 يومًا)", "Remember this device (14 days)")}
            </label>
            {error ? <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-[12.5px] text-bad">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}><LogIn />{t("دخول", "Sign in")}</Button>
          </form>

          <div className="mt-8 rounded-xl border border-dashed border-teal-500/60 bg-teal-50/60 p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-700"><ShieldCheck className="size-4" />{t("دخول المحكّمين — حسابات تجريبية", "Judges — demo accounts")}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{t("كلمة المرور موضحة في دليل التجربة (DEMO_GUIDE.md). اختر دورًا لتعبئة البريد:", "The password is listed in DEMO_GUIDE.md. Pick a role to fill the email:")}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {DEMO.map((d) => (
                <button key={d.email} type="button" onClick={() => setValue("email", d.email, { shouldValidate: true })} className="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-2 hover:border-teal-500">
                  {label("role", d.role, locale)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
