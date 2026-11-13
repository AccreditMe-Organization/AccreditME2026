// AccreditMe's PrimeNG preset: Aura, re-pointed at the design system tokens
// (ACC-111). Every value below is a var() onto src/styles/design-tokens.scss,
// or derived from one with color-mix() — there are no colour literals here, so
// a token change reaches PrimeNG components and Tailwind utilities alike.
//
// PrimeNG components never read our custom properties directly, only their own
// generated --p-* variables. A var() placed in a token here is emitted verbatim
// into those --p-* variables, so the browser resolves it at use — which is how
// one definition serves both systems.
//
// Scope is the SEMANTIC layer: brand colour, highlight (selected row /
// option), form fields, text, borders, focus ring, the modal scrim. Component
// tokens (a button's disabled fill, a dialog's padding) are left to Aura until
// a shared component owns that surface; overriding them here would restyle
// screens this ticket does not migrate for no rule the design states. The one
// exception, the button radius, is explained where it is set.
//
// darkModeSelector is false in app.config.ts, so only the light scheme exists.
import { definePreset } from '@primeuix/themes';
import base from '@primeuix/themes/aura/base';
import auraCss from '@primeuix/themes/aura/css';
import type { ExtendedCSS } from '@primeuix/themes/types';
import badge from '@primeuix/themes/aura/badge';
import button from '@primeuix/themes/aura/button';
import checkbox from '@primeuix/themes/aura/checkbox';
import confirmdialog from '@primeuix/themes/aura/confirmdialog';
import datatable from '@primeuix/themes/aura/datatable';
import datepicker from '@primeuix/themes/aura/datepicker';
import dialog from '@primeuix/themes/aura/dialog';
import drawer from '@primeuix/themes/aura/drawer';
import iconfield from '@primeuix/themes/aura/iconfield';
import inputnumber from '@primeuix/themes/aura/inputnumber';
import inputtext from '@primeuix/themes/aura/inputtext';
import message from '@primeuix/themes/aura/message';
import paginator from '@primeuix/themes/aura/paginator';
import popover from '@primeuix/themes/aura/popover';
import progressspinner from '@primeuix/themes/aura/progressspinner';
import radiobutton from '@primeuix/themes/aura/radiobutton';
import ripple from '@primeuix/themes/aura/ripple';
import select from '@primeuix/themes/aura/select';
import selectbutton from '@primeuix/themes/aura/selectbutton';
import stepper from '@primeuix/themes/aura/stepper';
import tag from '@primeuix/themes/aura/tag';
import textarea from '@primeuix/themes/aura/textarea';
import togglebutton from '@primeuix/themes/aura/togglebutton';
import toggleswitch from '@primeuix/themes/aura/toggleswitch';
import tooltip from '@primeuix/themes/aura/tooltip';
import treetable from '@primeuix/themes/aura/treetable';
import virtualscroller from '@primeuix/themes/aura/virtualscroller';

// ACC-90 — Aura as Aura composes itself (@primeuix/themes/aura: base, every
// component's tokens, css), with only the components this app RENDERS. Full
// Aura carries tokens for 88 components; the app's primeng imports reach 27
// (its direct imports and what they import in turn, by each module's style
// name). The rest were ~70 kB in the start-up bundle for nothing.
// check:theme-components keeps this list equal to what is rendered, in both
// directions, and accreditme-preset.spec.ts proves the tokens are Aura's own.
export const RENDERED_COMPONENTS = {
  badge,
  button,
  checkbox,
  confirmdialog,
  datatable,
  datepicker,
  dialog,
  drawer,
  iconfield,
  inputnumber,
  inputtext,
  message,
  paginator,
  popover,
  progressspinner,
  radiobutton,
  ripple,
  select,
  selectbutton,
  stepper,
  tag,
  textarea,
  togglebutton,
  toggleswitch,
  tooltip,
  treetable,
  virtualscroller,
};

// Aura's global css, as Aura itself imports it: the module's default export,
// a string. Its .d.ts declares a named export instead, so the default reads as
// the namespace to TypeScript; the cast states what the runtime value is.
const css = auraCss as unknown as ExtendedCSS;

const AuraRendered = { ...base, components: RENDERED_COMPONENTS, css };

const token = (name: string): string => `var(--am-${name})`;

// A tint or shade of the brand colour, for the ramp positions the design does
// not name. Derived, not literal, so the ramp follows --am-primary-600.
const mix = (base: string, other: 'white' | 'black', percent: number): string =>
  `color-mix(in srgb, ${token(base)}, ${other} ${percent}%)`;

