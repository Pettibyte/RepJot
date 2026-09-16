# Release Runbook

REP JOT ships as a static bundle from GitHub Pages at `https://repjot.com`.
This file holds the release gates, the reviewed budgets, the publish steps, and
the smoke checklist. Phase 20 owns it.

Run every automated gate before you publish:

```sh
bun run release:check
```

The runner stops at the first failure. It prints the manual gates at the end.
`scripts/release-check.ts` implements the runner.

## 1. Automated gates

`bun run release:check` runs these commands in this order. Each one maps to the
release gates in `docs/ARCHITECTURE.md` section 17.

| Order | Command              | Gate (ARCHITECTURE 17)                  | Owner               |
| ----- | -------------------- | ------------------------------------- | ------------------- |
| 1     | `bun ci`             | Lockfile installs with no drift         | `bun.lock`          |
| 2     | `bun run check`      | 1. Svelte and TypeScript checks        | `svelte-check`      |
| 3     | `bun test`           | 2. Unit and DOM tests                  | `tests/`            |
| 4     | `bun run check:schemas` | 3. Schemas validate as Draft 2020-12 | `scripts/validate-schemas.ts` |
| 5     | `bun run check:static` | 4. Static data checks                 | `scripts/check-static-data.ts` |
| 6     | `bun run check:styles` | Style guard                           | `scripts/check-styles.ts` |
| 7     | `bun run seed:check` | 5. Seed artifact matches pinned source | `scripts/seed-exercises.ts` |
| 8     | `bun run build`      | Static bundle builds to `dist/`        | Vite                |
| 9     | `bun run check:compat` | 6, 7, 9, 10, 11. See the table below | `scripts/check-browser-compat.ts` |

`bun run check:compat` runs eleven checks:

| #  | Check                                                    | Gate |
| -- | -------------------------------------------------------- | ---- |
| 1  | `dist/app.js` parses as ES2019 in script mode             | 6    |
| 2  | No optional chaining and no nullish coalescing            | 6    |
| 3  | No `window.open` call                                     | 6    |
| 4  | `dist/app.js` stays inside the gzipped budget             | 9    |
| 5  | `dist/` stays inside the file-count budget                | 9    |
| 6  | No client secret, refresh token, API key, or private key  | 7    |
| 7  | No remote origin outside the allowlist in a network call  | 7    |
| 8  | `dist/CNAME` equals `repjot.com`                         | 10   |
| 9  | Classic loader runs after its function and DOM target     | 6    |
| 10 | The CSP meta policy matches the reviewed policy           | 12   |
| 11 | `dist/app.js` carries the Drive app-data scope            | 7    |

Gate 8 is not automated in this release. The font files and their license texts
sit in `src/public/fonts/` and copy to `dist/fonts/`. The glyph manifest lives
at `src/ui/icons/manifest.json` and rebuilds with `bun run icons:build`. A
person confirms gate 8 by reading section 5 item 12 on the device.

Gate 11 (Kindle smoke) and gate 12 (privacy, legal, owned domain) need a
person. See sections 4 and 5.

## 2. Reviewed budgets

Check 4 and check 5 enforce these numbers. They live as constants at the top of
`scripts/check-browser-compat.ts`. Raise a budget only with a note in this
section that says why.

| Budget                   | Limit               | Measured 2026-09-16 | Headroom |
| ------------------------ | ------------------- | ------------------- | -------- |
| `dist/app.js`, gzipped   | 204,800 bytes       | 142,675 bytes       | 62,125 bytes |
| `dist/` file count       | 30 files            | 20 files            | 10 files |

Gzip uses level 9. The minified `dist/app.js` measures 479,344 bytes.

Ajv and `ajv-formats` account for 41,515 of the gzipped bytes. If a later
phase precompiles the schemas, that cost leaves the bundle. See section 6.

## 3. Remote origin policy

Check 7 allows only these hosts in a network call:

| Host                   | Use                                        |
| ---------------------- | ------------------------------------------ |
| `accounts.google.com`  | OAuth authorization redirect               |
| `oauth2.googleapis.com` | Token exchange and revocation             |
| `www.googleapis.com`   | Drive API and Drive upload API             |
| `myaccount.google.com` | Link to the Google connected-apps page     |

