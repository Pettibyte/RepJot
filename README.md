# REP JOT

Lightweight fitness journal tool. Works on not-so-modern browsers such as Kindle Scribe so you can log workouts on a distraction-free device.

The current Svelte and TypeScript prototype implements the production authorization flow. Drive access runs through the `DriveAdapter` interface in `src/drive/`, which stores every user file in the Google Drive `appDataFolder`.

Phase 0 authorization testing is complete on the physical Kindle. The flow supports callback replay, remembered and session-only tokens, exact expiry, account switching, sign-out, and grant revocation. See [`docs/PHASE-0-AUTHORIZATION-PROOF.md`](docs/PHASE-0-AUTHORIZATION-PROOF.md).

## Run locally

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and configure the Google OAuth client ID.
3. Start the app with `bun run dev` and open `http://localhost:5173`.

Run `bun run check` for strict TypeScript and Svelte checks. Run `bun run test` for the authorization continuity tests. Run `bun run check:schemas` to validate every JSON Schema.

## Exercise data

`src/public/data/exercises.json` is generated. Do not edit it by hand.
Edit `scripts/exercise-allowlist.json` and run `bun run seed`.
The seed copies the fields listed in `specs/exercise-seeding.md` from
`yuhonas/free-exercise-db` and adds the curated fields the source lacks.
The pinned source commit lives in `scripts/seed-config.json`.

- `bun run seed` writes the output file from the pinned commit.
- `bun run seed:check` fails when the file on disk is out of date.
- `bun run seed:bump` moves the pinned commit to the head of the source ref and reseeds. Review the diff before you commit.

`bun run build` runs `check:schemas`, `check:static`, and `seed:check` before Vite
packages the site. An invalid `exercises.json` or `workouts.json` fails the build
instead of shipping. A stale file also fails the build, but only `exercises.json`
can be detected as stale: `seed:check` compares it with the pinned seed source,
while `workouts.json` is hand-authored and has no upstream to compare against.

The seed caches each fetched source commit under `scripts/.cache/`. Pass `--source <path>` to read a local copy instead.

Equipment is a closed vocabulary, not a free string. `$defs.equipmentValue` in
`schemas/exercises/v1.schema.json` owns the list, and every value is lower case and
singular. The seed folds each equipment value into that list, so `Kettlebells`
becomes `kettlebell` and `bands` becomes `band`. A value outside the list fails the
build and names the field to edit.

## Workout data

Prescription rules live in the schema spec, not here. Read
[`specs/rep-jot-json-schema-spec.md`](specs/rep-jot-json-schema-spec.md) section 3
before you edit a prescription: it defines containers, strategies, result capture,
and how an `iterations` entry overrides the fields it carries.

`src/public/data/workouts.json` is hand-authored. It ships in the bundle and drives
the workout chooser. A workout appears in the chooser when the file lists it, so the
file holds no lifecycle flag.

The committed file carries the current `arms-day-a` workout. Strategy coverage for
other shapes lives in synthetic test fixtures, not in the production bundle.

Run `bun run check:static` to check the file on its own. The gate reads both
bundled data files, runs them through the document pipeline, and reports one line
per problem: a schema fault, a duplicate node ID inside one workout, or a node that
references an exercise the bundle does not hold. It runs those three checks and
nothing else.

`src/documents/static-loader.ts` exposes `loadStaticData`. It fetches
`./data/exercises.json` and `./data/workouts.json` with relative URLs, so the same
bundle works at the Pages root, under a project path, and under `bun run dev`. It
returns the two arrays plus `exerciseById` and `workoutById` maps. A failure throws
an `AppError`, so a caller never holds a half-valid bundle.

## Build and bundle

Run `bun run build` to produce the static bundle in `dist/`. Run `bun run check:compat` to apply the Kindle bundle gates. The gates require ES2019 syntax and prohibit `window.open`. The production entry also includes a `String.replaceAll`
polyfill required by Svelte. Drive multipart uploads use Web Crypto when available and
fall back to a locally generated UUID when `crypto.randomUUID` is unavailable. The
production bundle is loaded by dynamically inserting a classic script because the
Scribe executes that pattern but does not execute deferred external classic scripts.
The generated URL includes a per-build cache key so a deployment cannot reuse an old
`app.js` from the browser cache.

## Probe a browser

