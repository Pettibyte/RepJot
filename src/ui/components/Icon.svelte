<script lang="ts">
  import manifest from '../icons/manifest.json';

  interface ManifestIcon {
    name: string;
    sourceKey: string;
    viewBox: string;
    path: string;
  }

  const icons: ManifestIcon[] = (manifest as { icons: ManifestIcon[] }).icons;
  const byName = new Map(icons.map((icon) => [icon.name, icon]));

  let {
    name,
    label = '',
    decorative = false,
    kind = 'material',
    size = 'md',
    class: className = ''
  }: {
    /** Material glyph name from `src/ui/icons/manifest.json`, or a local SVG base name. */
    name: string;
    /** Accessible name. Required unless `decorative` is true. */
    label?: string;
    /** Set when the icon repeats a visible text label. */
    decorative?: boolean;
    /** 'material' renders an inline SVG path from the manifest. 'svg' renders a local file. */
    kind?: 'material' | 'svg';
    /** Rendered size step. */
    size?: 'sm' | 'md' | 'lg';
    class?: string;
  } = $props();

  const glyph = $derived.by(() => {
    if (!decorative && label.trim() === '') {
      throw new Error(
        `Icon "${name}" needs a label. Set decorative when the icon repeats visible text.`,
      );
    }
    if (kind === 'material' && !byName.has(name)) {
      throw new Error(
        `Icon "${name}" is not in src/ui/icons/manifest.json. Add it there and run bun run icons:build.`,
      );
    }
    return kind === 'material' ? byName.get(name) : undefined;
  });
  const sizeClass = $derived(size === 'md' ? '' : `icon--${size}`);
  const classes = $derived(['icon', sizeClass, className].filter(Boolean).join(' '));
</script>

{#if kind === 'material' && glyph}
  <svg
    class={classes}
    viewBox={glyph.viewBox}
    xmlns="http://www.w3.org/2000/svg"
    focusable="false"
    role={decorative ? undefined : 'img'}
    aria-hidden={decorative ? 'true' : undefined}
    aria-label={decorative ? undefined : label}
  >
    <path d={glyph.path} />
  </svg>
{:else if kind === 'svg'}
  <img class={classes} src="./icons/{name}.svg" alt={decorative ? '' : label} width="24" height="24" />
{/if}
