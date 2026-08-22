# Rep Jot

## Overview

Rep Jot is a lightweight fitness tracker.

- Exercise library and programs stored as global and user JSON files hosted in the static bundle.
- User authenticates with Google OAuth.
- Workout history stored as per-user JSON files in Google Drive appDataFolder.
- Static site hosted at github pages at `https://repjot.com`

## Technical Requirements

- ALWAYS use `bun`. NEVER use `node` nor `npm`.
- ALWAYS use TypeScript, NEVER use JavaScript directly.
- Svelte UI with Vite packaging.
- Publish to static hosting at `dist/`.
- Develop in a devcontainer; any systemwide dependencies MUST be kept up to date with devcontainer.
- Bundled HTML & JS MUST respect features in `CAPABILITIES.md` to support targeted devices, which includes Kindle Scribe web browser.