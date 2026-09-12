import { describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  isSameUtcMonth,
  nowUtc,
  parseUtc,
  shardName,
  toUtcIso,
  yearMonthUtc
} from '../src/domain/time';

describe('nowUtc', () => {
  test('ends in Z and holds no millisecond part', () => {
    const value = nowUtc();

    expect(value.endsWith('Z')).toBe(true);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(value.includes('.')).toBe(false);
  });

  test('parses back to a Date', () => {
    expect(parseUtc(nowUtc())).toBeInstanceOf(Date);
  });
});

describe('toUtcIso', () => {
  test('drops milliseconds and keeps the UTC instant', () => {
    expect(toUtcIso(new Date('2026-09-01T06:30:00.456Z'))).toBe('2026-09-01T06:30:00Z');
  });

  test('rejects an invalid Date', () => {
    expect(() => toUtcIso(new Date('nope'))).toThrow(AppError);
  });
});

describe('parseUtc', () => {
  test('accepts a UTC timestamp with whole seconds', () => {
    expect(parseUtc('2026-09-01T06:30:00Z').getTime()).toBe(
      Date.parse('2026-09-01T06:30:00Z')
    );
  });

  test('accepts fractional seconds', () => {
    expect(parseUtc('2026-09-01T06:30:00.123Z').getTime()).toBe(
      Date.parse('2026-09-01T06:30:00.123Z')
    );
  });

  test('rejects a value with a local offset', () => {
    let caught: unknown;
    try {
      parseUtc('2026-08-15T07:30:00-07:00');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).kind).toBe('invalid_document');
  });

  test('rejects a value with no zone designator at all', () => {
    expect(() => parseUtc('2026-08-15T07:30:00')).toThrow(AppError);
  });

  test('rejects a string that is not a date-time', () => {
    expect(() => parseUtc('last tuesdayZ')).toThrow(AppError);
  });
});

describe('yearMonthUtc', () => {
  test('reads the UTC month', () => {
    expect(yearMonthUtc('2026-09-01T06:30:00Z')).toBe('2026-09');
    expect(yearMonthUtc('2026-12-31T23:59:59Z')).toBe('2026-12');
  });

  test('keeps the UTC month across a local month boundary', () => {
    // 2026-09-01T06:30:00Z is 2026-08-31 late evening in UTC-07:00.
    expect(yearMonthUtc('2026-09-01T06:30:00Z')).toBe('2026-09');
  });
});

describe('shardName', () => {
  test('builds the monthly shard file name', () => {
    expect(shardName('2026-09-01T06:30:00Z')).toBe('results-2026-09.json');
  });

  test('rejects a non-UTC start', () => {
    expect(() => shardName('2026-09-01T06:30:00+02:00')).toThrow(AppError);
  });
});

describe('isSameUtcMonth', () => {
  test('is true inside one UTC month', () => {
    expect(isSameUtcMonth('2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z')).toBe(true);
  });

  test('is false across a UTC month boundary', () => {
    expect(isSameUtcMonth('2026-08-31T23:59:59Z', '2026-09-01T00:00:00Z')).toBe(false);
  });
});
