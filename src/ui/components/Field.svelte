<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { FullAutoFill } from 'svelte/elements';

  let {
    label,
    id = undefined,
    value = $bindable(''),
    type = 'text',
    inputmode = undefined,
    autocomplete = undefined,
    placeholder = undefined,
    name = undefined,
    disabled = false,
    required = false,
    maxlength = undefined,
    hint = undefined,
    error = undefined,
    children = undefined,
    class: className = ''
  }: {
    /** Label text. Rendered above the control in the label token style. */
    label: string;
    /** Element id. The label points at it. */
    id?: string;
    /** Bound value. Use for text, number, date, and time inputs. */
    value?: string;
    type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'tel' | 'search' | 'password';
    /** Passed straight to the native input. */
    inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
    /** Passed straight to the native input. */
    autocomplete?: FullAutoFill;
    placeholder?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    maxlength?: number;
    /** Helper line under the control. */
    hint?: string;
    /** Error line under the control. Replaces the hint. */
    error?: string;
    /** Render a custom control instead of the built-in input. */
    children?: Snippet;
    class?: string;
  } = $props();

  const classes = $derived(['field', disabled ? 'field--disabled' : '', className].filter(Boolean).join(' '));
  const errorId = $derived(id ? `${id}-error` : undefined);
</script>

<div class={classes}>
  <label class="field__label" for={children ? undefined : id}>{label}</label>

  {#if children}
    {@render children()}
  {:else}
    <input
      class="field__control"
      {id}
      {type}
      {inputmode}
      {autocomplete}
      {placeholder}
      {name}
      {disabled}
      {required}
      maxlength={maxlength}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errorId : undefined}
      bind:value
    />
  {/if}

  {#if error}
    <span class="field__error" id={errorId}>{error}</span>
  {:else if hint}
    <span class="field__hint">{hint}</span>
  {/if}
</div>
