import type { Permission } from "@wasl/shared";
import {
  Activity, BarChart3, Bell, BookOpen, Boxes, Brain, Building2, CalendarClock, ClipboardCheck, Cpu, FlaskConical, GitBranch, History, LayoutDashboard, QrCode, Radar, Scale, ShieldCheck, Thermometer, Truck, Users, Warehouse,
} from "lucide-react";

export interface NavItem { href: string; ar: string; en: string; icon: typeof Truck; perm: Permission }
export interface NavGroup { ar: string; en: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    ar: "العمليات", en: "Operations",
    items: [
      { href: "/overview", ar: "نظرة عامة", en: "Overview", icon: LayoutDashboard, perm: "dashboard:read" },
      { href: "/live", ar: "العمليات المباشرة", en: "Live operations", icon: Activity, perm: "dashboard:read" },
      { href: "/twin", ar: "التوأم الرقمي", en: "Digital twin", icon: Radar, perm: "dashboard:read" },
      { href: "/trucks", ar: "الشاحنات", en: "Trucks", icon: Truck, perm: "trucks:read" },
      { href: "/schedule", ar: "جدول المواعيد", en: "Appointments", icon: CalendarClock, perm: "trucks:read" },
      { href: "/docks", ar: "إدارة الأرصفة", en: "Dock management", icon: Warehouse, perm: "docks:read" },
      { href: "/resources", ar: "تخطيط الموارد", en: "Resource planning", icon: Boxes, perm: "resources:read" },
    ],
  },
  {
    ar: "ذكاء القرار", en: "Decision intelligence",
    items: [
      { href: "/readiness", ar: "محرك الجاهزية", en: "Readiness engine", icon: ShieldCheck, perm: "readiness:evaluate" },
      { href: "/optimization", ar: "مركز التحسين", en: "Optimization center", icon: GitBranch, perm: "trucks:read" },
      { href: "/simulation", ar: "مختبر المحاكاة", en: "Simulation lab", icon: FlaskConical, perm: "simulation:read" },
      { href: "/decisions", ar: "مركز القرارات", en: "Decision center", icon: Scale, perm: "dashboard:read" },
      { href: "/models", ar: "نماذج الذكاء الاصطناعي", en: "AI models", icon: Brain, perm: "models:read" },
    ],
  },
  {
    ar: "الجودة والاستلام", en: "Quality & handover",
    items: [
      { href: "/quality", ar: "جودة الشحنات", en: "Shipment quality", icon: ClipboardCheck, perm: "quality:read" },
      { href: "/sensors", ar: "الحساسات الافتراضية", en: "Virtual sensors", icon: Thermometer, perm: "quality:read" },
      { href: "/handover", ar: "مركز الاستلام", en: "Handover center", icon: QrCode, perm: "handover:read" },
    ],
  },
  {
    ar: "التحليلات", en: "Insights",
    items: [
      { href: "/analytics", ar: "التحليلات والتقارير", en: "Analytics & reports", icon: BarChart3, perm: "reports:read" },
      { href: "/events", ar: "سجل الأحداث", en: "Event timeline", icon: History, perm: "events:read" },
      { href: "/notifications", ar: "التنبيهات", en: "Notifications", icon: Bell, perm: "notifications:read" },
    ],
  },
  {
    ar: "الإدارة", en: "Administration",
    items: [
      { href: "/settings", ar: "إعدادات المنشأة", en: "Organization settings", icon: Building2, perm: "dashboard:read" },
      { href: "/users", ar: "إدارة المستخدمين", en: "User management", icon: Users, perm: "users:read" },
      { href: "/help", ar: "المساعدة والتوثيق", en: "Help & documentation", icon: BookOpen, perm: "notifications:read" },
    ],
  },
];
export const ALL_NAV = NAV.flatMap((g) => g.items);
export { Cpu };
