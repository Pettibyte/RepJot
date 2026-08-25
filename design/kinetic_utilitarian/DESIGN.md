---
name: Kinetic Utilitarian
colors:
  surface: '#fbf9f9'
  surface-dim: '#dbdad9'
  surface-bright: '#fbf9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f3'
  surface-container: '#efeded'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e3e2e2'
  on-surface: '#1b1c1c'
  on-surface-variant: '#4c4546'
  inverse-surface: '#303031'
  inverse-on-surface: '#f2f0f0'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#5d5f5f'
  on-secondary: '#ffffff'
  secondary-container: '#dfe0e0'
  on-secondary-container: '#616363'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1b1b1b'
  on-tertiary-container: '#848484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c7'
  on-secondary-fixed: '#1a1c1c'
  on-secondary-fixed-variant: '#454747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#fbf9f9'
  on-background: '#1b1c1c'
  surface-variant: '#e3e2e2'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '700'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 36px
    fontWeight: '700'
    lineHeight: '1.0'
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-margin: 20px
  stack-gap: 32px
---

## Brand & Style
The design system is rooted in high-utility minimalism and extreme functionalism. Designed for high-intensity environments—gyms, outdoor tracks, and low-light studios—the system prioritizes rapid data ingestion and action over aesthetic flourishes. 

The emotional response should be one of "calm focus" and "objective clarity." By removing all decorative elements, illustrations, and depth metaphors, the interface becomes a transparent tool for workout execution. The style borrows from industrial labeling and scientific instrumentation: everything is essential, and nothing is ornamental.

## Colors
The palette is strictly monochrome to ensure maximum contrast and accessibility across all screen types and lighting conditions. 

- **Primary:** Pure Black (#000000) for all primary text, borders, and high-emphasis actions.
- **Secondary:** Pure White (#FFFFFF) for the main canvas and inverted text.
- **Neutrals:** A limited scale of grays used only for secondary information or disabled states. 
- **Functional Meaning:** Do not use color (red/green) to signify success or failure. Use iconography (Checkmarks/X) or explicit text labels ("VALID", "INCOMPLETE") to convey status.

## Typography
The system uses **Inter** for its neutral, highly legible grotesque qualities, ensuring that instructions are readable at a glance. **JetBrains Mono** is introduced for data-heavy elements (reps, sets, timers) to provide a distinct, "instrumented" feel and to ensure tabular numbers align perfectly.

Headlines should use tight tracking and heavy weights. Body text must maintain generous line height for readability during physical activity.

## Layout & Spacing
The layout follows a strict vertical document flow. Elements are stacked linearly to reflect the sequential nature of a workout.

- **Grid:** A simple 12-column fluid grid for desktop, collapsing to a single-column stack on mobile.
- **Whitespace:** Use generous vertical padding (`stack-gap`) between logical sections to prevent accidental taps and reduce visual clutter.
- **Alignment:** All text and primary actions are left-aligned to establish a clear "scan line" for the eye.
- **Margins:** Maintain a minimum 20px "safe zone" on all edges of the screen.

## Elevation & Depth
This design system is intentionally flat. Do not use shadows, blurs, or gradients.

Hierarchy is established exclusively through:
1. **Scale:** Larger text for primary metrics.
2. **Weight:** Bolder strokes for active elements.
3. **Inversion:** Using a black background with white text to highlight the "Active" or "Current" state.
4. **Borders:** 2px solid black strokes define containers and input fields.

## Shapes
All UI elements use a sharp 0px radius. This reinforces the utilitarian, industrial aesthetic. Buttons, input fields, and cards are all strictly rectangular. This ensures that the boundaries of tap targets are unambiguous and maximized within their allocated space.

## Components
Components follow a "What You See Is What You Get" philosophy, mimicking standardized forms and terminal interfaces.

- **Buttons:** Large, rectangular blocks. Primary buttons are solid black with white text. Secondary buttons are white with a 2px black border. Minimum height: 56px for touch accessibility.
- **Input Fields:** 2px black bottom-border only (for a form-like feel) or a full 2px box. Place labels above the input in `label-md` (JetBrains Mono).
- **Cards:** Simple 1px or 2px black outlines. No shadows. Use for grouping workout sets or exercise descriptions.
- **Checkboxes & Radios:** Large (24x24px) squares. Checked state is indicated by a solid black fill or a heavy "X" mark.
- **Timers:** Displayed in `data-lg` (JetBrains Mono) for maximum legibility and to prevent "jittering" as numbers change.
- **Progress Indicators:** Simple horizontal bars with a solid black fill. Avoid circular loaders.
- **Focus States:** High-visibility 4px offset outline or inverted colors to ensure keyboard and accessibility navigation is unmistakable.