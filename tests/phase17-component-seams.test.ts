// The Phase 17 component seams.
//
// These tests read the compiled component output, the way the Phase 17
// verifier proved the defects. A one-way prop and a two-way binding look
// the same in a rendered string; they do not look the same once compiled.
// A Svelte 5 two-way binding compiles to a getter and a setter, and an
// `oninput` handler appears in the props object. If either disappears, the
// typed value dies inside the child and nothing reaches the session.
//
// REQUIREMENTS 11.1, 19.9.

import { describe, expect, test } from 'bun:test';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Compile one component to client-side JS. */
function compiled(file: string): string {
  const path = resolve(import.meta.dirname, '..', 'src', 'ui', 'components', file);
  const { js } = compile(readFileSync(path, 'utf8'), {
    filename: path,
    generate: 'client',
    dev: false
  });
  return js.code;
}

describe('ExerciseRow emits the typed value', () => {
  const code = compiled('ExerciseRow.svelte');

  test('the row calls onfieldchange', () => {
    // The prop existed and was never called. A call site must be present.
    expect(code).toMatch(/onfieldchange[?.]*\(/);
  });

  test('the value input carries an oninput handler', () => {
    // The seam between the keystroke and the row. Without it every edit is
    // discarded. REQUIREMENT 11.1.
    expect(code).toMatch(/oninput/);
  });

  test('the row passes the typed text to the callback with the dimension', () => {
    // The callback signature is (dimension, value), so both reach the
    // screen. The window stops at the first `;`, so the match stays inside
    // one call.
    expect(code).toMatch(/onfieldchange[?.]*\([^;]{0,160}dimension[^;]{0,80}\.value/);
  });
});

describe('ValueInput forwards the input event', () => {
  const code = compiled('ValueInput.svelte');

  test('the native input wires oninput to the prop', () => {
    expect(code).toMatch(/oninput/);
  });
});

describe('ExerciseRow reaches the effort and attempt controls', () => {
  const code = compiled('ExerciseRow.svelte');

  test('the row calls oneffortchange', () => {
    // The effort control must emit, or the app programs effort it cannot
    // record. REQUIREMENT 19.9.
    expect(code).toMatch(/oneffortchange[?.]*\(/);
  });

  test('the row calls onaddattempt', () => {
    // `addAttempt` was unreachable from the UI. REQUIREMENT 19.9.
    expect(code).toMatch(/onaddattempt[?.]*\(/);
  });

  test('the row calls onsidechange', () => {
    // A unilateral exercise needs a side control. REQUIREMENT 11.5.
    expect(code).toMatch(/onsidechange[?.]*\(/);
  });
});

describe('WorkoutTreeEditable forwards every row callback', () => {
  const code = compiled('WorkoutTreeEditable.svelte');

  for (const name of [
    'onfieldchange',
    'onfieldblur',
    'onstatuschange',
    'onreasonchange',
    'onunitchange',
    'onsidechange',
    'onstartingchange',
    'oneffortchange',
    'onaddattempt'
  ]) {
    test(`the tree forwards ${name}`, () => {
      expect(code).toMatch(new RegExp(`${name}[?.]*\\(`));
    });
  }
});
