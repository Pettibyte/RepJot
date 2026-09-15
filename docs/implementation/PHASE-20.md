# Phase 20 — Release hardening and deployment

Close the release gates: content policy, bundle budget, secret scan, privacy policy,
Kindle smoke, and the GitHub Pages publish.

## Prerequisites

- Phases 01 through 19 complete and green.
- The production OAuth client ID for `repjot.com` configured in the single Google
  Cloud project.

## Goals

1. Add the CSP meta policy and confirm it permits only the required origins.
2. Extend the compatibility gate with the bundle budget and the secret scan.
3. Publish the privacy policy and link it from the landing page.
4. Run the full release gate list.
5. Build to `dist/`, deploy to `../RepJot-pages`
6. Push `../RepJot-pages` to GitHub Pages at `https://repjot.com`.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/index.html` | Adds the CSP meta tag and the final page title. |
| `scripts/check-browser-compat.ts` | Adds the budget and secret checks to the existing ES2019 gate. |
| `scripts/release-check.ts` | Runs the full gate list as `bun run release:check`. |
| `src/public/privacy.html` | Privacy policy page. |
| `docs/RELEASE.md` | Release runbook and the Kindle smoke checklist. |
| `package.json` | Adds `release:check`. |

### CSP policy

The meta policy permits:

- `default-src 'self'`
- `script-src 'self' 'unsafe-inline'` for the existing bootstrap loader
- `style-src 'self' 'unsafe-inline'`
- `font-src 'self'`, `img-src 'self' data:`
- `connect-src https://www.googleapis.com https://oauth2.googleapis.com`
- `form-action https://oauth2.googleapis.com`
- `frame-src https://accounts.google.com` for the revocation flow
- No GIS script origin, no telemetry origin, no remote UI origin, no `base-uri`
  outside `'self'`, no `object-src`.

### New compatibility checks

Extend `scripts/check-browser-compat.ts` with:

1. `dist/app.js` parses as ES2019 with `sourceType: 'script'`. Existing check.
2. No optional chaining or nullish coalescing in the emitted bundle. Existing check.
3. No `window.open` call. Existing check.
4. `dist/app.js` size stays under the reviewed gzipped budget recorded in
   `docs/RELEASE.md`.
5. `dist/` file count stays under the reviewed budget.
6. No string matching a client secret, refresh token, or private key pattern in
   `dist/`.
7. No remote origin string in `dist/` other than the Google OAuth, revocation, and
   Drive API hosts.
8. `dist/CNAME` equals `repjot.com`.
9. `dist/index.html` contains no `type="module"` script and loads the classic
   loader after its function and DOM target. Existing check.

### Release gate

`bun run release:check` runs, in order:

```sh
bun ci
bun run check
bun test
bun run check:schemas
bun run check:static
bun run check:styles
bun run seed:check
bun run build
bun run check:compat
```

It then prints the gate table from `docs/RELEASE.md` for manual sign-off.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 7.1, 7.3, 7.4 | Static build to `dist/` with the validation chain. |
| REQUIREMENTS 7.5 | ES2019 gate plus the physical Kindle smoke. |
| REQUIREMENTS 14.1, 14.5 | Privacy policy published and linked from the landing page. |
| REQUIREMENTS 14.2, 14.3 | One OAuth project, owned verified domain, HTTPS origin. |
| REQUIREMENTS 14.6, 14.7 | Required local storage disclosed. No nonessential storage. |
| REQUIREMENTS 14.8 | Data-access and deletion contact process stated in the policy. |
| REQUIREMENTS 14.9 | No consumer-health review claimed. Data stays in the user's Drive. |
| ARCHITECTURE §14 "Browser policy and supply chain" | CSP meta policy, frozen lockfile, no CDN, no telemetry. |
| ARCHITECTURE §17 release gates 1–12 | `release:check` plus the manual sign-off table. |
| ARCHITECTURE §13 | Local fonts, icon manifest, and the polyfill note verified. |
| ARCHITECTURE R-02 | Physical Kindle smoke covers redirect, storage, sync, export, and scroll. |

## Checklist

### Implementation

- [ ] Add the CSP meta tag to `src/index.html` and confirm the app still runs in
      development and in the built bundle.
- [ ] Set the final page title and the `lang` attribute.
- [ ] Extend `scripts/check-browser-compat.ts` with checks 4 through 8.
- [ ] Create `scripts/release-check.ts` and register `bun run release:check`.
- [ ] Write `src/public/privacy.html` covering access, storage, use, export,
      deletion, the local-storage disclosure, and the contact process.
- [ ] Link the privacy policy from the landing screen and from the Settings license
      area.
- [ ] Write `docs/RELEASE.md` with the gate table, the recorded bundle budget, the
      file-count budget, and the Kindle smoke checklist.
- [ ] Confirm `bun.lock` is committed and `bun install --frozen-lockfile` succeeds
      from a clean checkout.
- [ ] Confirm no client secret appears in source, `.env.example`, or `dist/`.
- [ ] Confirm `src/public/CNAME` contains `repjot.com`.
- [ ] Confirm no `.svelte` file in the tree uses legacy syntax: no `export let`,
      no `<slot>`, and no `on:click`. Every component uses Svelte 5 runes. See
      the runes rule in `docs/implementation/README.md` and the **Component
      syntax** section in Phases 16 through 19.

### Kindle smoke checklist

Run each item on the physical device and record the result in `docs/RELEASE.md`.

- [ ] Full-page redirect authorization completes without a popup.
- [ ] Callback replay is accepted once and rejected as a duplicate.
- [ ] Remember checked restores after a device sleep. Remember unchecked does not.
- [ ] IndexedDB save succeeds and the status shows **Saved**.
- [ ] Blur save persists across a reload.
- [ ] Reload mid-workout resumes the in-progress session.
- [ ] Synchronization completes against a live account.
- [ ] Raw export downloads a file.
- [ ] Delete All User Data shows the warning and completes.
- [ ] A long workout scrolls without a stall or a dropped input.
- [ ] Fonts render from the origin with no remote request.

### Verification

- [ ] `bun run release:check` passes end to end.
- [ ] `bun run check:compat` reports the bundle size and file count inside budget.
- [ ] `grep -rn "client_secret\|BEGIN PRIVATE KEY" dist/` returns nothing.
- [ ] `dist/CNAME` equals `repjot.com`.
- [ ] Publish `dist/` to the `gh-pages` branch using `../RepJot-pages`.
- [ ] `https://repjot.com` loads, signs in, records a workout, and syncs.
- [ ] Tag the release and record the tag with the Kindle smoke results in
      `docs/RELEASE.md`.

## Exit criteria

The product is live at `https://repjot.com`, every automated gate passes, and the
physical Kindle smoke list is signed off.
