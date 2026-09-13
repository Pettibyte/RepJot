import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { AppError } from '../src/domain/errors';
import {
  activeError,
  clearError,
  lastSavedAtUtc,
  reportError,
  saveStatus,
  setSaveStatus,
  setStartupStatus,
  startupStatus
} from '../src/state/app-state';

describe('saveStatus', () => {
  test('idle -> saving -> saved', () => {
    setSaveStatus('idle');
    expect(get(saveStatus)).toBe('idle');

    setSaveStatus('saving');
    expect(get(saveStatus)).toBe('saving');

    setSaveStatus('saved');
    expect(get(saveStatus)).toBe('saved');
  });

  test('saving -> sync_failed', () => {
    setSaveStatus('saving');
    setSaveStatus('sync_failed');

    expect(get(saveStatus)).toBe('sync_failed');
  });

  test('sync_failed -> saving -> saved recovers after a retry', () => {
    setSaveStatus('saving');
    setSaveStatus('sync_failed');
    setSaveStatus('saving');
    setSaveStatus('saved');

    expect(get(saveStatus)).toBe('saved');
  });
});

describe('lastSavedAtUtc', () => {
  test('a move to saved stamps a UTC timestamp', () => {
    setSaveStatus('saving');
    setSaveStatus('saved');

    expect(get(lastSavedAtUtc)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test('a move to saving leaves the earlier stamp alone', () => {
    setSaveStatus('saved');
    const stamp = get(lastSavedAtUtc);

    setSaveStatus('saving');
    expect(get(lastSavedAtUtc)).toBe(stamp);

    setSaveStatus('sync_failed');
    expect(get(lastSavedAtUtc)).toBe(stamp);
  });
});

describe('startupStatus', () => {
  test('reports each startup state', () => {
    setStartupStatus('loading_static');
    expect(get(startupStatus)).toBe('loading_static');

    setStartupStatus('ready');
    expect(get(startupStatus)).toBe('ready');

    setStartupStatus('blocked');
    expect(get(startupStatus)).toBe('blocked');

    setStartupStatus('static_failed');
    expect(get(startupStatus)).toBe('static_failed');
  });
});

describe('activeError', () => {
  test('reportError sets the error and clearError clears it', () => {
    const error = new AppError('storage', { reason: 'quota' });

    reportError(error);
    expect(get(activeError)).toBe(error);

    clearError();
    expect(get(activeError)).toBeNull();
  });

  test('a new reportError replaces the earlier one', () => {
    reportError(new AppError('network'));
    const second = new AppError('drive_rate_limit');
    reportError(second);

    expect(get(activeError)).toBe(second);
  });
});

describe('store views', () => {
  test('the exported stores expose no write side', () => {
    const views: unknown[] = [saveStatus, startupStatus, lastSavedAtUtc, activeError];

    for (const view of views) {
      const candidate = view as { set?: unknown; update?: unknown; subscribe?: unknown };
      expect(candidate.subscribe).toBeTypeOf('function');
      expect(candidate.set).toBeUndefined();
      expect(candidate.update).toBeUndefined();
    }
  });
});
