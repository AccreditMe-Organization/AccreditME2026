// Rebrands PrimeNG's Aura preset with AccreditMe's brand primary color
// (frontend/src/styles/tokens.scss's --am-blue-primary/--am-blue-light),
// so PrimeNG components (buttons, focus rings, links, selected states)
// match the rest of the app's chrome instead of Aura's stock emerald.
//
// Only `primary` is overridden. Aura's default neutral `surface` scale
// (slate) is left as-is deliberately — tokens.scss only defines single-role
// neutral colors (surface/card/border/text), not a full 0-950 tonal ramp,
// and Aura's slate scale already closely matches those exact values at the
// shades PrimeNG actually uses. Replacing the whole ramp with one repeated
// value would flatten hover/active states across every component instead.
import { definePreset } from '@primeuix/themes';
import Aura from '@primeng/themes/aura';

export const AccreditMePreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#eef3f6',
      100: '#dee6ed',
      200: '#bed3e4',
      300: '#8cbade',
      400: '#64b5d9', // --am-blue-light
      500: '#2e6fa3', // --am-blue-primary
      600: '#24577f',
      700: '#1b415f',
      800: '#132e44',
      900: '#0c1e2c',
      950: '#07131c',
    },
  },
});
