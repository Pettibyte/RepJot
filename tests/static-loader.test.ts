// Startup loader for the bundled static files.
// Phase 05, ARCHITECTURE section 9 startup steps 1 and 2, REQUIREMENTS 6.19-6.22.
//
// Every case drives `loadStaticData` with a stubbed `fetch`, so the tests never
// touch the network. The stub answers by URL, which also lets these tests assert
// the two URLs the loader asks for.

import { describe, expect, test } from 'bun:test';
import { loadStaticData } from '../src/documents/static-loader';
import { AppError } from '../src/domain/errors';
import { ISSUE_CODES } from '../src/validation/issues';
import { clone, exercises, workout } from './fixtures/semantic';

const EXERCISES_URL = './data/exercises.json';
const WORKOUTS_URL = './data/workouts.json';

function exercisesText(): string {
  return JSON.stringify({
    format: 'repjot/exercises',
    schemaVersion: 1,
    exercises: exercises()
  });
}

function workoutsText(): string {
  return JSON.stringify({
    format: 'repjot/workouts',
    schemaVersion: 1,
    workouts: [workout()]
  });
}

/** A stub `fetch` that answers by URL and records every URL it was asked for. */
function stubFiles(files: Record<string, string>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const body = files[url];
    if (body === undefined) {
      return new Response('missing', { status: 404 });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchStub as unknown as typeof fetch, calls };
}

/** A stub `fetch` that rejects, the way a dropped connection does. */
function stubNetworkFailure(): typeof fetch {
  const fetchStub = async (): Promise<Response> => {
    throw new TypeError('Failed to fetch');
  };
  return fetchStub as unknown as typeof fetch;
}

/**
 * A `Response` whose body stream fails after one chunk.
 *
 * Stands in for a connection that survives the headers and drops mid-download,
 * which is a different path from a `fetch` that never resolves.
 */
