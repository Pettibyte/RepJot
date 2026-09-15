// The unit pill.
// Phase 17. REQUIREMENTS 12.1-12.7.

import { describe, expect, test } from 'bun:test';

import UnitPill from '../src/ui/components/UnitPill.svelte';
import { html as renderHtml } from './support/render';

describe('UnitPill', () => {
  test('shows the current unit as a tappable control', () => {
    const html = renderHtml(UnitPill, {
      unit: 'lb',
      compatibleUnits: ['lb', 'kg'],
      disabled: false,
      label: 'Change unit for weight'
    });

    expect(html).toContain('class="pill unit-pill"');
    expect(html).toContain('>lb<');
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Change unit for weight. Currently lb. Tap to change."');
  });

  test('a dimension with one unit renders nothing', () => {
    // Reps has no other unit, so tapping would do nothing. A control that
    // cannot act is noise. REQUIREMENT 12.1.
    const html = renderHtml(UnitPill, {
      unit: 'reps',
      compatibleUnits: ['reps'],
      disabled: false,
      label: 'Change unit for reps'
    });

    expect(html).not.toContain('<button');
    // Svelte leaves hydration comment markers behind. No element is drawn.
    expect(html.replace(/<!--[^>]*-->/g, '').trim()).toBe('');
  });

  test('a disabled pill keeps its label but cannot be activated', () => {
    const html = renderHtml(UnitPill, {
      unit: 'kg',
      compatibleUnits: ['kg', 'lb'],
      disabled: true,
      label: 'Change unit for weight'
    });

    expect(html).toContain('disabled');
    // The unit is still readable.
    expect(html).toContain('>kg<');
  });

  test('the pill carries no inline color, shadow, or radius', () => {
    const html = renderHtml(UnitPill, {
      unit: 'lb',
      compatibleUnits: ['lb', 'kg'],
      disabled: false,
      label: 'x'
    });
    expect(html).not.toMatch(/style="[^"]*(color|shadow|radius)/);
  });
});
