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
import Aura from '@primeng/themes/aura';

const token = (name: string): string => `var(--am-${name})`;

// A tint or shade of the brand colour, for the ramp positions the design does
// not name. Derived, not literal, so the ramp follows --am-primary-600.
const mix = (base: string, other: 'white' | 'black', percent: number): string =>
  `color-mix(in srgb, ${token(base)}, ${other} ${percent}%)`;

export const AccreditMePreset = definePreset(Aura, {
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

  // The one component token overridden: Aura derives a button's radius from
  // the form field's, so setting fields to 4px (control) would also square
  // every button off. The design gives buttons their own step — 6px.
  components: {
    button: {
      root: {
        borderRadius: token('radius-button'),
      },
    },
  },
});