function responseWithFailingBody(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"format":"repjot/workouts",'));
      controller.error(new TypeError('socket hang up'));
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/** Runs `loadStaticData` and returns the thrown value, or null when nothing threw. */
async function loadAndCatch(
  fetchImpl: typeof fetch
): Promise<unknown> {
  try {
    await loadStaticData(fetchImpl);
    return null;
  } catch (error: unknown) {
    return error;
  }
}

describe('loadStaticData', () => {
  test('valid files yield a loaded bundle with populated maps', async () => {
    const stub = stubFiles({
      [EXERCISES_URL]: exercisesText(),
      [WORKOUTS_URL]: workoutsText()
    });

    const loaded = await loadStaticData(stub.fetch);

    expect(loaded.exercises.length).toBe(exercises().length);
    expect(loaded.workouts.length).toBe(1);
    expect(loaded.exerciseById.size).toBe(exercises().length);
    expect(loaded.workoutById.size).toBe(1);

    const firstExercise = exercises()[0];
    expect(loaded.exerciseById.get(firstExercise.id)).toEqual(firstExercise);
    expect(loaded.workoutById.get(workout().id)).toEqual(workout());
  });

  test('requests both files with relative URLs and no origin', async () => {
    const stub = stubFiles({
      [EXERCISES_URL]: exercisesText(),
      [WORKOUTS_URL]: workoutsText()
    });

    await loadStaticData(stub.fetch);

    expect(stub.calls.sort()).toEqual([EXERCISES_URL, WORKOUTS_URL].sort());
    for (const url of stub.calls) {
      expect(url.startsWith('http')).toBe(false);
      expect(url.startsWith('/')).toBe(false);
    }
  });

  test('a 404 on the exercises file throws AppError', async () => {
    const stub = stubFiles({ [WORKOUTS_URL]: workoutsText() });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('invalid_document');
    expect((error as AppError).detail.file).toBe('exercises.json');
    expect((error as AppError).detail.status).toBe(404);
  });

  test('a 404 on the workouts file throws AppError', async () => {
    const stub = stubFiles({ [EXERCISES_URL]: exercisesText() });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('invalid_document');
    expect((error as AppError).detail.file).toBe('workouts.json');
  });

  test('a wrong format throws with reason family', async () => {
    // The workouts document sits at the exercises URL. The family check must
    // reject it before anything reads its contents.
    const stub = stubFiles({
      [EXERCISES_URL]: workoutsText(),
      [WORKOUTS_URL]: workoutsText()
    });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('invalid_document');
    expect((error as AppError).detail.reason).toBe('family');
  });

  test('a workout node that references a missing exercise throws semantic_reference', async () => {
    const broken = workout();
    const node = broken.root.children[1].children[0];
    if (node.type === 'exercise') {
      node.exerciseId = 'exercise-not-in-the-bundle';
    }

    const stub = stubFiles({
      [EXERCISES_URL]: exercisesText(),
      [WORKOUTS_URL]: JSON.stringify({
        format: 'repjot/workouts',
        schemaVersion: 1,
        workouts: [broken]
      })
    });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('semantic_reference');
    expect((error as AppError).detail.firstCode).toBe(ISSUE_CODES.UNKNOWN_EXERCISE);
  });

  test('a duplicate node ID inside one workout throws semantic_reference', async () => {
    const broken = workout();
    broken.root.children.push(clone(broken.root.children[0]));

    const stub = stubFiles({
      [EXERCISES_URL]: exercisesText(),
      [WORKOUTS_URL]: JSON.stringify({
        format: 'repjot/workouts',
        schemaVersion: 1,
        workouts: [broken]
      })
    });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('semantic_reference');
    expect((error as AppError).detail.issueCount).toBeGreaterThan(0);
  });

  test('unparsable JSON throws invalid_document with reason parse', async () => {
    const stub = stubFiles({
      [EXERCISES_URL]: '{ not json',
      [WORKOUTS_URL]: workoutsText()
    });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('invalid_document');
    expect((error as AppError).detail.reason).toBe('parse');
  });

  test('a transport failure throws a network AppError, not a raw TypeError', async () => {
    const error = await loadAndCatch(stubNetworkFailure());

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('network');
  });

  test('a body read that fails throws a network AppError', async () => {
    // The headers arrive, then the connection drops while the body downloads.
    // The loader contract covers this path too: the failure is a network fault
    // that names the file, never a raw stream error.
    const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === WORKOUTS_URL) {
        return responseWithFailingBody();
      }
      return new Response(exercisesText(), { status: 200 });
    };

    const error = await loadAndCatch(fetchStub as unknown as typeof fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('network');
    expect((error as AppError).detail.reason).toBe('fetch_failed');
    expect((error as AppError).detail.file).toBe('workouts.json');
  });

  test('a newer schema version throws unsupported_schema', async () => {
    // The version gate belongs to the document pipeline. The loader passes the
    // fault through with its own kind, so a bundle from a future build stops at
    // startup instead of being read with the wrong shape. REQUIREMENTS 5.5.
    const stub = stubFiles({
      [EXERCISES_URL]: JSON.stringify({
        format: 'repjot/exercises',
        schemaVersion: 999,
        exercises: exercises()
      }),
      [WORKOUTS_URL]: workoutsText()
    });

    const error = await loadAndCatch(stub.fetch);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('unsupported_schema');
    expect((error as AppError).detail.declaredVersion).toBe(999);
  });

  test('a host with no fetch throws a network AppError with reason no_fetch', async () => {
    // Stands in for a host that provides no `fetch`. The real global is put
    // back in `finally`, so no other test sees the change.
    const originalFetch = globalThis.fetch;
    Reflect.deleteProperty(globalThis, 'fetch');

    try {
      const error = await loadAndCatch(undefined);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).kind).toBe('network');
      expect((error as AppError).detail.reason).toBe('no_fetch');
      // The bare file name, the same format every other branch reports. Both
      // files load in parallel, so either one can be the first to report.
      expect(['exercises.json', 'workouts.json']).toContain((error as AppError).detail.file);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