The check looks at network contexts only. A URL counts when it sits in `fetch`,
`XMLHttpRequest.open`, `new URL`, `sendBeacon`, `importScripts`,
`location.assign`, `location.replace`, or a `src` or `href` assignment. The
scan runs over `dist/` and over `src/`.

Each tree gets two passes, because the same call looks different in readable
source and in a minified bundle:

| Pass            | What it reads                                            | Catches                        |
| --------------- | ------------------------------------------------------- | ------------------------------ |
| Context window  | The 90 characters before each URL                        | A URL written at the call site |
| String bindings | Each call argument, resolved through names in the same file | A URL stored in a name       |

The second pass is what survives minification. The bundle keeps the URL value and
renames its holder, so `var hD="https://host"` plus a later `fetch(hD,{...})`
resolves back to `hD`'s host. `scripts/compat-scan.ts` holds both passes.

The app has three network call sites in `src/`:

| File                             | Call                       |
| -------------------------------- | -------------------------- |
| `src/drive/drive-rest-adapter.ts` | Drive and revocation calls |
| `src/documents/static-loader.ts` | Same-origin data load      |
| `src/auth/oauth-redirect-adapter.ts` | Authorization redirect |

Other hosts appear in `dist/` as inert metadata. They never leave the page, so
check 7 ignores them. `check:compat` prints them on the last line. As of this
release they are: `fonts.googleapis.com`, `github.com`, `json-schema.org`,
`openfontlicense.org`, `raw.githubusercontent.com`, `repjot.com`,
`scripts.sil.org`, `svelte.dev`, `www.w3.org`.

A new host in that list is not a failure, but it is a signal. Read what added it
before you ship.

## 4. Manual gates

Record each item here before the release tag goes up.

| Item                                                     | Result | Date | By |
| -------------------------------------------------------- | ------ | ---- | -- |
| Production OAuth client ID for `repjot.com` used in build | PENDING |      |    |
| CSP loads clean in a conventional browser            | PENDING |      |    |
| Physical Kindle smoke checklist, all 13 rows          | PENDING |      |    |
| Live site check at `https://repjot.com`                   | PENDING |      |    |
| Privacy mailbox `support@pettibyte.com` receives mail      | PENDING |      |    |
| Release tag recorded in section 8                         | PENDING |      |    |

## 5. Kindle smoke checklist

Run each item on the physical Kindle Scribe. Write PASS or FAIL, the date, and
the build tag in the Result column. File an issue for every FAIL and hold the
release.

| #  | Item                                                            | Result  | Date | By |
| -- | --------------------------------------------------------------- | ------- | ---- | -- |
| 1  | Full-page redirect authorization completes without a popup       | PENDING |      |    |
| 2  | Callback replay is accepted once and rejected as a duplicate     | PENDING |      |    |
| 3  | Remember checked restores after device sleep                     | PENDING |      |    |
| 4  | Remember unchecked does not restore after device sleep           | PENDING |      |    |
| 5  | IndexedDB save succeeds and the status shows **Saved**           | PENDING |      |    |
| 6  | Blur save persists across a reload                               | PENDING |      |    |
| 7  | Reload mid-workout resumes the in-progress session               | PENDING |      |    |
| 8  | Synchronization completes against a live account                 | PENDING |      |    |
| 9  | Raw export downloads a file                                      | PENDING |      |    |
| 10 | Delete All User Data shows the warning and completes             | PENDING |      |    |
| 11 | A long workout scrolls without a stall or a dropped input        | PENDING |      |    |
| 12 | Fonts render from the origin with no remote request              | PENDING |      |    |
| 13 | The CSP blocks nothing the app needs and logs no violation       | PENDING |      |    |

Item 3 and item 4 split one checklist line in two, so the table carries
thirteen rows. Both must pass.

For item 13, open the browser console on the Kindle first. Load the app, sign
in, and record one set. Any `Refused to ...` line is a CSP violation. Write the
refused directive in the Result cell and hold the release.

## 6. CSP decision

