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

const EN = flatten(en);
const AR = flatten(ar);

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
