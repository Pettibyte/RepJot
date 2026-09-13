// Startup gate for the two bundled static files.
// ARCHITECTURE section 9 startup steps 1 and 2, REQUIREMENTS 6.19 through 6.22, 7.4.
//
// The app calls `loadStaticData` once, before it renders anything that needs a
// workout or an exercise. The call fetches both bundled files, pushes each one
// through the document pipeline, and runs the three static identity checks over
// the pair. A failure throws, so the browser never holds a half-valid static
// bundle. ARCHITECTURE section 9 "A static-data failure blocks normal use".
//
// The loader owns one job: turn the bundle into a `StaticData` object plus the
// two lookup maps the screens need. It caches nothing and stores nothing. A
// caller that wants a single shared instance keeps the returned object.
//
// Failure kinds:
//   `invalid_document`   a bundled file is absent, unparsable, wrong-family, or
//                      fails its schema.
//   `semantic_reference` a workout node points at an exercise the bundle does
//                      not hold, or one workout repeats a node ID.
//   `network`            the request failed, its body read failed, or the host
//                      has no `fetch`.
//   `unsupported_schema` a bundled file declares a newer version than this build
//                      supports. The pipeline raises this one.

import { AppError, isAppError } from '../domain/errors';
import type {
  Exercise,
  ExercisesDoc,
  StaticData,
  Workout,
  WorkoutsDoc
} from '../domain/types';
import type { DocFamily } from '../validation/schema-validator';
import { validateStaticData } from '../validation/semantic-validator';
import { processDocument } from './document-pipeline';

/**
 * Bundled exercise file, relative to the document root.
 *
 * The URL stays relative on purpose. The same bundle then works at the GitHub
 * Pages root, under a project path such as `/RepJot/`, and under `bun run dev`.
 */
const EXERCISES_URL = './data/exercises.json';

/** Bundled workout file, relative to the document root. */
const WORKOUTS_URL = './data/workouts.json';

/**
 * The static bundle, loaded once and validated.
 *
 * Extends the domain `StaticData` contract so the loader output cannot drift
 * from what the rest of the app expects of a static bundle.
 *
 * The two maps are read-only by convention. No code writes into them after the
 * loader returns. A screen that needs a different view builds its own index.
 */
export interface LoadedStaticData extends StaticData {
  /** Exercise lookup by `id`. */
  exerciseById: Map<string, Exercise>;
  /** Workout lookup by `id`. */
  workoutById: Map<string, Workout>;
}

/**
 * Map a transport throw to the loader's `network` failure.
 *
 * The request and the body read are two separate failure points on one
 * connection, so both map through here. A value that is already an `AppError`
 * carries a more specific kind and passes through unchanged.
 */
function toNetworkFailure(error: unknown, fileName: string): unknown {
  if (isAppError(error)) return error;
  // A transport failure carries no file content, so the detail names the file
  // and nothing else. REQUIREMENTS 15.6 keeps response bodies out of errors.
  return new AppError(
    'network',
    { reason: 'fetch_failed', file: fileName },
    'The request for bundled data failed.'
  );
}

/**
 * Issue one GET for a bundled file.
 *
 * Two branches, because the two fetch sources are shaped differently: a
 * caller-supplied stub is a plain function, while the host `fetch` must keep
 * its `globalThis` receiver. Called detached, the browser rejects it with an
 * "Illegal invocation" error, so the host path calls the method on the host.
 */
function requestFile(
  url: string,
  fileName: string,
  fetchImpl?: typeof fetch
): Promise<Response> {
  if (fetchImpl !== undefined) {
    return fetchImpl(url);
  }
  if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') {
    throw new AppError(
      'network',
      { reason: 'no_fetch', file: fileName },
      'This host provides no fetch implementation.'
    );
  }
  return globalThis.fetch(url);
}

/**
 * Fetch one bundled file and read it through the document pipeline.
 *
 * @param url     Relative URL of the bundled file.
 * @param family  Expected document family. A wrong `format` rejects here.
 * @param fetchImpl Optional fetch override, for tests and for a host that needs one.
 */
async function loadBundle<T>(
  fileName: string,
  url: string,
  family: DocFamily,
  fetchImpl?: typeof fetch
): Promise<T> {
  let response: Response;
  try {
    response = await requestFile(url, fileName, fetchImpl);
  } catch (error) {
    throw toNetworkFailure(error, fileName);
  }

  if (response.ok !== true) {
    // A missing bundled file is a broken build, not a network condition. The
    // status code stays in the detail so the screen can tell the two apart.
    throw new AppError(
      'invalid_document',
      { reason: 'http_status', file: fileName, status: response.status },
      'A bundled data file is missing.'
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    // A connection can drop after the headers arrive, so the body read fails on
    // its own schedule. The header contract covers it the same way as a failed
    // request; otherwise a raw `TypeError` escapes on a flaky Kindle link.
    throw toNetworkFailure(error, fileName);
  }

  return processDocument<T>(text, family).document;
}

/**
 * Load, pipeline, and semantic-validate the bundled static data.
 *
 * Both files load in parallel, because the Kindle pays for every serial round
 * trip on a slow connection. Each file passes through `processDocument` with its
 * expected family, so parse, envelope, version, and schema faults surface per
 * file. `validateStaticData` then runs over the pair: a workout reference can
 * only resolve against the whole exercise directory.
 *
 * @param fetchImpl Optional fetch override. Tests pass a stub.
 * @throws AppError of kind `invalid_document`, `semantic_reference`, `network`,
 *         or `unsupported_schema`.
 */
export async function loadStaticData(fetchImpl?: typeof fetch): Promise<LoadedStaticData> {
  const [exercisesDoc, workoutsDoc] = await Promise.all([
    loadBundle<ExercisesDoc>('exercises.json', EXERCISES_URL, 'repjot/exercises', fetchImpl),
    loadBundle<WorkoutsDoc>('workouts.json', WORKOUTS_URL, 'repjot/workouts', fetchImpl)
  ]);

  const exercises = exercisesDoc.exercises;
  const workouts = workoutsDoc.workouts;

  // The three identity checks: schema shape already passed, so what remains is
  // a duplicate node ID or an unresolvable exercise reference. REQUIREMENTS 6.22
  // allows no other cross-file check here.
  const issues = validateStaticData(exercises, workouts);
  if (issues.length > 0) {
    const first = issues[0];
    throw new AppError(
      'semantic_reference',
      {
        reason: 'static_identity',
        issueCount: issues.length,
        firstCode: first.code,
        firstPath: first.path
      },
      'The bundled static data failed the identity checks.'
    );
  }

  return {
    exercises,
    workouts,
    exerciseById: new Map(exercises.map((exercise) => [exercise.id, exercise])),
    workoutById: new Map(workouts.map((workout) => [workout.id, workout]))
  };
}