Open `http://localhost:5173/capabilities.html` in the browser you want to evaluate.
The page runs non-destructive checks for JavaScript, HTML/CSS, touch and pointer input,
storage, networking, file, media, worker, and device APIs. It does not request sensitive
permissions or transmit results. Use **Download HTML report** to save a standalone
snapshot in a conventional browser. On Kindle, use **Download Markdown (.txt)**; its
contents are Markdown, while its `.txt` extension is accepted by the Kindle browser.

## Deploy to GitHub Pages

This repository publishes the committed `dist/` build from a dedicated `gh-pages`
branch. GitHub Actions are not required.

For the first deployment:

1. Build and verify the site with Bun:

   ```sh
   bun ci
   bun run check
   bun run build
   ```

2. Commit the generated `dist/` files together with the source changes that produced
   them. Stage any other source files you intentionally changed as well:

   ```sh
   git add README.md CAPABILITIES.md src vite.config.ts dist
   git commit -m "Build site for GitHub Pages"
   ```

3. Publish only `dist/` to the deployment branch:

   ```sh
   git subtree push --prefix dist origin gh-pages
   ```

4. In the GitHub repository, open **Settings → Pages**, choose **Deploy from a branch**,
   and select the `gh-pages` branch and `/(root)` folder.

The site will be available at `https://pettijohn.github.io/RepJot/`, with the browser
report at `https://pettijohn.github.io/RepJot/capabilities.html`.

For every later deployment, run the same checks and build, commit the updated `dist/`
alongside its source changes, and run the same `git subtree push` command. Do not edit
the `gh-pages` branch directly; treat it as generated deployment output.

### Recover from a non-fast-forward subtree push

Do not run `git pull origin gh-pages` on `main`: the `gh-pages` branch contains the
contents of `dist/` at its root, so it cannot be merged into the repository root as a
normal branch. `git subtree pull` also does not work for this repository because
`dist/` was originally committed as a normal directory rather than created with
`git subtree add`.

The current `gh-pages` branch diverged because GitHub added a `CNAME` file directly to
it. That file now lives at `src/public/CNAME`, so every `bun run build` preserves it in
`dist/CNAME`. After building and committing `dist/`, reconcile the deployment branch
once with these guarded commands:

```sh
git fetch origin gh-pages
deployment_commit=$(git subtree split --prefix dist)
git diff --stat "$deployment_commit" origin/gh-pages
git push --force-with-lease=gh-pages:$(git rev-parse origin/gh-pages) \
  origin "$deployment_commit":gh-pages
```

Review the `git diff --stat` output before pushing. This replaces only `gh-pages`, and
the explicit force-with-lease refuses to proceed if that branch changes after the
fetch. Once reconciled, future deployments return to the normal command:

```sh
git subtree push --prefix dist origin gh-pages
```

To enable Google sign-in on Pages, add `https://repjot.com` as an authorized JavaScript
origin and `https://repjot.com/` as an authorized redirect URI for the Google OAuth
client. Origins do not include a path, while redirect URIs do. If you use the default
Pages hostname instead, configure `https://pettijohn.github.io` as the origin and
`https://pettijohn.github.io/RepJot/` as the redirect URI.

## Configure Google OAuth

1. Create or select a project in the Google Cloud Console.
2. Enable **Google Drive API** under **APIs & Services > Library**.
3. Open **Google Auth Platform**, complete **Branding**, and choose an audience. For an
   external prototype in testing, add your Google account under **Audience > Test users**.
4. Under **Data Access**, add the
   `https://www.googleapis.com/auth/drive.appdata` scope.
5. Under **Clients**, create a client with application type **Web application**.
6. Add `http://localhost` and `http://localhost:5173` as **Authorized JavaScript origins**.
   Add the exact site URL, including its trailing slash, under **Authorized redirect
   URIs**. For production this is `https://repjot.com/`; for the default local dev
   server it is `http://localhost:5173/`.
7. Create `.env.local` from the example and insert the generated client ID:

   ```dotenv
   VITE_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
   ```

The web client ID is public configuration and is embedded in `dist/app.js`. Do not add the client secret to this project. Restart `bun run dev` after changing `.env.local`.

Production uses the tested full-page implicit redirect with idempotent callback receipts. GIS, authorization-code flows, PKCE, popup authorization, and backend token exchange are out of scope.
