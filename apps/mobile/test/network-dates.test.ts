import { describe, expect, it } from 'vitest';
import {
  localDateTime,
  possibleInstants,
  timezoneLabel,
} from '../src/features/network/date-fields';

describe('human date controls retain explicit instant authority', () => {
  it('converts a chosen local meeting time in its selected timezone', () => {
    expect(possibleInstants('2026-10-28T15:00', 'Europe/Skopje')).toEqual([
      '2026-10-28T14:00:00.000Z',
    ]);
    expect(localDateTime('2026-10-28T14:00:00Z', 'Europe/Skopje')).toBe('2026-10-28T15:00');
    expect(timezoneLabel('America/New_York')).toBe('New York · America');
  });
  it('does not normalize a nonexistent daylight-saving local time into another time', () => {
    expect(possibleInstants('2026-03-08T02:30', 'America/New_York')).toEqual([]);
    expect(possibleInstants('2026-10-04T02:15', 'Australia/Lord_Howe')).toEqual([]);
  });
  it('exposes both autumn occurrences instead of silently choosing one', () => {
    expect(possibleInstants('2026-11-01T01:30', 'America/New_York')).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
    const halfHour = possibleInstants('2026-04-05T01:45', 'Australia/Lord_Howe');
    expect(halfHour).toHaveLength(2);
    expect(Date.parse(halfHour[1]) - Date.parse(halfHour[0])).toBe(30 * 60000);
  });
  it('handles non-hour offsets and rejects impossible or incomplete calendar dates', () => {
    expect(possibleInstants('2026-10-28T09:00', 'Asia/Kathmandu')).toEqual([
      '2026-10-28T03:15:00.000Z',
    ]);
    for (const value of ['2026-02-30T12:00', '2026-11-01', '2026-11-01T25:00'])
      expect(possibleInstants(value, 'UTC')).toEqual([]);
  });
});
