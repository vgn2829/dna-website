import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  RSVP_WINDOW_MS,
  formatEventDate,
  getEventStatus,
  parseAdminDate,
  parseEventStart,
  parseIstDate,
  validateEventTime,
} from '../src/lib/eventDate';

const IST_EVENT = { date: '2026-08-07', time: '6–8 PM' };
const START = Date.UTC(2026, 7, 7, 12, 30);

describe('shared event date policy', () => {
  it('uses the exact starts_at instant and lifecycle boundaries', () => {
    const event = { ...IST_EVENT, startsAt: '2026-08-07T18:00:00+05:30' };
    expect(getEventStatus(event, START - 1)).toBe('upcoming');
    expect(getEventStatus(event, START)).toBe('live');
    expect(getEventStatus(event, START + RSVP_WINDOW_MS - 1)).toBe('live');
    expect(getEventStatus(event, START + RSVP_WINDOW_MS)).toBe('past');
  });

  it('parses legacy date/time records in IST', () => {
    expect(parseEventStart(IST_EVENT)).toBe(START);
    expect(getEventStatus(IST_EVENT, START - 1)).toBe('upcoming');
  });

  it('handles midnight and timezone boundaries without browser locale state', () => {
    const midnight = { date: '2026-08-08', time: '12:15 AM' };
    expect(parseEventStart(midnight)).toBe(Date.UTC(2026, 7, 7, 18, 45));
    expect(parseEventStart({ date: '2026-08-07', time: '6 PM', startsAt: '2026-08-07T18:00:00+05:30' })).toBe(START);
  });

  it('validates leap years and rejects invalid calendar dates', () => {
    expect(Number.isFinite(parseIstDate('2024-02-29'))).toBe(true);
    expect(Number.isNaN(parseIstDate('2023-02-29'))).toBe(true);
    expect(Number.isNaN(parseIstDate('2026-04-31'))).toBe(true);
  });

  it('formats and parses Indian admin dates', () => {
    expect(formatEventDate('2026-08-07')).toBe('07/08/2026');
    expect(parseAdminDate('07/08/2026')).toBe('2026-08-07');
    expect(parseAdminDate('29/02/2024')).toBe('2024-02-29');
    expect(parseAdminDate('29/02/2023')).toBeNull();
    expect(parseAdminDate('08/07/2026')).toBe('2026-07-08');
  });

  it('validates supported time labels and ranges', () => {
    expect(validateEventTime('6:00 PM – 8:30 PM')).toBe(true);
    expect(validateEventTime('18:00')).toBe(true);
    expect(validateEventTime('8 PM – 6 PM')).toBe(false);
    expect(validateEventTime('11 PM – 1 AM')).toBe(true);
    expect(validateEventTime('not a time')).toBe(false);
  });

  it('keeps duration constants explicit', () => {
    expect(DAY_MS).toBe(24 * HOUR_MS);
  });
});
