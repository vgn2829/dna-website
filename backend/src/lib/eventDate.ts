export const IST_OFFSET_MINUTES = 330;
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const RSVP_WINDOW_MS = 2 * HOUR_MS;

export type EventDateInput = {
  date: string;
  time: string;
  startsAt?: string | null;
};

export type EventStatus = 'upcoming' | 'live' | 'past';

function dateParts(dateStr: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth ? [year, month, day] : null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function parseIstDate(dateStr: string): number {
  const parts = dateParts(dateStr);
  if (!parts) return Number.NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 0, -IST_OFFSET_MINUTES);
}

type ClockTime = { hour: number; minute: number; totalMinutes: number; meridiem?: string };

function parseClock(hourValue: number, minute: number, meridiem?: string): ClockTime | null {
  let hour = hourValue;
  const normalizedMeridiem = meridiem?.toUpperCase();
  if (normalizedMeridiem === 'PM' && hour < 12) hour += 12;
  if (normalizedMeridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || hourValue < 0 || minute < 0) return null;
  return { hour, minute, totalMinutes: hour * 60 + minute, meridiem: normalizedMeridiem };
}

function parseClockValues(timeStr: string): ClockTime[] {
  const matches = [...timeStr.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi)];
  if (matches.length === 0) return [];
  const trailingMeridiem = /\b(AM|PM)\b/i.exec(timeStr)?.[1];
  return matches
    .map(match => parseClock(Number(match[1]), Number(match[2] ?? 0), match[3] ?? trailingMeridiem))
    .filter((value): value is ClockTime => value !== null);
}

export function validateEventTime(timeStr: string): boolean {
  const values = parseClockValues(timeStr.trim());
  if (values.length === 0) return false;
  if (values.length >= 2 && values[1].totalMinutes < values[0].totalMinutes) {
    const crossesMidnight = values[0].meridiem === 'PM' && values[1].meridiem === 'AM';
    if (!crossesMidnight) return false;
  }
  return true;
}

function parseTimeOnIstDate(dateStr: string, timeStr: string): number | null {
  const date = dateParts(dateStr);
  const time = parseClockValues(timeStr);
  if (!date || time.length === 0) return null;
  return Date.UTC(date[0], date[1] - 1, date[2], time[0].hour, time[0].minute - IST_OFFSET_MINUTES);
}

/**
 * Resolve an event's start instant. `startsAt` is authoritative when valid.
 * Legacy rows without it use the first time in the free-text `time` field;
 * if no parseable time exists, the date is treated as noon IST for backwards
 * compatibility. Invalid calendar dates return NaN and are never treated as
 * a valid upcoming start.
 */
export function parseEventStart(event: EventDateInput): number {
  if (event.startsAt) {
    const instant = new Date(event.startsAt).getTime();
    if (Number.isFinite(instant)) return instant;
  }
  return parseTimeOnIstDate(event.date, event.time) ?? parseIstDate(event.date) + 12 * HOUR_MS;
}

export function getEventStatus(event: EventDateInput, now = Date.now()): EventStatus {
  const start = parseEventStart(event);
  if (!Number.isFinite(start)) return 'past';
  const cutoff = start + RSVP_WINDOW_MS;
  if (now < start) return 'upcoming';
  if (now < cutoff) return 'live';
  return 'past';
}

export function formatEventDate(dateStr: string): string {
  const parts = dateParts(dateStr);
  return parts ? `${String(parts[2]).padStart(2, '0')}/${String(parts[1]).padStart(2, '0')}/${parts[0]}` : dateStr;
}

export function parseAdminDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const candidate = `${match[3]}-${match[2]}-${match[1]}`;
  return dateParts(candidate) ? candidate : null;
}
