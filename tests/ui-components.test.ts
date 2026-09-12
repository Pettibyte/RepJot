import { describe, expect, test } from 'bun:test';
import Button from '../src/ui/components/Button.svelte';
import Icon from '../src/ui/components/Icon.svelte';
import { html } from './support/render';

describe('Icon', () => {
  test('a decorative icon renders aria-hidden="true"', () => {
    const out = html(Icon, { name: 'check_circle', decorative: true });
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<svg');
    expect(out).not.toContain('aria-label');
  });

  test('a labeled icon exposes the label to assistive tech', () => {
    const out = html(Icon, { name: 'timer', label: 'Rest timer' });
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Rest timer"');
    expect(out).not.toContain('aria-hidden');
  });

  test('a non-decorative icon without a label throws', () => {
    expect(() => html(Icon, { name: 'timer' })).toThrow(/needs a label/);
  });

  test('an unknown material glyph throws', () => {
    expect(() => html(Icon, { name: 'nope', label: 'x' })).toThrow(/manifest\.json/);
  });

  test('a local svg icon uses an img with alt text', () => {
    const out = html(Icon, { name: 'kettlebell', kind: 'svg', label: 'Kettlebell' });
    expect(out).toContain('<img');
    expect(out).toContain('src="./icons/kettlebell.svg"');
    expect(out).toContain('alt="Kettlebell"');
  });
});

describe('Button', () => {
  test('renders an anchor when href is set', () => {
    const out = html(Button, { href: '#/workout' });
    expect(out).toContain('<a');
    expect(out).toContain('href="#/workout"');
    expect(out).not.toContain('<button');
  });

  test('renders a button with type="button" when href is not set', () => {
    const out = html(Button, {});
    expect(out).toContain('<button');
    expect(out).toContain('type="button"');
    expect(out).not.toContain('<a ');
  });

  test('applies the variant class', () => {
    expect(html(Button, { variant: 'secondary' })).toContain('btn btn--secondary');
    expect(html(Button, { variant: 'danger' })).toContain('btn btn--danger');
  });

  test('forwards aria attributes', () => {
    expect(html(Button, { 'aria-label': 'Start session' })).toContain('aria-label="Start session"');
  });
});
