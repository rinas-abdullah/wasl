"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe, LogIn, ShieldCheck } from "lucide-react";
import { api, ApiError, NO_AUTO_DEMO_KEY } from "@/lib/api";
import { setLocale, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Button, Field, Input } from "@/components/ui";

const schema = z.object({ email: z.email(), password: z.string().min(1), remember: z.boolean() });
type Form = z.infer<typeof schema>;

const ROLE_ORDER = ["OPERATIONS_MANAGER", "DOCK_SUPERVISOR", "QUALITY_OFFICER", "ORGANIZATION_ADMIN", "CARRIER_OPERATOR", "DRIVER", "AUDITOR"];

function LoginInner() {
  const t = useT();
  const locale = useLocale();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ email: string; role: string }[]>([]);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ email: string; role: string }[]>("/api/auth/demo-accounts").then((d) => setDemo([...d].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)))).catch(() => setDemo([]));
  }, []);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", remember: false } });

  async function afterLogin() {
    try {
      sessionStorage.removeItem(NO_AUTO_DEMO_KEY);
    } catch {
      /* storage unavailable */
    }
    const next = params.get("next");
      const me = await api.get<{ permissions: string[] }>("/api/auth/me");
      const fallback = me.permissions.includes("dashboard:read") ? "/overview" : "/trucks";
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
  }

  async function demoLogin(email: string) {
    setError(null);
    setDemoBusy(email);
    try {
      await api.post("/api/auth/demo-login", { email });
      await afterLogin();
    } catch {
      setError(t("تعذر الدخول بالحساب التجريبي. حاول مرة أخرى.", "Could not sign in with the demo account. Try again."));
      setDemoBusy(null);
    }
  }

  async function onSubmit(v: Form) {
    setError(null);
    try {
      await api.post("/api/auth/login", v);
      await afterLogin();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t("محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.", "Too many attempts. Wait a minute and try again."));
      else setError(t("البريد الإلكتروني أو كلمة المرور غير صحيحة.", "Invalid email or password."));
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <p className="relative text-sm font-semibold tracking-[0.25em] text-teal-500">WASL · وَصل</p>
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
          <img src="/wasl-logo-trim.png" alt="وَصل | WASL" className="mb-10 h-14 w-auto self-start" />
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

          {demo.length ? (
            <div className="mt-8">
              <div className="flex items-center gap-3 text-[11.5px] text-muted"><span className="h-px flex-1 bg-line" />{t("أو جرّب المنصة بحساب تجريبي", "or try the platform with a demo account")}<span className="h-px flex-1 bg-line" /></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {demo.map((d) => (
                  <button key={d.email} type="button" disabled={!!demoBusy} onClick={() => demoLogin(d.email)} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-start text-[12px] text-ink-2 transition-colors hover:border-teal-500 hover:bg-teal-50 disabled:opacity-60">
                    <span className="truncate">{label("role", d.role, locale)}</span>
                    {demoBusy === d.email ? <span className="size-3 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" /> : <ShieldCheck className="size-3.5 shrink-0 text-teal-600" />}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("دخول بنقرة واحدة لحسابات تجريبية ببيانات اصطناعية — متاح في وضع التجربة فقط.", "One-click sign-in to demo accounts with synthetic data — available in demo mode only.")}</p>
            </div>
          ) : null}
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
