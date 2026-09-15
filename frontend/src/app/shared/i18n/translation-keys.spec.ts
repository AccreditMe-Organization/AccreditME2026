import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

// ACC-78 — the control that did not exist.
//
// ngx-translate renders the raw key string when a key is missing. Nothing
// throws, nothing logs, no compiler sees it: "user.invited" is displayed to a
// user as though it were a label. That is exactly how StatusChipComponent
// shipped a broken chip in this ticket — its own comment predicted the failure
// and nothing caught it anyway, because there was nothing to catch it with.
//
// Two checks, with deliberately different strength. Read the difference before
// trusting this file:
//
//   PARITY (below) is a REAL control. It needs no maintenance, covers every
//   key in both files automatically, and cannot go stale.
//
//   The CONCATENATED-KEY REGISTRY is NOT a real control. It is a maintained
//   list, and it covers only the sites written into it.
//
// Why the registry cannot be automatic, stated plainly so nobody assumes it
// grows by itself:
//
//   1. A key built by concatenation only exists at runtime. `'task.status.' +
//      task.status.toLowerCase()` is a string expression; no tooling can
//      enumerate what it produces without executing the app against real data.
//   2. The value sets are TypeScript UNION TYPES ('JOINED' | 'LEFT' | ...),
//      which are erased at compile time. A spec cannot iterate them. They are
//      therefore hand-listed below and will drift when an enum gains a value.
//   3. A Karma spec runs in a browser with no filesystem, so it cannot scan
//      source for new concatenation sites. A NEW site added tomorrow is not
//      covered by this file and nothing will say so.
//
// The genuinely general control is a static scan of the source at build time,
// which does not exist. Until it does, this file narrows the hole; it does not
// close it.
const flatten = (obj: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value, `${prefix}${key}.`));
    } else {
      out[`${prefix}${key}`] = String(value);
    }
  }
  return out;
};

// ACC-94 — counted strings live under a top-level "plural" section, one object
// of plural categories per string, which ngx-translate never receives (see
// core/formatting/plural-catalog.ts). They are checked as units below; the flat
// maps hold everything ngx-translate does receive.
type Json = Record<string, unknown>;
const withoutPlural = (file: Json): Json =>
  Object.fromEntries(Object.entries(file).filter(([key]) => key !== 'plural'));

const pluralLeaves = (node: unknown, prefix = ''): Record<string, Json> => {
  const out: Record<string, Json> = {};
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node as Json)) {
    const path = `${prefix}${key}`;
    if (value !== null && typeof value === 'object' && 'other' in (value as Json)) {
      out[path] = value as Json;
    } else if (value !== null && typeof value === 'object') {
      Object.assign(out, pluralLeaves(value, `${path}.`));
    } else {
      out[path] = { notAPluralObject: String(value) };
    }
  }
  return out;
};

const EN = flatten(withoutPlural(en as Json));
const AR = flatten(withoutPlural(ar as Json));
const EN_PLURAL = pluralLeaves((en as Json)['plural']);
const AR_PLURAL = pluralLeaves((ar as Json)['plural']);

// Every place in the app that builds a key by string concatenation, with the
// values it can produce. Found by grepping for `'prefix.' +` and for template
// literals of the same shape. MAINTAINED BY HAND — see the note above.
const CONCATENATED_KEYS: { site: string; prefix: string; values: string[] }[] = [
  // StatusChipComponent, via user-list's labelPrefix override. The override is
  // itself the bug this ticket found: the component's default would have built
  // `user.invited`, and the keys live under `user.status.*`.
  {
    site: 'StatusChipComponent (user-list)',
    prefix: 'user.status',
    values: ['ACTIVE', 'INVITED', 'INACTIVE'],
  },
  // StatusChipComponent, via role-list for a deactivated role.
  {
    site: 'StatusChipComponent (account variant)',
    prefix: 'account',
    values: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'OFFBOARDING'],
  },
  {
    site: 'task-list / task-card',
    prefix: 'task.status',
    values: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE', 'UNASSIGNED'],
  },
  {
    site: 'task-list / task-card',
    prefix: 'task.priority',
    values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  },
  {
    site: 'committee membership history',
    prefix: 'committee.action',
    values: ['JOINED', 'LEFT', 'ROLE_CHANGED'],
  },
  {
    site: 'committee-form / committee-detail',
    prefix: 'committee.frequency',
    values: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'AS_NEEDED'],
  },
  {
    site: 'committee-form',
    prefix: 'committee.reportingToMode',
    values: ['NONE', 'COMMITTEE', 'ROLE'],
  },
];

