# REP JOT

REP JOT is a lightweight personal fitness tracker. It emphasizes tracking exact reps and weight for a person's history.

## Core Concepts

- Exercise Directory, includes coarse muscle groups and equipment required.
- Workout, a sequence of exercises meant to be completed in a session.
- Results, actual results a person achieves on their workout execution.
- User Preferences.

## Auth

- User authenticates with Google OAuth.
- There is no authorization as there is no elevated role, only basic user role.
- Anything requiring elevated privileges is currently a development-time consideration, so an admin modifies this source repository.

## Data Storage

- Global, static JSON files deployed with the site. (Exercise Directory, Workout)
- Per-user, stored in the authenticated user's Google Drive appDataFolder. This keeps results private. (Results, User Preferences)
- User results are stored in monthly partitions, `yyyy-mm-filename.json`
- User results are cached locally to avoid excessive downloads on each app launch.
- Make use of in-memory hashtables to speed lookups (rather than lots of loops); Kindle browsers do not support WASM so no Sqlite WASM, and we explicitly do not want to reimplement a database.
- Out of scope: eventually users may layer on their own workouts, so the app will load all system workouts and then merge/append user workouts.
- Open question: do we save on every `blur` event, or only every `x` seconds after change to allow time to accumulate more changes?
- See more at `storage-and-lookup.md`

## Schema Versioning

- Each JSON file MUST have a version number (integer).
- The application MUST have load the previous version, which in turn may chain to its previous version. After ugrading all schemas atomically, it must save the upgraded data files.
- See `../specs/schema-versioning.md`

## Build, Hosting and Web Stack

- 100% static site.
- Hosted on GitHub pages at present.
- Built with Svlete and Vite.
- Build must validate TypeScript and publish to `dist/`.
- Build must validate global static JSON files against JSON schema.
- Supports older browsers with limited capabilities, namely Kindle Scribe and Kindle Paperwhite browsers, for distraction-free workout editing -- see `../docs/CAPABILITIES-*.md`

## Branding and Styling

- The product name is stylized in all caps as "REP JOT" but may appear in other casing conventions in code.
- REP JOT uses a high-contrast, primarily black/white/middle-grey theme, so that it works well on e-ink displays, including Kindle devices.
- Styling is a first-class architectural principle in the solution. We use tokens, centralized CSS file(s), and strong reuse (DRY). NEVER scatter random CSS bits across HTML files. ALWAYS look for existing to reuse.
- We use Material Symbols for UI iconography with a few exceptions (custom SVGs for equipment, muscle groups, modality, laterality).
- We use styled native HTML controls and DO NOT use any control library.
- See `../design/DESIGN.md` for more

## Exercise features

- Exercise has a name, optional instructions, optional icon, primary and secondary muscle groups (coarse ~dozen muscles), push/pull/compound modality, laterality (single/bi), and a measurement type (reps, time, calories, distance).
- Open Question: does the icon live at the exercise level, equipment level, modality, muscle group, etc level? Is the icon Material Symbol or custom SVG?

## Workout features

- A Workout must have a kind of recursion/tree structure. A single workout might have three sections: warmup, strength, HIIT. Each section might be a simple linear component (x rounds of each of the y exercises), or more complex (AMRAP, EMOM), or compound sections that have x minutes of EMOM followed by y active recovery folloed by z minutes of EMOM. It must support representing a complex kettlebell movement (e.g. deadlift to row to clean to press) without having to add a new exercise type for each complex. It needs to be flexible but understandable and UI renderable. 

## Result features

- Results must capture actuals. If the workout was to do 3 sets X 8 reps, but I only do 6 reps on the last set, I need to capture that.

## User Settings

- To start, user settings only exposes links to download all data files from appDataFolder.
- Open question: allow user to indicate their equipment and its units (e.g. kgs barbells, lbs dumbbells).

## Other Open Questions

- User must be able to toggle pounds/kilograms per exercise. For example, my home gym has kilogram plates for the barbell but pound dumbbells. I must be able to track squats in KG side by side curls in LBS in the same workout. Solve with either: a user preference to state equipment in their gym with per-equipment units, or a tappable `lbs` indicator that becomes `kgs` on tap (and vice versa). If tappable we should remember it for the exercise or equipment.

## Data Seeding

- Source exercise data from `https://github.com/yuhonas/free-exercise-db`. Check out the repository locally. In this REP JOT repo, have a transformation script and an allowlist of exercises we want curated into REP JOT. The script will create curated exercise directory in our schema.
- Open question: free-exercise-db includes primary and secondary muscles, strongly-typed as an enum. Should we copy it or do we have a good reason to deviate?

## Prod Readiness

- Beautiful landing page with screenshots and key feature callouts
- Add a privacy policy
- Open question: anything else that Google OAuth and Drive scope requires? US law? Does local storage require EU cookies disclosure?

## UI

The UI intentionally only support workout-time data entry. All other concerns (programming workouts, equipment directory, exercise database, etc) are development-time considerations and deployed as part of the static bundle.

Mockup screenshots & HTML are in `../design/**`. 

### Marketing Home Page

The home page `/` is the unauthenticated experience. It contains a button to begin Google sign in and the app title, REP JOT. That's it. We will add a beautiful home page later, once we have screenshots and a working app, to serve as marketing.

### Authenticated Shell

The shell contains the REP JOT header with `fitness-center` Material icon as the app icon. When on screens other than authenticated landing, the header needs a Back botton and nav stack. 

The bottom tab contains buttons for Workout with `play_arrow` icon, History `receipt_long`, and Settings `settings`. 

### Choose Workout (Authenticated Landing)

After authenticating, the user lands on the Choose Workout screen. It shows a paginated list of Workouts, by title, with the last date complted as the subtitle. 

It also shows a Recent section that shows the five most recent workouts, sorted by date, most recent first.

If user starts a workout and clicks back, Recent section shall show it as an in progress workout. Instead of last date it shall show started time (if today; date if not) and have a contrasting background. 

### History

Shows a complete list of workouts, similar to Recent, but paginated with complete history, and containing more details.

### Workout Summary

Clicking a recent workout presents a summary of the complete workout. 

### Workout Overview

From authenticated landing page, tapping a workout from the Choose Workout screen gives a detailed view of the workout. At the bottom, a Start Workout button allows the user to begin. This creates the data entry and records the start time in the user's Results data. 

### Active Workout

Needs to render the tree of the workout. Top level sections are clearly deliniated with horizontal lines. 

Open question: Different workout types (time, distance, AMRAP, EMOM, reps/sets) have different data entry requirements and thus UI treatments. Be thorough in design.

Open question: we expect most workouts will have 1 to 3 levels of hierarchy, so we should design for those each to be distinctive. Further recursion needs a way to show we've gone deeper. Perhaps we use legal numbering (aka multilevel list) on headers. Need help here. 

Each exercise that appears in the Active Workout needs a "Last Time" badge that summarizes what and when the user achieved this specific exercise. This is critical for tracking progress and ensuring that results increase over time. 

Tapping the Last Time badge takes you to Exercise History screen. 

Bottom of the Active Workout has a FINISH WORKOUT button. 

Open Question: how do we handle "abandoned" workouts? Currently they stay in progress in the Recent list and History forever. 

### Exercise History

This shows you a paginated list of entire history, sorted by most recent first, for that single exercise. 

### Settings

Data Export section: provide links to the raw JSON files that the user may download.

Open question: other settings, such as units, or units per equipment, or equipment in gym. 