import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { AccreditMePreset, PRESET_OVERRIDES, RENDERED_COMPONENTS } from './accreditme-preset';

// ACC-90 — the trimmed preset changes nothing on screen. It is built from
// Aura's base and only the components the app renders; full Aura with the SAME
// overrides is the reference. Every component kept must carry exactly Aura's
// tokens with our overrides applied, and the primitive, semantic and css
// sections must be identical. A component left out is check:theme-components'
// business, not this spec's: this one proves what is kept is unchanged.

type Tokens = Record<string, unknown>;

// What check:theme-components computes from the code today: every primeng
// module the app imports, with what those import, by each one's style name,
// where Aura has tokens. Pinned here so a key dropped from the preset fails
// this spec by name, not only the scan. A component added to the app adds its
// key in both places (the scan says which).
const RENDERED_KEYS = [
  'badge', 'button', 'checkbox', 'confirmdialog', 'datatable', 'datepicker', 'dialog', 'drawer', 'iconfield',
  'inputnumber', 'inputtext', 'message', 'paginator', 'popover', 'progressspinner', 'radiobutton', 'ripple',
  'select', 'selectbutton', 'stepper', 'tag', 'textarea', 'togglebutton', 'toggleswitch', 'tooltip', 'treetable',
  'virtualscroller',
];

// The overrides as they stood when the preset was trimmed (dev 9f35689). Both
// sides of the comparison below apply PRESET_OVERRIDES, so a changed override
// would move both and pass; this fingerprint is what notices. ACC-90 changes no
// token. A deliberate theme change updates it, with its reason in the commit.
const OVERRIDES_FINGERPRINT = 'bd7444e7';

/** JSON with sorted keys, so the fingerprint does not depend on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Tokens).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Tokens)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a, 32-bit, as hex. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const full = definePreset(Aura, PRESET_OVERRIDES) as unknown as Tokens & { components: Tokens };
const trimmed = AccreditMePreset as unknown as Tokens & { components: Tokens };

describe('AccreditMePreset — only rendered components, nothing changed (ACC-90)', () => {
  it('carries the rendered components and nothing else', () => {
    for (const key of RENDERED_KEYS) expect(Object.keys(trimmed.components)).withContext(`"${key}" is rendered`).toContain(key);
    expect(Object.keys(trimmed.components).sort()).toEqual([...RENDERED_KEYS].sort());
    expect(Object.keys(RENDERED_COMPONENTS).sort()).toEqual([...RENDERED_KEYS].sort());
    // Non-vacuity: full Aura carries far more, so the comparison below means something.
    expect(Object.keys(full.components).length).toBeGreaterThan(Object.keys(trimmed.components).length + 50);
  });

  for (const key of RENDERED_KEYS) {
    it(`${key}: the same tokens as full Aura with the same overrides`, () => {
      expect(full.components[key]).withContext(`full Aura has no "${key}"`).toBeDefined();
      expect(trimmed.components[key]).withContext(key).toEqual(full.components[key]);
    });
  }

  for (const section of ['primitive', 'semantic', 'css'] as const) {
    it(`${section}: identical to full Aura with the same overrides`, () => {
      expect(trimmed[section]).withContext(`${section} missing`).toBeDefined();
      expect(trimmed[section]).toEqual(full[section]);
    });
  }

  it('the overrides are the ones the app had (fingerprint)', () => {
    expect(fingerprint(canonical(PRESET_OVERRIDES)))
      .withContext('PRESET_OVERRIDES changed: ACC-90 changes no token. A deliberate theme change updates OVERRIDES_FINGERPRINT')
      .toBe(OVERRIDES_FINGERPRINT);
  });

  it('the overrides are applied (the comparison is not vacuous)', () => {
    const button = trimmed.components['button'] as { root: { borderRadius: string } };
    expect(button.root.borderRadius).toBe('var(--am-radius-button)');
    const semantic = trimmed['semantic'] as { focusRing: { width: string } };
    expect(semantic.focusRing.width).toBe('var(--am-focus-ring-width)');
  });
});