describe('translation keys (ACC-78)', () => {
  // THE REAL CONTROL. This replaces diffing the two files by hand, which is
  // what was being done before and is not a control at all — it depends on
  // somebody remembering, every time, and it silently passed the missing
  // status-chip keys more than once.
  describe('en/ar parity', () => {
    it('has no key present in en.json but missing from ar.json', () => {
      const missing = Object.keys(EN).filter((key) => !(key in AR));
      expect(missing).withContext(`missing from ar.json: ${missing.join(', ')}`).toEqual([]);
    });

    it('has no key present in ar.json but missing from en.json', () => {
      const missing = Object.keys(AR).filter((key) => !(key in EN));
      expect(missing).withContext(`missing from en.json: ${missing.join(', ')}`).toEqual([]);
    });

    // An empty string resolves to a falsy value and ngx-translate falls back to
    // rendering the key, so an empty translation fails the same way a missing
    // one does — it just looks present in a diff.
    it('has no empty values in either file', () => {
      const empty = [
        ...Object.entries(EN).filter(([, v]) => v.trim() === '').map(([k]) => `en:${k}`),
        ...Object.entries(AR).filter(([, v]) => v.trim() === '').map(([k]) => `ar:${k}`),
      ];
      expect(empty).withContext(`empty: ${empty.join(', ')}`).toEqual([]);
    });
  });

  // ACC-94, decision D1. Plural keys are compared as units, and each language
  // must define exactly the categories its plural rules produce — six for
  // Arabic, two for English — taken from Intl.PluralRules rather than
  // hard-coded, so this follows CLDR. No runtime fallback to "other" is relied
  // on for Arabic: a missing category fails here.
  describe('counted strings (plural section)', () => {
    it('has the same plural keys in both files', () => {
      expect(Object.keys(AR_PLURAL).sort()).toEqual(Object.keys(EN_PLURAL).sort());
    });

    for (const [language, leaves] of [
      ['en', EN_PLURAL],
      ['ar', AR_PLURAL],
    ] as const) {
      it(`defines exactly the ${language} plural categories for every counted string`, () => {
        const expected = [...new Intl.PluralRules(language).resolvedOptions().pluralCategories].sort();
        const wrong = Object.entries(leaves)
          .filter(([, forms]) => JSON.stringify(Object.keys(forms).sort()) !== JSON.stringify(expected))
          .map(([key, forms]) => `${key}: [${Object.keys(forms).join(', ')}]`);
        expect(wrong).withContext(`${language} needs [${expected.join(', ')}]`).toEqual([]);
      });

      it(`has no empty ${language} plural form`, () => {
        const empty = Object.entries(leaves).flatMap(([key, forms]) =>
          Object.entries(forms)
            .filter(([, text]) => typeof text !== 'string' || text.trim() === '')
            .map(([category]) => `${key}.${category}`),
        );
        expect(empty).toEqual([]);
      });
    }

    // A counted number outside the plural section is the defect this ticket
    // removes: one fixed form for every count ("1 open conditions", "7 يومًا").
    // Matched by placeholder name, so it needs no list of keys.
    const COUNTED = /\{\{\s*(count|days|hours|minutes|total|\w+Count)\s*\}\}/;

    // Numbers with no counted noun: nothing to agree with. Adding one needs a
    // reason here.
    const NUMBER_ONLY: Record<string, string> = {
      'list.panelRange': '"1–25 of 120" — a range, no noun',
      'workflow.stageIndicator.revisited': '"×3" — a multiplier sign, no noun',
    };

    // Time quantities do not become plural objects: they move to the layer's
    // duration and relative formats, which pluralise by construction. Listed
    // only until their components migrate (ACC-94 commits 8 and 10); the list
    // must end empty.
    const PENDING_TIME_QUANTITY_MIGRATION: string[] = [
      'setupHealth.age.openDays',
      'setupHealth.age.detectedDays',
      'setupHealth.relative.minutes',
      'setupHealth.relative.hours',
      'setupHealth.relative.days',
      'workflow.stageIndicator.inStageDays',
      'task.overdueBy',
    ];

    it('carries no counted number outside the plural section', () => {
      const offenders = [...Object.entries(EN), ...Object.entries(AR)]
        .filter(
          ([key, text]) =>
            COUNTED.test(text) && !(key in NUMBER_ONLY) && !PENDING_TIME_QUANTITY_MIGRATION.includes(key),
        )
        .map(([key, text]) => `${key}: ${text}`);
      expect(offenders).withContext('move these into "plural", or format them through the layer').toEqual([]);
    });

    it('lists only exceptions that still exist, so the lists cannot go stale', () => {
      const stale = [...Object.keys(NUMBER_ONLY), ...PENDING_TIME_QUANTITY_MIGRATION].filter((key) => !(key in EN));
      expect(stale).toEqual([]);
    });
  });

  // ACC-94 — Ahmad's decision: Latin digits everywhere, in both languages. The
  // formatting layer pins them for everything it formats; this covers digits
  // typed into the translation files, where "آخر ٧ أيام" once sat beside a
  // Latin "7" on the same page.
  describe('digits', () => {
    const ARABIC_INDIC = /[٠-٩۰-۹]/;

    it('uses no Arabic-Indic digits in either file, including plural forms', () => {
      const pluralTexts = (leaves: Record<string, Json>, language: string) =>
        Object.entries(leaves).flatMap(([key, forms]) =>
          Object.entries(forms).map(([category, text]) => [`${language}:plural.${key}.${category}`, String(text)]),
        );
      const offenders = [
        ...Object.entries(EN).map(([key, text]) => [`en:${key}`, text]),
        ...Object.entries(AR).map(([key, text]) => [`ar:${key}`, text]),
        ...pluralTexts(EN_PLURAL, 'en'),
        ...pluralTexts(AR_PLURAL, 'ar'),
      ]
        .filter(([, text]) => ARABIC_INDIC.test(text))
        .map(([key, text]) => `${key}: ${text}`);
      expect(offenders).withContext('write digits as 0-9 in both languages').toEqual([]);
    });
  });

  describe('keys built by string concatenation', () => {
    for (const { site, prefix, values } of CONCATENATED_KEYS) {
      it(`resolves every ${prefix}.* value used by ${site}`, () => {
        const missing = values
          .map((value) => `${prefix}.${value.toLowerCase()}`)
          .filter((key) => !(key in EN) || !(key in AR));

        expect(missing)
          .withContext(
            `${site} would render these raw keys on screen: ${missing.join(', ')}`,
          )
          .toEqual([]);
      });
    }
  });

  // TRIPWIRE, not a coverage assertion.
  //
  // StatusChipComponent declares four variants. Two of them — 'status'
  // (document lifecycle) and 'severity' — have NO translation keys at all,
  // because neither Documents nor Incidents exists yet. The first table to
  // render one will display raw keys, and none of the checks above will see it,
  // because a variant with no consumers has no registry entry.
  //
  // So this asserts the ABSENCE. It passes today, and it fails the moment
  // somebody adds those keys — which is precisely when a registry entry above
  // is needed. The failure message says what to do. Delete this test then.
  it('has no status.* or severity.* labels yet — add a registry entry when it does', () => {
    const present = Object.keys(EN).filter(
      (key) => key.startsWith('status.') || key.startsWith('severity.'),
    );

    expect(present)
      .withContext(
        'Labels for a StatusChipComponent variant have appeared. Add the variant ' +
          'to CONCATENATED_KEYS above and delete this tripwire test.',
      )
      .toEqual([]);
  });
});