// The overrides, unchanged. Exported so a spec can apply them to full Aura.
export const PRESET_OVERRIDES = {
  semantic: {
    // Aura's components read shades of this ramp directly (tags, messages,
    // toggle buttons), so every position needs a value. The four the design
    // names are the tokens; the rest are mixed from them.
    primary: {
      50: token('primary-50'),
      100: token('primary-100'),
      200: mix('primary-600', 'white', 70),
      300: mix('primary-600', 'white', 50),
      400: mix('primary-600', 'white', 25),
      500: token('primary-600'),
      600: token('primary-700'),
      700: mix('primary-700', 'black', 15),
      800: mix('primary-700', 'black', 35),
      900: mix('primary-700', 'black', 55),
      950: mix('primary-700', 'black', 70),
    },

    // 2px at a 2px offset (artboard 9). Aura ships 1px.
    focusRing: {
      width: token('focus-ring-width'),
      style: 'solid',
      color: token('focus-ring'),
      offset: token('focus-ring-offset'),
      shadow: 'none',
    },

    formField: {
      borderRadius: token('radius-control'),
    },

    colorScheme: {
      light: {
        primary: {
          color: token('primary-600'),
          contrastColor: token('surface-raised'),
          hoverColor: token('primary-700'),
          activeColor: token('primary-700'),
        },
        // Selected row / option #E4EEF6, per artboard 1. Ink stays ink: a
        // selected value is still a value. check:contrast asserts ink-700 on
        // primary-100 (6.40); ink-900 is darker, so it clears it further.
        highlight: {
          background: token('primary-100'),
          focusBackground: token('primary-100'),
          color: token('ink-900'),
          focusColor: token('ink-900'),
        },
        mask: {
          background: token('overlay-scrim'),
          color: token('border'),
        },
        // The corrected control border (artboard 6, ACC-111 changelog):
        // #8A94A6 at rest, #5A6779 on hover, #E2E8F0 only when disabled.
        // #CBD5E0 — what every field was drawn with — is 1.49:1 and gone.
        // Controls sit on white; on the #F4F7FA ground the rest border is
        // 2.86:1, which is why the field background is white, not surface.
        formField: {
          background: token('control-bg'),
          disabledBackground: token('surface'),
          filledBackground: token('control-bg'),
          filledHoverBackground: token('control-bg'),
          filledFocusBackground: token('control-bg'),
          borderColor: token('control-border'),
          hoverBorderColor: token('control-border-hover'),
          focusBorderColor: token('primary-600'),
          invalidBorderColor: token('danger-ink'),
          color: token('ink-900'),
          disabledColor: token('ink-300'),
          placeholderColor: token('ink-300'),
          invalidPlaceholderColor: token('danger-ink'),
          floatLabelColor: token('ink-500'),
          floatLabelFocusColor: token('primary-600'),
          floatLabelActiveColor: token('ink-500'),
          floatLabelInvalidColor: token('danger-ink'),
          iconColor: token('ink-500'),
          shadow: 'none',
        },
        text: {
          color: token('ink-900'),
          hoverColor: token('ink-900'),
          mutedColor: token('ink-500'),
          hoverMutedColor: token('ink-700'),
        },
        content: {
          background: token('surface-raised'),
          hoverBackground: token('primary-50'),
          borderColor: token('border'),
          color: '{text.color}',
          hoverColor: '{text.hover.color}',
        },
        overlay: {
          select: { background: token('surface-raised'), borderColor: token('border'), color: '{text.color}' },
          popover: { background: token('surface-raised'), borderColor: token('border'), color: '{text.color}' },
          modal: { background: token('surface-raised'), borderColor: token('border'), color: '{text.color}' },
        },
        list: {
          option: {
            focusBackground: token('primary-50'),
            selectedBackground: '{highlight.background}',
            selectedFocusBackground: '{highlight.focus.background}',
            color: '{text.color}',
            focusColor: '{text.hover.color}',
            selectedColor: '{highlight.color}',
            selectedFocusColor: '{highlight.focus.color}',
            icon: { color: token('ink-500'), focusColor: token('ink-700') },
          },
          optionGroup: { background: 'transparent', color: '{text.muted.color}' },
        },
      },
    },
  },

  components: {
    // Aura derives a button's radius from the form field's, so setting fields
    // to 4px (control) would also square every button off. The design gives
    // buttons their own step — 6px.
    button: {
      root: {
        borderRadius: token('radius-button'),
      },
    },
    // ACC-120 slice 9e — Aura draws a success message as green.600 on green.50
    // (3.15:1) and an error as red.600 on red.50 (4.41:1): both under 4.5:1
    // for text. They now read the design's chip pairs, which check:contrast
    // asserts (success-ink on success-bg, danger-ink on danger-bg), and
    // message.contrast.spec.ts measures the rendered message itself.
    message: {
      colorScheme: {
        light: {
          success: {
            background: token('success-bg'),
            color: token('success-ink'),
            outlined: { color: token('success-ink'), borderColor: token('success-ink') },
            simple: { color: token('success-ink') },
          },
          error: {
            background: token('danger-bg'),
            color: token('danger-ink'),
            outlined: { color: token('danger-ink'), borderColor: token('danger-ink') },
            simple: { color: token('danger-ink') },
          },
        },
      },
    },
  },
};

export const AccreditMePreset = definePreset(AuraRendered, PRESET_OVERRIDES);
