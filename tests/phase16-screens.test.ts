// Render tests for the Phase 16 screens and components.
// PHASE-16 checklist: the landing page carries the sign-in control and the
// privacy link, the chooser shows the three lists, the overview renders the
// tree read-only with a Start action, and an unresolved reference renders a
// data error without dropping the rows beside it.

import { afterEach, describe, expect, test } from 'bun:test';

import LandingScreen from '../src/ui/screens/LandingScreen.svelte';
import WorkoutChooserScreen from '../src/ui/screens/WorkoutChooserScreen.svelte';
import WorkoutOverviewScreen from '../src/ui/screens/WorkoutOverviewScreen.svelte';
import SessionListItem from '../src/ui/components/SessionListItem.svelte';
import WorkoutTreeReadOnly from '../src/ui/components/WorkoutTreeReadOnly.svelte';
import { clearServices, setServices } from '../src/services/registry';
import { clearRawPayloads } from '../src/state/raw-payload-store';
import type { SessionSummary } from '../src/indexes/types';
import type { Exercise, Workout } from '../src/domain/types';
import { exercises, workout } from './fixtures/semantic';
import { html } from './support/render';

afterEach(() => {
  clearServices();
  clearRawPayloads();
});

function exerciseIndex(list: Exercise[]): Map<string, Exercise> {
  return new Map(list.map((exercise) => [exercise.id, exercise]));
}

function summary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    workoutId: 'demo',
    workoutName: 'Demo Workout',
    status: 'completed',
    startedAtUtc: '2026-08-09T06:30:00Z',
    updatedAtUtc: '2026-08-09T07:00:00Z',
    shardName: 'results-2026-08.json',
    ...overrides
  };
}

