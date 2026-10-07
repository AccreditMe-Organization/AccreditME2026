# Step 184 — Frontend specs leak right-to-left direction into later specs

Linear: ACC-184 (Medium). Branch: `fix/ACC-184-spec-direction-leak`, cut from
`origin/dev` at `c33231c`.

---

## 1. What happened

CI run 37668128910, on the ACC-177 merge commit `c33231c`, failed the frontend
job on one spec:

> DataListComponent — header/row column alignment (ACC-120) measures real
> geometry, so a match is not a match of zeroes
> Expected $[0] = 593 to equal 369. Expected $[2] = 369 to equal 593.
> `data-list.alignment.spec.ts:207`, Jasmine seed 46733.

The offsets are the right ones, in mirror order: the grid was laid out right to
left. The alignment spec assumes left to right, and an earlier spec in that
random order had left `<html dir="rtl">` behind. A re-run passed, and Railway
skipped the deploy until it did.

## 2. What was verified before fixing

| Claim | Finding |
|---|---|
| Seed 46733 locally | Passes, 1,229 of 1,229. The seed shuffles the spec files in the order the bundle registers them, and that order differs between Windows and the Linux runner, so the seed alone cannot replay CI's order here. |
| Who writes `<html dir>` | One production line: `LanguageService`'s effect sets `dir`/`lang` whenever the language changes. Specs write it directly as well. |
| Leaking specs (diagnostic run) | A temporary top-level hook logged every spec that ended with `dir`/`lang` different from how it started: 26 specs. **Nine end right to left** — the two Arabic specs in `language.service.spec.ts` and `language-rendering.spec.ts`, six Arabic specs across `my-tasks.component.spec.ts`, and one in `task-assignee-picker.component.spec.ts`. Each switches to Arabic with the real `LanguageService` alive and never switches back. The rest either moved between "no attribute" and `ltr`/`en`, or inherited `rtl` and set it back only because they happen to create `LanguageService` in English. |
| Reproduced | `language.service.spec.ts` + the alignment spec, seed 23: the same spec fails at the same line with mirrored offsets (577 against 353; CI's 593/369 differ only by window width). |
| Earlier fixes | This has been fixed file by file at least five times: `confirm-dialog-chrome.spec.ts` resets to `ltr`/`en`, `user-list.reactivation.spec.ts` stubs `LanguageService`, and `navigation-access`, `invite-user`, `tenant-name` and `bilingual-name.screens` carry the "CC-8 order" teardown. Nothing stopped the next spec from leaking again. |
| The late-effect trap | `translate.use()` resolves asynchronously, so a `LanguageService` effect can fire after a spec's `afterEach` has reset `dir` and write `rtl` back during a later spec. Destroying the TestBed injector first destroys the effect. The existing teardowns already know this and do it in that order. |
| Named candidates with no document write | `organization-profile.component.spec.ts` asserts a field's own `dir`; `list-row.directive.spec.ts` sets `dir` on its own host element; `user-list.reactivation.spec.ts` stubs `LanguageService`. None changes `<html>`; left alone. |

## 3. The fix

1. **One helper, `preserveDocumentLanguage()`** in `frontend/src/testing/document-language.ts`.
   Called first inside a `describe`, it snapshots `<html dir>` and `<html lang>`
   before each spec and, after it, tears the TestBed down and then restores the
   ORIGINAL values: removing an attribute that was absent rather than writing
   `ltr`. Jasmine runs `afterEach` hooks in reverse order of declaration, so
   being declared first means it runs last, after a spec's own
   `httpMock.verify()` and the like.
2. **Every spec that changes `<html dir>` or `<html lang>` uses it**: the nine
   culprits' files, plus the seven files that had their own ad-hoc reset. Their
   resets go, so there is one rule rather than eight copies of it.
3. **The alignment spec stops depending on order.** It calls the helper and sets
   `<html dir="ltr">` in its own `beforeEach`, because left to right is the
   premise of every offset it compares.
4. **A global guard**, `frontend/src/testing/document-language.guard.spec.ts`,
   with top-level `beforeEach`/`afterEach`, so it runs around every spec after
   the spec's own hooks. It tears the TestBed down, compares the document's
   EFFECTIVE direction and language with how the spec found them (no `dir`
   counts as `ltr`, no `lang` as `en`), and:
   - **fails the spec** if it changed them, naming the helper; then restores, so
     the leak cannot reach the next spec either way;
   - **restores silently** when only the attribute's form changed (absent
     against `ltr`), because a spec that merely creates `LanguageService` in
     English writes `ltr` and that changes nothing a later spec can measure.

No assertion is skipped, weakened or deleted.

## 4. Proof

- The leak reproduced (section 2) before any change.
- Seed 46733 and seed 23 (the two-file reproduction) pass after the fix.
- The full suite passes, under several seeds.
- **The guard is mutation-tested**: removing the helper from one culprit makes
  the guard fail that spec by name, and putting it back makes it pass.

## 5. Progress

- [x] Ticket ACC-184 and branch
- [x] Diagnostic run: every leaking spec listed
- [x] Reproduced: seed 23, mirrored offsets at line 207
- [x] Helper and global guard — before any fix, the guard alone failed exactly
      the nine culprits by name, 9 of 1,229, and nothing else
- [x] Culprits and ad-hoc resets moved onto the helper — 12 spec files; the
      seven ad-hoc teardowns are gone
- [x] Alignment spec sets left to right itself
- [x] Proof:
  - seed 46733, full suite: 1,229 of 1,229
  - seed 23 two-file reproduction: 13 of 13 (failed before the fix)
  - seeds 1 and 77777, full suite: 1,229 of 1,229 each
  - mutation A (helper removed from `language.service.spec.ts`, guard in): the
    guard fails that spec by name, the alignment spec still passes
  - mutation B (same, guard out): 13 of 13 — the alignment spec's own
    left-to-right `beforeEach` holds by itself
  - spec and app type-check, `ng build`, all ten `check:*` scans: clean
