# Day-of Workout Execution UI — Design Brief

## Objective

Design the simplest possible interface for executing a programmed workout and recording actual results.

Assume the following already exist:

- Exercise library
- Workout/programming definitions
- Exercise metadata
- Previously recorded workout results

The user's workflow begins when they choose a programmed workout for today.

The interface should optimize for:

- Fast data entry between sets
- Minimal navigation
- High legibility
- Low cognitive load
- Easy reference to prior performance
- Compatibility with very limited web browsers, including Kindle's experimental browser

This is not a fitness social app, coaching platform, analytics dashboard, or gamified experience.

The design language is **all business: clean, sparse, utilitarian, calm**.

---

# Primary User Flow

The core flow is:

```text
Choose workout
    ↓
Review today's program
    ↓
Start workout
    ↓
Move through programmed exercises
    ↓
Enter actual reps / weight / time / distance
    ↓
Consult recent history when useful
    ↓
Finish workout
```

The app should make it easy to remain on one primary workout page for almost the entire session.

Avoid workflows that require repeatedly opening forms, dialogs, detail screens, or nested navigation.

---

# Screen 1: Choose Workout

The landing screen should answer one question:

> What am I doing today?

Show a short list of programmed workouts.

Example:

```text
Choose Workout

Squat + RDL + Cindy
Last performed: Aug 9

Push + Pull
Last performed: Aug 7

Full Body A
Last performed: Aug 4
```

Each workout should be selectable with one obvious large target.

Do not require thumbnails, cards, illustrations, charts, or decorative imagery.

## Recent Programs

Include a compact section showing recently executed programs.

For example:

```text
Recent

Aug 9   Squat + RDL + Cindy
Aug 7   Push + Pull
Aug 4   Full Body A
```

This is primarily useful when the user knows they want to repeat something they recently did.

Keep this section secondary to the main workout list.

---

# Screen 2: Workout Overview

After selecting a workout, show its structure before execution begins.

Example:

```text
Squat + RDL + Cindy

Warmup
4 rounds
- Dead Hang
- Tabletop
- Deep Squat Stretch
- 90-90 Hip Stretch

Strength
Back Squat
  2 × 12 warmup
  3 × ~8 to failure

RDL
  2 × 12 warmup
  3 × ~8 to failure

Conditioning
Cindy — 20 min AMRAP
- 5 Pull-ups
- 10 Push-ups
- 15 Air Squats

[ Start Workout ]
```

This screen is informational rather than editable.

Its purpose is to let the user mentally understand the session before starting.

---

# Screen 3: Active Workout

This is the primary screen and should receive the most design attention.

The entire programmed workout should remain visible as a vertically scrolling document.

Do not make each exercise a separate page.

Use hierarchy and whitespace to communicate workout structure.

Example:

```text
Squat + RDL + Cindy
Started 7:31 PM

WARMUP
4 rounds

Dead Hang
[ Done ]

Tabletop
[ Done ]

Deep Squat Stretch
[ Done ]

90-90 Hip Stretch
[ Done ]


STRENGTH

Back Squat

Warmup
Set    Reps    Weight
1      [12]    [   ]
2      [12]    [   ]

Working
Set    Reps    Weight
1      [  ]    [   ]
2      [  ]    [   ]
3      [  ]    [   ]

Last time
Aug 9
Warmup: 12×95, 12×135
Working: 8×225, 7×205, 8×185


Romanian Deadlift

Warmup
Set    Reps    Weight
1      [12]    [   ]
2      [12]    [   ]

Working
Set    Reps    Weight
1      [  ]    [   ]
2      [  ]    [   ]
3      [  ]    [   ]

Last time
Aug 9
12×95, 12×135
8×225, 8×205, 7×185


CONDITIONING

Cindy
20 minute AMRAP

5 Pull-ups
10 Push-ups
15 Air Squats

Rounds completed
[     ]

Extra reps
[     ]

[ Finish Workout ]
```

The exact visual treatment is open to the designer, but the interaction model should remain this simple.

---

# Data Entry Principles

## Optimize for numeric entry

The most common interactions are entering:

- Reps
- Weight
- Duration
- Distance
- Rounds

Inputs should be visually obvious and large enough to use quickly.

Where supported by the browser, use numeric input hints, but do not depend on modern mobile-browser behavior for basic usability.

Avoid:

- Custom sliders
- Drag controls
- Gesture interactions
- Complex increment/decrement widgets
- Inline keyboards
- Canvas-based controls
- Contenteditable fields

Plain HTML form controls are preferred.

---

# Pre-population

Programmed values should appear automatically.

For example, if a set is programmed for 12 reps:

```text
Reps
[12]
```

The actual result should begin with the programmed value as a convenient default when appropriate.

The user should only need to change it when reality differs from the program.

For a prescribed but unspecified load:

```text
Weight
[    ]
```

Do not invent or automatically populate a load unless it comes from explicit program data or a deliberately implemented history feature.

---

# Set Completion

The UI should make it visually clear which work has been completed.

This may be done with a simple checkbox or completed-state treatment.

For example:

```text
[✓]  Set 1    8 reps    225 lb
[ ]  Set 2    _ reps    ___ lb
[ ]  Set 3    _ reps    ___ lb
```

Completion should not hide previous sets.

The user should continue to see the full exercise and all recorded values.

---

# History Peek

Historical context is important, but it should not dominate the page.

For each programmed exercise, provide a small **Last Time** or **Recent** section immediately adjacent to the current data entry.