describe('LandingScreen', () => {
  test('shows the wordmark, the sign-in control, and the privacy link', () => {
    const out = html(LandingScreen, { clientId: 'client-id.apps.googleusercontent.com' });

    expect(out).toContain('REP JOT');
    expect(out).toContain('Continue with Google');
    expect(out).toContain('Remember me on this device');
    expect(out).toContain('href="./privacy.html"');
    expect(out).toContain('Privacy policy');
  });

  test('an unconfigured build says so instead of offering a dead button', () => {
    const out = html(LandingScreen, { clientId: '' });
    expect(out).not.toContain('Continue with Google');
    expect(out).toContain('no Google client id');
  });

  test('a placeholder client id is treated as unconfigured', () => {
    const out = html(LandingScreen, { clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com' });
    expect(out).not.toContain('Continue with Google');
  });

  test('a sign-in notice renders as an alert', () => {
    const out = html(LandingScreen, {
      clientId: 'cid',
      signInNotice: 'Google did not complete the sign-in.'
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Google did not complete the sign-in.');
  });
});

describe('SessionListItem', () => {
  test('a resolved session renders a link with its name, status, and time', () => {
    const out = html(SessionListItem, {
      item: {
        sessionId: 's1',
        workoutName: 'Strength and Cindy',
        statusLabel: 'Completed',
        timeLabel: '2026-08-09',
        href: '#/sessions/s1/summary',
        unresolvedWorkout: false
      }
    });

    expect(out).toContain('href="#/sessions/s1/summary"');
    expect(out).toContain('Strength and Cindy');
    expect(out).toContain('Completed');
    expect(out).toContain('2026-08-09');
    expect(out).not.toContain('data-error');
  });

  test('an unresolved session renders the data-error card', () => {
    const out = html(SessionListItem, {
      item: {
        sessionId: 's2',
        workoutName: 'Old Routine',
        statusLabel: 'Completed',
        timeLabel: '2026-08-09',
        href: '#/sessions/s2/summary',
        unresolvedWorkout: true,
        rawJson: '{\n  "id": "s2"\n}'
      }
    });

    expect(out).toContain('data-error');
    expect(out).toContain('does not have');
    // REQUIREMENTS 6.9: the card carries the raw action.
    expect(out).toContain('View Raw JSON');
    // The row is not a link, because there is nowhere valid to go.
    expect(out).not.toContain('href="#/sessions/s2/summary"');
  });

  // With no shard text the card falls back to the row facts, so the mandated
  // action is present and the viewer never opens empty.
  test('an unresolved session with no shard text still offers the raw action', () => {
    const out = html(SessionListItem, {
      item: {
        sessionId: 's3',
        workoutName: 'Old Routine',
        statusLabel: 'Completed',
        timeLabel: '2026-08-09',
        href: '#/sessions/s3/summary',
        unresolvedWorkout: true
      }
    });

    expect(out).toContain('data-error');
    expect(out).toContain('Dismiss');
    expect(out).toContain('View Raw JSON');
  });

  test('the raw text never reaches the page as markup', () => {
    const injected = '<img src=x onerror=alert(1)>';
    const out = html(SessionListItem, {
      item: {
        sessionId: 's5',
        workoutName: injected,
        statusLabel: 'Completed',
        timeLabel: '2026-08-09',
        href: '#/sessions/s5/summary',
        unresolvedWorkout: true
      }
    });

    // The fallback text is JSON inside a string, so the tag arrives escaped and
    // no image element appears. ADR-017.
    expect(out).not.toContain('<img');
    expect(out).toContain('View Raw JSON');
  });
});

describe('WorkoutTreeReadOnly', () => {
  const nodes = [
    { label: 'Root', depth: 1, prescriptionText: '', isExercise: false },
    {
      label: 'Back Squat',
      depth: 3,
      prescriptionText: '5 reps @ 100 lb',
      isExercise: true,
      exerciseHref: '#/exercises/back-squat/history'
    },
    {
      label: 'ghost-exercise',
      depth: 2,
      prescriptionText: '',
      isExercise: true,
      unresolved: true
    }
  ];

  test('each row carries the indent class for its depth', () => {
    const out = html(WorkoutTreeReadOnly, { nodes });
    expect(out).toContain('tree-row--d1');
    expect(out).toContain('tree-row--d3');
    expect(out).toContain('tree-row--d2');
  });

  test('a depth past the cap clamps to the last indent', () => {
    const out = html(WorkoutTreeReadOnly, {
      nodes: [{ label: 'Deep', depth: 99, prescriptionText: '', isExercise: false }]
    });
    expect(out).toContain('tree-row--d6');
  });

  test('an exercise row links to its history', () => {
    const out = html(WorkoutTreeReadOnly, { nodes });
    expect(out).toContain('href="#/exercises/back-squat/history"');
  });

  test('an unresolved row is flagged and carries no link', () => {
    const out = html(WorkoutTreeReadOnly, { nodes });
    expect(out).toContain('tree-row__flag');
    expect(out).toContain('not in this build');
    expect(out).not.toContain('ghost-exercise"  href');
  });

  test('a row with no prescription text renders no prescription span', () => {
    const out = html(WorkoutTreeReadOnly, {
      nodes: [{ label: 'Empty', depth: 1, prescriptionText: '', isExercise: false }]
    });
    expect(out).not.toContain('tree-row__prescription');
  });
});

describe('WorkoutChooserScreen', () => {
  test('with no services it reports loading rather than an empty page', () => {
    const out = html(WorkoutChooserScreen, {});
    expect(out).toContain('Loading your workouts');
  });

  test('it shows the three sections with their content', () => {
    const lookup = {
      listActiveSessions: () => [summary({ id: 'live', status: 'in_progress' })],
      index: {
        terminalSessions: [
          summary({ id: 'done' }),
          summary({ id: 'gone', workoutId: 'missing', workoutName: 'Old Routine' })
        ]
      }
    };

    // The shard the summaries name holds the session object, so the unresolved
    // row can carry it as raw text. REQUIREMENTS 6.9.
    const coordinator = {
      peek(logicalName: string): unknown {
        if (logicalName !== 'results-2026-08.json') return undefined;
        return { sessions: { gone: { id: 'gone', workoutId: 'missing' } } };
      }
    };

    setServices({
      lookup: lookup as never,
      coordinator: coordinator as never,
      staticData: { workoutById: new Map<string, Workout>([['demo', workout()]]) } as never
    });

    const out = html(WorkoutChooserScreen, {});

    expect(out).toContain('In progress');
    expect(out).toContain('#/sessions/live/active');
    expect(out).toContain('Workouts');
    expect(out).toContain('#/workouts/demo');
    expect(out).toContain('Recent');
    expect(out).toContain('#/sessions/done/summary');
    // The unresolved row renders its card and the resolved row survives beside it.
    expect(out).toContain('data-error');
    expect(out).toContain('Old Routine');
    // REQUIREMENTS 6.9: the card offers the raw action.
    expect(out).toContain('View Raw JSON');
  });

  // No coordinator means no shard text, so the row falls back to its own
  // facts and the action stays available.
  test('an unresolved row with no coordinator still offers the raw action', () => {
    const lookup = {
      listActiveSessions: () => [],
      index: {
        terminalSessions: [
          summary({ id: 'gone', workoutId: 'missing', workoutName: 'Old Routine' })
        ]
      }
    };
    setServices({
      lookup: lookup as never,
      coordinator: null,
      staticData: { workoutById: new Map<string, Workout>() } as never
    });

    const out = html(WorkoutChooserScreen, {});
    expect(out).toContain('data-error');
    expect(out).toContain('View Raw JSON');
  });

  test('a user with no history is pointed at the workout list', () => {
    const lookup = { listActiveSessions: () => [], index: { terminalSessions: [] } };
    setServices({
      lookup: lookup as never,
      staticData: { workoutById: new Map<string, Workout>([['demo', workout()]]) } as never
    });

    const out = html(WorkoutChooserScreen, {});
    expect(out).toContain('No finished workouts yet');
    expect(out).toContain('#/workouts/demo');
    expect(out).not.toContain('In progress');
  });

  test('the workout visibility filter starts hidden behind its tune button', () => {
    const lookup = { listActiveSessions: () => [], index: { terminalSessions: [] } };
    setServices({
      lookup: lookup as never,
      staticData: { workoutById: new Map<string, Workout>([['demo', workout()]]) } as never
    });

    const out = html(WorkoutChooserScreen, {});
    expect(out).toContain('aria-label="Filter workouts"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('Select workout visibility');
  });

  test('**Load older** appears only when history exists past the cap', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      summary({ id: `s${i}`, startedAtUtc: `2026-08-${String(i + 1).padStart(2, '0')}T06:00:00Z` })
    );
    const lookup = { listActiveSessions: () => [], index: { terminalSessions: many } };
    setServices({
      lookup: lookup as never,
      staticData: { workoutById: new Map<string, Workout>() } as never
    });

    const out = html(WorkoutChooserScreen, {});
    expect(out).toContain('Load older');
  });
});

describe('WorkoutOverviewScreen', () => {
  function lookupFor(w: Workout | undefined) {
    return { getWorkout: () => w } as never;
  }

  test('an unknown workout id renders a not-found state', () => {
    setServices({ lookup: lookupFor(undefined), staticData: null });
    const out = html(WorkoutOverviewScreen, { workoutId: 'nope' });

    expect(out).toContain('No workout with that id');
    expect(out).toContain('nope');
    expect(out).not.toContain('Start Workout');
  });

  test('a known workout renders the tree and the start action', () => {
    setServices({
      lookup: lookupFor(workout()),
      staticData: { exerciseById: exerciseIndex(exercises()) } as never,
      sessionService: { start: async () => ({ id: 'x' }) } as never
    });

    const out = html(WorkoutOverviewScreen, { workoutId: 'demo' });
    expect(out).toContain('Demo Workout');
    expect(out).toContain('workout-tree');
    expect(out).toContain('Start Workout');
    expect(out).toContain('AMRAP 20 min');
  });

  test('the start button is disabled with no session service', () => {
    setServices({
      lookup: lookupFor(workout()),
      staticData: { exerciseById: exerciseIndex(exercises()) } as never,
      sessionService: null
    });

    const out = html(WorkoutOverviewScreen, { workoutId: 'demo' });
    expect(out).toContain('disabled');
    expect(out).toContain('not connected to your Drive folder');
  });
});

describe('WorkoutOverviewScreen: repeated rounds', () => {
  test('a repeated single exercise uses compact numbered sets', () => {
    setServices({
      lookup: { getWorkout: () => workout() } as never,
      staticData: { exerciseById: exerciseIndex(exercises()) } as never,
      sessionService: { start: async () => ({ id: 'x' }) } as never
    });

    const out = html(WorkoutOverviewScreen, { workoutId: 'demo' });
    // The override lands on set 3 inside the shared read-only set editor.
    expect(out).toContain('Set 2');
    expect(out).toContain('Set 3');
    expect(out).toContain('5 reps @ 110 lb');
  });
});
