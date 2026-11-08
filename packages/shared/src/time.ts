/** Facility time zone used for the demo facility. All timestamps are stored in UTC. */
export const DEFAULT_TIMEZONE = "Asia/Riyadh";

export const MINUTE = 60_000;

export function addMinutes(d: Date | string, min: number): Date {
  return new Date(new Date(d).getTime() + min * MINUTE);
}

export function diffMinutes(a: Date | string, b: Date | string): number {
  return (new Date(a).getTime() - new Date(b).getTime()) / MINUTE;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Returns the UTC instant for the start of the local day in `timeZone` containing `at`. */
export function startOfLocalDay(at: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const localMidnightAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  const offset = tzOffsetMinutes(at, timeZone);
  return new Date(localMidnightAsUtc - offset * MINUTE);
}

/** Offset of `timeZone` from UTC in minutes at instant `at` (e.g. +180 for Asia/Riyadh). */
export function tzOffsetMinutes(at: Date, timeZone = DEFAULT_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** Combines a local "HH:MM" wall time on the local day of `day` into a UTC instant. */
export function localTimeOn(day: Date, hhmm: string, timeZone = DEFAULT_TIMEZONE): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return addMinutes(startOfLocalDay(day, timeZone), h * 60 + m);
}
