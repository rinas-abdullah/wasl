import type { SensorEventType, Severity } from "@wasl/shared";
import type { Reading, Thresholds } from "./generator";

export interface DetectedEvent {
  type: SensorEventType;
  ruleId: string;
  startedAt: Date;
  endedAt: Date;
  peakValue: number | null;
  threshold: number | null;
  readingsCount: number;
  severity: Severity;
  requiresReview: boolean;
  description: string;
  descriptionAr: string;
}

/**
 * Threshold rules (documented in docs/METHODOLOGY.md):
 *  R-TEMP-01  ≥2 consecutive readings (≥10 min) outside [tempMin, tempMax]
 *  R-HUM-01   ≥3 consecutive readings above humidityMax
 *  R-SHOCK-01 any single reading above shockMax
 *  R-MISS-01  ≥3 consecutive missing readings (≥15 min) — conditions cannot be confirmed
 * A single out-of-range temperature reading is treated as noise (no event).
 */
export function detectEvents(readings: Reading[], th: Thresholds): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  const runs = <T>(pred: (r: Reading) => boolean, minLen: number, make: (seg: Reading[]) => T | null) => {
    let seg: Reading[] = [];
    const flush = () => {
      if (seg.length >= minLen) {
        const e = make(seg);
        if (e) events.push(e as unknown as DetectedEvent);
      }
      seg = [];
    };
    for (const r of readings) {
      if (pred(r)) seg.push(r);
      else flush();
    }
    flush();
  };

  const outTemp = (r: Reading) => !r.missing && r.temperatureC !== null && ((th.tempMaxC !== undefined && r.temperatureC > th.tempMaxC) || (th.tempMinC !== undefined && r.temperatureC < th.tempMinC));
  runs(outTemp, 2, (seg) => {
    const high = seg.some((r) => th.tempMaxC !== undefined && r.temperatureC! > th.tempMaxC);
    const peak = high ? Math.max(...seg.map((r) => r.temperatureC!)) : Math.min(...seg.map((r) => r.temperatureC!));
    const limit = high ? th.tempMaxC! : th.tempMinC!;
    const minutes = (seg.at(-1)!.ts.getTime() - seg[0].ts.getTime()) / 60_000 + 5;
    const severity: Severity = Math.abs(peak - limit) > 3 || minutes >= 30 ? "HIGH" : "MEDIUM";
    return { type: "TEMP_EXCURSION", ruleId: "R-TEMP-01", startedAt: seg[0].ts, endedAt: seg.at(-1)!.ts, peakValue: peak, threshold: limit, readingsCount: seg.length, severity, requiresReview: true, description: `Temperature ${high ? "above" : "below"} ${limit}°C for ~${minutes} min (peak ${peak.toFixed(1)}°C)`, descriptionAr: `درجة الحرارة ${high ? "أعلى من" : "أدنى من"} ${limit}°م لمدة ~${minutes} دقيقة (الذروة ${peak.toFixed(1)}°م)` };
  });
  if (th.humidityMaxPct !== undefined) {
    runs((r) => !r.missing && r.humidityPct !== null && r.humidityPct > th.humidityMaxPct!, 3, (seg) => {
      const peak = Math.max(...seg.map((r) => r.humidityPct!));
      return { type: "HUMIDITY_EXCURSION", ruleId: "R-HUM-01", startedAt: seg[0].ts, endedAt: seg.at(-1)!.ts, peakValue: peak, threshold: th.humidityMaxPct!, readingsCount: seg.length, severity: "MEDIUM", requiresReview: true, description: `Humidity above ${th.humidityMaxPct}% (peak ${peak}%)`, descriptionAr: `الرطوبة أعلى من ${th.humidityMaxPct}% (الذروة ${peak}%)` };
    });
  }
  if (th.shockMaxG !== undefined) {
    for (const r of readings) {
      if (!r.missing && r.shockG !== null && r.shockG > th.shockMaxG) {
        events.push({ type: "SHOCK", ruleId: "R-SHOCK-01", startedAt: r.ts, endedAt: r.ts, peakValue: r.shockG, threshold: th.shockMaxG, readingsCount: 1, severity: r.shockG > th.shockMaxG * 1.5 ? "HIGH" : "MEDIUM", requiresReview: true, description: `Shock ${r.shockG}g exceeds ${th.shockMaxG}g`, descriptionAr: `صدمة ${r.shockG}g تتجاوز ${th.shockMaxG}g` });
      }
    }
  }
  runs((r) => r.missing, 3, (seg) => {
    const minutes = (seg.at(-1)!.ts.getTime() - seg[0].ts.getTime()) / 60_000 + 5;
    return { type: "MISSING_DATA", ruleId: "R-MISS-01", startedAt: seg[0].ts, endedAt: seg.at(-1)!.ts, peakValue: null, threshold: null, readingsCount: seg.length, severity: "MEDIUM", requiresReview: true, description: `${minutes} min without readings — conditions cannot be confirmed`, descriptionAr: `${minutes} دقيقة بلا قراءات — لا يمكن تأكيد الظروف` };
  });
  return events.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