This release ships the Content-Security-Policy meta tag with `'unsafe-eval'` in
`script-src`. The build injects the tag through the `kindle-classic-entry`
plugin in `vite.config.ts`, which runs only for the production build. The tag
is absent from `src/index.html` on purpose: the policy blocks the `ws://` socket
that Vite hot reload opens, so a copy in that file would break development.
The policy is:

```text
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
connect-src https://www.googleapis.com https://oauth2.googleapis.com;
form-action https://oauth2.googleapis.com;
frame-src https://accounts.google.com;
base-uri 'self';
object-src 'none'
```

`'unsafe-eval'` is there for one reason. `src/validation/schema-validator.ts`
compiles the four document schemas in the browser at module load. Ajv
generates validator source code and builds it with the `Function` constructor.
A policy without `'unsafe-eval'` blocks that constructor, so the strict policy
written in the original `docs/implementation/PHASE-20.md` draft stops schema
validation at startup. That document now records the policy above.

Two facts drove the decision:

1. `dist/app.js` holds the Ajv call `Function(self, scope, code)`. The
   `registerShippedSchemas()` call at module load reaches it.
2. Ajv and `ajv-formats` cost 145,750 bytes minified and 41,515 bytes
   gzipped. That is about 29 percent of the shipped bundle.

### What the policy does and does not stop

It stops every remote origin. No script, style, font, image, or fetch can come
from a CDN or any host outside the four Google origins. That keeps the
supply-chain goal from `docs/ARCHITECTURE.md` section 14.

It does not stop injected inline script from calling `eval` or the `Function`
constructor. `'unsafe-inline'` already lets inline script run, because the
bootstrap loader in `index.html` needs it. `'unsafe-eval'` widens that hole.
Treat the CSP as an origin control, not as a complete XSS defense.

The remote-code control for this release stays check 7 in
`scripts/check-browser-compat.ts`. That check blocks any network call to a
host outside the allowlist.

### Follow-up: remove the need for unsafe-eval

Precompile the validators so the browser never calls `Function`:

1. Add a build script that runs the Ajv standalone code generator and writes
   the four validators to a plain module.
2. Change `schema-validator.ts` to import the generated validators. Move the
   runtime `registerValidator` path to a test-only module.
3. Add a compat check that fails when `Function(` or `eval(` appears in
   `dist/app.js`.
4. Drop `'unsafe-eval'` from `script-src` and update this section.

This also removes about 40 KB gzipped from the bundle.

## 7. Publish

The publish steps stay manual. Run them from a machine with GitHub push access.

The Pages checkout lives beside this repository at `../RepJot-pages`. It is a
git worktree on the `gh-pages` branch. The devcontainer does not mount that
path, so run the copy on the host.

`bun run deploy` runs `scripts/check-deploy-target.ts` first. Inside the
devcontainer that guard prints "Run this on the Docker host" and exits non-zero,
so the command fails with that message instead of a raw `rsync` path error.

```sh
# 1. Build and gate.
cd RepJot
bun run release:check

# 2. Copy the bundle into the Pages worktree. Run this on the host.
rsync -a --delete --exclude='.git' RepJot/dist/ RepJot-pages/

# 3. Commit and push the Pages branch.
cd RepJot-pages
git add --all
git commit -m "Release <tag>"
git push origin gh-pages

# 4. Wait for Pages to rebuild, then check the site.
curl -sI https://repjot.com | head -1

# 5. Tag the release in the source repository.
cd ../RepJot
git tag -a v<version> -m "REP JOT <version>"
git push origin v<version>
```

Confirm these after the push:

- `https://repjot.com` loads the landing page.
- `https://repjot.com/privacy.html` loads the privacy policy.
- The landing page link and the Settings link both reach the policy.
- Sign-in, one recorded workout, and one sync complete on the live site.

## 8. Release record

| Field            | Value   |
| ---------------- | ------- |
| Version          | PENDING |
| Source commit    | PENDING |
| Pages commit     | PENDING |
| Tag              | PENDING |
| `app.js` gzipped | 142,675 bytes |
| `dist/` files    | 20      |
| Kindle smoke     | PENDING |
| Published by   | PENDING |
| Published on   | PENDING |
