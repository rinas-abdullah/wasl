import type { CargoType, SensorScenario } from "@wasl/shared";

export const GENERATOR_VERSION = "vsensor-1.0.0";
export const INTERVAL_SEC = 300;

/** Deterministic PRNG (mulberry32). Same seed ⇒ same series. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Thresholds {
  tempMinC?: number;
  tempMaxC?: number;
  humidityMaxPct?: number;
  shockMaxG?: number;
}

/** Default thresholds by cargo when the shipment does not specify required conditions. */
export const DEFAULT_THRESHOLDS: Record<CargoType, Thresholds> = {
  GENERAL: { tempMaxC: 35, humidityMaxPct: 85, shockMaxG: 3.5 },
  BULK: { tempMaxC: 40, humidityMaxPct: 90, shockMaxG: 5 },
  FRAGILE: { tempMaxC: 35, humidityMaxPct: 80, shockMaxG: 2 },
  CHILLED: { tempMinC: 2, tempMaxC: 8, humidityMaxPct: 90, shockMaxG: 3 },
  FROZEN: { tempMinC: -25, tempMaxC: -15, humidityMaxPct: 95, shockMaxG: 3 },
  PHARMA: { tempMinC: 2, tempMaxC: 8, humidityMaxPct: 65, shockMaxG: 2.5 },
};

export function resolveThresholds(cargo: CargoType, required: Thresholds): Thresholds {
  return { ...DEFAULT_THRESHOLDS[cargo], ...Object.fromEntries(Object.entries(required).filter(([, v]) => v !== undefined && v !== null)) };
}

export interface Reading {
  ts: Date;
  temperatureC: number | null;
  humidityPct: number | null;
  shockG: number | null;
  vibrationRms: number | null;
  missing: boolean;
}

export interface GeneratedSeries {
  readings: Reading[];
  /** Ground truth of what was injected (for transparency in the UI, never used by detection). */
  injected: { kind: SensorScenario; startIndex: number | null; endIndex: number | null; peak?: number };
}

/**
 * Generates a synthetic journey time series ending at `end`. Every value is
 * software-generated; there are no physical sensors in WASL.
 */
export function generateSeries(scenario: SensorScenario, seed: number, end: Date, journeyMinutes: number, th: Thresholds): GeneratedSeries {
  const rand = mulberry32(seed);
  const n = Math.floor((journeyMinutes * 60) / INTERVAL_SEC) + 1;
  const start = end.getTime() - (n - 1) * INTERVAL_SEC * 1000;
  const target = th.tempMinC !== undefined && th.tempMaxC !== undefined ? (th.tempMinC + th.tempMaxC) / 2 : 24;
  const band = th.tempMinC !== undefined && th.tempMaxC !== undefined ? (th.tempMaxC - th.tempMinC) / 6 : 2;
  const readings: Reading[] = [];
  const injected: GeneratedSeries["injected"] = { kind: scenario, startIndex: null, endIndex: null };
  const winStart = Math.floor(n * (0.4 + rand() * 0.2));
  const winLen = scenario === "TEMP_EXCURSION" ? 5 + Math.floor(rand() * 5) : scenario === "MISSING_DATA" ? 5 + Math.floor(rand() * 4) : 1;
  const excursionPeak = (th.tempMaxC ?? 35) + 3 + rand() * 3;
  const shockPeak = (th.shockMaxG ?? 3) * (1.4 + rand() * 0.8);
  if (scenario !== "NORMAL") {
    injected.startIndex = winStart;
    injected.endIndex = Math.min(n - 1, winStart + winLen - 1);
    injected.peak = scenario === "TEMP_EXCURSION" ? excursionPeak : scenario === "SHOCK" ? shockPeak : undefined;
  }
  for (let i = 0; i < n; i++) {
    const ts = new Date(start + i * INTERVAL_SEC * 1000);
    const inWin = injected.startIndex !== null && i >= injected.startIndex && i <= injected.endIndex!;
    if (scenario === "MISSING_DATA" && inWin) {
      readings.push({ ts, temperatureC: null, humidityPct: null, shockG: null, vibrationRms: null, missing: true });
      continue;
    }
    let temp = target + Math.sin(i / 9) * band * 0.6 + gaussian(rand) * band * 0.35;
    if (scenario === "TEMP_EXCURSION" && inWin) {
      const k = (i - injected.startIndex!) / Math.max(1, winLen - 1);
      const shape = Math.sin(Math.PI * Math.min(1, Math.max(0, k * 0.9 + 0.05)));
      temp = target + (excursionPeak - target) * Math.max(0.75, shape);
    }
    const humidity = Math.min(99, Math.max(20, (th.humidityMaxPct ?? 80) - 18 + gaussian(rand) * 3));
    let shock = Math.abs(0.25 + gaussian(rand) * 0.12);
    let vib = Math.abs(0.3 + gaussian(rand) * 0.08);
    if (scenario === "SHOCK" && i === winStart) {
      shock = shockPeak;
      vib = 1.6 + rand();
    }
    readings.push({ ts, temperatureC: round(temp, 2), humidityPct: round(humidity, 1), shockG: round(shock, 2), vibrationRms: round(vib, 2), missing: false });
  }
  return { readings, injected };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