Example:

```text
Last time — Aug 9
8 × 225
7 × 205
8 × 185
```

This should answer:

> What did I do the last time I encountered this exercise in a similar workout?

At minimum show:

- Date
- Actual reps
- Actual load

For other exercise types, show the relevant measurements.

Example:

```text
Last time — Aug 7
400 m — 1:42
400 m — 1:47
400 m — 1:51
```

The history display should be compact enough that it does not require a separate screen during normal use.

---

# Deeper Exercise History

Optionally provide a plain text link such as:

```text
View recent history
```

This may reveal or navigate to a simple recent-history view.

Example:

```text
Back Squat — Recent

Aug 9
8 × 225
7 × 205
8 × 185

Aug 2
8 × 215
8 × 195
9 × 175

Jul 26
8 × 205
8 × 185
8 × 165
```

Do not turn this into a charting or analytics experience in this design revision.

A chronological list is sufficient.

---

# Program History

The user should also be able to see recently completed workouts.

A minimal history view could be:

```text
Workout History

Aug 9
Squat + RDL + Cindy

Aug 7
Push + Pull

Aug 4
Full Body A

Jul 31
Squat + RDL + Cindy
```

Selecting a prior workout may show its recorded results.

The goal is simple recall, not reporting or trend analysis.

---

# Repeated / Timed Workout Blocks

Container semantics from the programming model should be reflected directly and plainly.

Examples:

```text
4 rounds
```

```text
20 minute AMRAP
```

```text
EMOM — 12 minutes
```

```text
3 rounds
```

Avoid inventing visual metaphors for these structures.

Text labels and straightforward grouping are preferred.

---

# Failure and Descending Sets

The UI must not assume that programmed and actual results match.

For example:

```text
Working Sets

Set    Reps    Weight
1      [8]     [225]
2      [7]     [205]
3      [9]     [185]
```

A user must always be able to overwrite programmed reps or loads.

Do not visually treat deviation from the program as an error.

A workout log records what happened.

---

# Notes

Notes are secondary.

Where supported, allow:

- One workout-level notes field
- Optional exercise-level or set-level notes

These should be visually de-emphasized.

Example:

```text
Notes
[ Left knee felt stiff on first set ]
```

Do not place notes between the user and core numeric entry.

---

# Finish Workout

At the bottom of the active workout page, provide one obvious action:

```text
[ Finish Workout ]
```

The user should not be required to complete every field.

A workout may legitimately contain:

- Skipped exercises
- Failed attempts
- Partially completed conditioning
- Missing measurements

Finishing records what occurred.

After finishing, show a very compact summary.

Example:

```text
Workout Complete

Squat + RDL + Cindy
58 min

Back Squat
8×225
7×205
8×185

RDL
8×225
8×205
7×185

Cindy
11 rounds + 7 reps
```

No celebration animation or gamification is necessary.

---

# Visual Language

The desired visual language is:

- Functional
- Restrained
- Typographically clear
- High contrast
- Mostly monochrome
- Sparse use of borders
- Sparse use of icons
- Generous but not wasteful spacing

The hierarchy should primarily come from:

- Font size
- Font weight
- Indentation
- Rules/dividers
- Whitespace

Avoid visual dependence on color.

The interface should remain comprehensible in grayscale.

---

# Browser Constraints

Assume the application may run on old or incomplete browser implementations.

The design should therefore be achievable with:

- Semantic HTML
- Basic forms
- Basic CSS
- Vertical document flow
- Standard links and buttons
- Minimal JavaScript

Do not design interactions that require:

- CSS Grid
- Complex flex layouts
- CSS animations
- Sticky headers
- Drag and drop
- Swipe gestures
- SVG-dependent controls
- Canvas
- WebGL
- Custom fonts
- Complex modal frameworks
- Client-side routing
- Hover-only interactions

A layout built with ordinary block flow, simple tables where appropriate, and basic form elements is ideal.

Progressive enhancement is acceptable, but the core workout entry experience must work without advanced browser features.

---

# Responsive Layout

The interface should work from small e-reader-sized browser windows through desktop screens.

Prefer a single-column layout.

On wider screens, do not dramatically redesign the interface. Simply allow the central content column to remain comfortably readable.

Tables used for sets should remain narrow and simple.

Example:

```text
Set    Reps    Weight
1      [ 8 ]   [225]
2      [ 7 ]   [205]
3      [ 8 ]   [185]
```

This structure should remain usable even at approximately 600 px viewport width.

---

# Navigation

Keep global navigation minimal.

A sufficient structure may be:

```text
Workouts | History
```

During an active workout, the workout itself should dominate.

Avoid persistent navigation sidebars, bottom nav systems, hamburger menus, and nested navigation hierarchies unless they prove necessary later.

---

# Design Deliverables

Produce mockups for these core states:

1. Workout selection
2. Workout overview before starting
3. Active workout with partially completed sets
4. Active workout showing compact "Last Time" history
5. Conditioning / AMRAP entry
6. Completed workout summary
7. Recent workout history
8. Recent history for one exercise

Mockups should demonstrate the system using the **Squat + RDL + Cindy** workout.

Prioritize interaction clarity and information hierarchy over visual polish.

---

# Guiding Principle

The application should feel less like a modern fitness app and more like an exceptionally well-designed digital workout notebook.

The ideal user experience is:

> Open workout. See what to do. See what I did last time. Enter today's numbers. Finish.

Anything that does not materially improve that workflow should be treated with suspicion.