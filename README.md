# REP JOT

Lightweight fitness journal tool. Works on not-so-modern browsers such as Kindle Scribe so you can log workouts on a distraction-free device.

The current Svelte and TypeScript prototype supports authorization continuity tests on Kindle. It also stores a hello-world document in Google Drive `appDataFolder`.

The prototype supports remembered and session-only tokens, exact expiry, account switching, sign-out, and Google grant revocation. See [`docs/PHASE-0-AUTHORIZATION-PROOF.md`](docs/PHASE-0-AUTHORIZATION-PROOF.md) for the physical-Kindle test procedure.

## Run locally

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and configure the Google OAuth client ID.
3. Start the app with `bun run dev` and open `http://localhost:5173`.

Run `bun run check` for strict TypeScript and Svelte checks. Run `bun run test` for the authorization continuity tests.

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
The automatic checks also load Google's Identity Services script and initialize a
token client without requesting a token. This contacts `accounts.google.com`, but it
does not open a window, initiate sign-in, or request permissions.

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

The web client ID is public configuration and is embedded in `dist/app.js`. Do not add
the client secret to this project. Restart `bun run dev` after changing `.env.local`.
REP JOT currently uses Google's legacy full-page implicit flow as a compatibility test
for the Kindle browser. Google recommends an authorization-code flow with a backend for
production applications.

The prototype uses the legacy Google implicit flow because the tested Kindle requires a full-page redirect. Google recommends an authorization-code flow with PKCE for modern browsers.
