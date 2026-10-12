# ACC-181 — email settings stop showing and saving raw secrets

Plan written 9 Oct 2026 (CC-65), approved with the answers below in CC-67.
Parked until going online (CC-66) is done; ACC-181 stays in Backlog.

## Findings

### What the API does today

- **GET returns every secret in clear.** `tenant.service.ts:238-251`
  `getEmailConfig()` decrypts `Organization.emailConfig` and returns
  `{ emailProvider, config }` as stored, secrets included.
- **PATCH replaces the whole config.** `tenant.service.ts:253-276`
  `updateEmailConfig()` encrypts whatever it is sent and writes it in full,
  with no merge. The audit (`:270`) records only the provider.
- **The body is untyped.** `dto/update-email-config.dto.ts:7`: `emailProvider`
  (`resend | smtp | office365 | sendgrid | ses`) plus
  `config: Record<string, unknown>` (`@IsObject`). Nothing inside `config` is
  checked.
- `interfaces/tenant.interface.ts:79-82` is the `IEmailConfig` the GET returns.
- `tenant.controller.ts:85-99`: both routes require `tenant:manage_config`.
- `schema.prisma:372`: `emailConfig String?`, encrypted JSON.

### The screen

`email-provider-settings.component.ts` is a raw JSON editor: it loads with
`JSON.stringify` (`:77`) and saves with `JSON.parse` (`:106`). Its provider
labels are hard-coded English and it does not use `am-field`. **Masking the
GET alone would break it**: the editor would save the word "set" back over the
stored secret, which is why ACC-177 left this route unmasked.

Frontend service: `foundation/tenant/services/tenant.service.ts:30`
(`IEmailConfig`), `:77` (`getEmailConfig`), `:81` (`updateEmailConfig`). The
rail item is `core/navigation/nav-items.ts:258`, with an "INERT TODAY" comment.

### Nothing reads the tenant's email config

Only the tenant service's own GET reads `emailConfig`.
`notification-email.processor.ts:46` sends with the platform's `RESEND_API_KEY`
and `RESEND_FROM_EMAIL || 'noreply@accreditme.com'`. This matches ACC-155.

### How ACC-177 masks storage secrets

- `storage-settings.service.ts:103-104, 112`: GET answers `'set'` or null for
  each secret.
- `merge()` (`:519-533`): stored settings with the sent fields laid on top;
  `undefined` and `''` are skipped, so an omitted secret keeps its stored
  value.
- `changedFields()` (`:606-617`): the audit names changed fields, never values.
- DTO header (`dto/update-storage-settings.dto.ts:5-10`) states the write-only
  rule.

**There is no frontend component to reuse.** ACC-177 and ACC-185 shipped no
storage settings screen: on the frontend, `c33231c` and `73c15a1` touch only
`shared/files/files.service.ts` and the translation files. Only the backend
pattern exists, and `merge()` / `changedFields()` are private to the storage
service.

### The shared database

One read-only query (no decryption): **0 of 3 organisations** (`al-manara`,
`al-nakheel`, `platform`) has an `emailConfig` stored. Nothing to migrate.

## The design

`frontend/design-reference/AccreditMe Settings Screens.dc.html`, section 1,
"Email provider", plus the Design System's write-once rule.

- **Resting state is a sentence, not a form**: mail goes out "from
  no-reply@accreditme.app via Resend. Nobody chose this. It's what happens
  until you connect your own provider", with **Connect a provider**. The form
  opens only when someone chooses to connect.
- **Five providers, one select:**

  | Provider | Fields |
  |---|---|
  | Resend | API key · sender address · sender name |
  | SMTP / on-premises Exchange | host · port · encryption · username · password · sender address · sender name |
  | Office 365 | tenant ID · client ID · client secret · sender mailbox |
  | SendGrid | API key · sender address (verified) · sender name |
  | Amazon SES | region · access key ID · secret access key · sender (verified identity) |

- **Port follows encryption** (STARTTLS 587, SSL/TLS 465, None 25) unless it
  has been edited.
- **Disconnect** returns to the default delivery after a confirm naming it.
- **Write-once secrets** (Design System, a system rule): entered once, never
  rendered again. Empty: a password-type field. Once set: the read-only pair
  "●●●●●●●● · set 29 Sep" with a single **Replace**, which reopens an empty
  field. No reveal control, no masked placeholder pretending to hold the
  value; never in an export, a tooltip or the audit trail, which records
  "secret replaced by …".
- **"Not active yet"**: fields stay editable, Save becomes **Save for later**,
  Send test email is absent, and a banner at the top of the section says mail
  keeps going out through AccreditMe's own delivery.
- Product names stay in Latin script inside Arabic; the descriptor around them
  is translated, e.g. "SMTP / خادم Exchange داخلي".

## The plan

### Backend

- **One typed config per provider**, replacing the JSON field. Stored encrypted
  as `{ provider, <provider block>, secretsSetAt }`; only the chosen provider's
  block is kept on save. The column does not change (`emailConfig String?`), so
  there is **no migration**. A legacy `{ emailProvider, config }` blob is read
  for its provider only, in case the old screen saves one before the deploy.
- **Validated fields**: email addresses, host, port 1–65535, encryption
  `STARTTLS | SSL_TLS | NONE`, GUIDs for Office 365, an SES region. Anything
  else is refused by the existing `forbidNonWhitelisted`.
- **`GET /tenant/email-config`** returns the non-secret fields; each secret is
  `'set'` or null, with its `setAt` date (D2); plus `defaultSender` (D7).
- **`PATCH /tenant/email-config`** merges, as storage does:
  - a secret omitted or `''` keeps its stored value, but only while the
    provider is unchanged — switching provider never carries the old
    provider's secret;
  - the chosen provider's required fields must all be present, else 400
    `EMAIL_SETTINGS_INCOMPLETE` naming them (D6);
  - only a newly sent secret gets a new `setAt`;
  - the audit records the provider and the changed field NAMES.
- **`DELETE /tenant/email-config`** is Disconnect: the column becomes null,
  audited (`email_config_disconnected`).

### Frontend

- **A new shared `am-secret-field`**, the write-once rule: an empty password
  input with no reveal, or the "set" pair with Replace. Untouched, it sends
  nothing. It is the first of its kind; the storage screen uses it later.
- **The email screen rebuilt to the drawing**: the resting sentence and Connect
  a provider; the provider in `OverlaySelect` (five options); fields per
  provider in `am-field`; port follows encryption; Disconnect behind a
  translated confirm; the "not active yet" banner, **Save for later**, no Send
  test email (D1).

### Files

| File | Change |
|---|---|
| `foundation/tenant/email-config.ts` | NEW — types, required and secret fields per provider, read / write / mask |
| `foundation/tenant/dto/update-email-config.dto.ts` | rewritten — nested per-provider DTOs |
| `foundation/tenant/interfaces/tenant.interface.ts` | `IEmailConfig` becomes the masked shape |
| `foundation/tenant/tenant.service.ts` | get, update (merge), disconnect |
| `foundation/tenant/tenant.controller.ts` | `DELETE email-config` |
| `common/config/write-only-secrets.ts` | NEW (D4) — `mergeKeepingSecrets`, `changedFieldNames` |
| `foundation/file-storage/storage-settings.service.ts` | switched to the helper, own refactor commit |
| the platform sender helper | one place for `RESEND_FROM_EMAIL`, read by the processor and the GET (D7) |
| `shared/components/secret-field/` | NEW — `am-secret-field` |
| `admin-settings/components/email-provider-settings/` | rewritten, with a spec (none exists today) |
| `foundation/tenant/services/tenant.service.ts` (frontend) | types and disconnect |
| `core/navigation/nav-items.ts:258` | comment updated |
| `en.json`, `ar.json` | below |

### Tests — each with a mutation that must go red

**Backend**

| # | Test | Mutation |
|---|---|---|
| 1 | GET with every provider's secrets stored: the response contains no secret value, each reads `'set'` | return one secret in clear |
| 2 | An unset secret reads null | `'set'` unconditionally |
| 3 | PATCH without the secret keeps the stored one (decrypt what was written) | write only what was sent |
| 4 | PATCH with `''` keeps it too | drop the `''` filter |
| 5 | A replaced secret gets a new `setAt`; an untouched one keeps its date | always restamp |
| 6 | A provider switch without that provider's secret is refused; the old block is not kept | merge across providers |
| 7 | Incomplete settings: 400 naming the fields | skip the completeness check |
| 8 | The audit holds field names and no secret | put the body in the audit metadata |
| 9 | Disconnect nulls the config and is audited | make it a no-op |
| 10 | The DTO refuses a bad email, a bad port, and the old `config` field | remove `@IsEmail` |
| 11 | SMTP username and password: both or neither (D5) | allow one alone |
| 12 | `DELETE` carries `tenant:manage_config` | remove `@Permissions` |
| 13 | "should NOT return records belonging to a different tenant": reads and writes are scoped to the caller's organisation | use an id from the body |
| 14 | `defaultSender` is `RESEND_FROM_EMAIL`, or null when unset — never the accreditme.com fallback (D7) | return the fallback |
| 15 | D4: storage's existing specs pass unchanged on the shared helper | — |

**Frontend**

| # | Test | Mutation |
|---|---|---|
| 1 | The secret field shows the "set" pair with no input; after Replace, an empty input | render an input while set |
| 2 | Saving with untouched secrets sends NO secret keys — the ACC-181 bug itself | fill the form from the GET, secrets included |
| 3 | Each provider shows exactly its fields | swap two providers' field lists |
| 4 | Port follows encryption until edited, then stops | always overwrite the port |
| 5 | No provider: the sentence and Connect, no form | render the form anyway |
| 6 | The sentence has no address when `defaultSender` is null | print a fallback |
| 7 | Disconnect confirms first, then calls DELETE | skip the confirm |
| 8 | Arabic labels render; product names stay Latin | — |

### Docs

- **CLAUDE.md, Email Provider**: the real per-provider shape replaces the
  generic JSON example; secrets are write-only; the "From:
  noreply@accreditme.com" line points at `RESEND_FROM_EMAIL`.
- **SYSTEM-REFERENCE**: ACC-181 resolved at `:8263` ("still unmasked"); "Email
  provider is inert" at `:5847` updated; a §4 subsection on tenant email
  settings; a §10 entry for the write-once secret field.

### Arabic strings

New `emailSettings.*` keys: the resting sentence (with and without an address),
the banner, every field label and help text, Replace (استبدال), "Never shown
again" (لا تُعرض مرة أخرى), Disconnect and its confirm, Save for later, and the
refusal messages. Labels from the drawing; product names in Latin script.
Removed: `adminSettings.providerConfig`, `errorInvalidJson`,
`emailProviderNote` (D8).

### What the shared database gets

- From the change itself: **nothing**. No migration, no backfill (0 of 3
  organisations have a config, measured).
- The browser check writes al-nakheel's `emailConfig` and must **Disconnect
  afterwards**, leaving it null. The audit rows stay (append-only).

## Review answers (CC-67, 9 Oct 2026)

All nine recommendations accepted.

- **D1** Hard-code the "not active yet" treatment on this screen; no platform
  `featureStatus` flag. ACC-155 removes it.
- **D2** Store a `setAt` date per secret inside the encrypted config, and show
  "set 29 Sep" as drawn.
- **D3** No per-secret Remove; Disconnect clears the whole provider.
- **D4** One shared helper (`mergeKeepingSecrets`, `changedFieldNames`).
  Storage switches to it in its own refactor commit, and storage's specs must
  pass unchanged.
- **D5** SMTP username and password are optional as a pair (both or neither).
- **D6** Complete or refused: 400 `EMAIL_SETTINGS_INCOMPLETE` naming the
  missing fields. No drafts.
- **D7** The resting sentence shows the platform's configured sender
  (`RESEND_FROM_EMAIL`), returned by GET. If it is unset, show the sentence
  without an address — never the accreditme.com fallback. The fallback itself
  is fixed in ACC-130's sweep.
- **D8** Delete `adminSettings.providerConfig`, `errorInvalidJson` and
  `emailProviderNote`.
- **D9** Label Resend as "Resend" in both languages, with no "(default)".

When it is built: the browser check writes al-nakheel's `emailConfig` and must
Disconnect afterwards. The audit rows stay.

## Results (built 12 Oct 2026, CC-83)

### Backend tests — each mutation run and seen red, then restored

| # | Test | Mutation | Red? |
|---|---|---|---|
| 1 | GET, every provider's secret stored: no value in the response, each `'set'` | return one secret in clear | yes (5 failed) |
| 2 | An unset secret reads null | `'set'` unconditionally | yes |
| 3 | PATCH without the secret keeps it (decrypted what was written) | write only what was sent | yes |
| 4 | PATCH with `''` keeps it | drop the `''` filter | yes |
| 5 | A replaced secret gets a new date; an untouched one keeps it | always restamp | yes |
| 6 | A provider switch never carries the old secret, even with the same field name; only the new block is kept | merge across providers | yes |
| 7 | Incomplete: 400 `EMAIL_SETTINGS_INCOMPLETE` naming the fields | skip the check | yes |
| 8 | The audit holds field names and no secret or value | put the body in the audit | yes |
| 9 | Disconnect nulls the config and is audited | make it a no-op | yes |
| 10 | The DTO refuses a bad email, a bad port, the old `config` and `emailProvider` fields, unknown fields, a non-GUID tenant ID, a non-region | remove `@IsEmail` | yes |
| 11 | SMTP username and password both or neither | allow username alone | yes |
| 12 | Every route, `DELETE` included, needs `tenant:manage_config` | remove `@Permissions` from DELETE | yes |
| 13 | Tenant isolation (the gate's name): reads and writes act on the session organisation only | act on another organisation | yes |
| 14 | `defaultSender` is `RESEND_FROM_EMAIL`, or null — never the accreditme.com fallback | return the fallback | yes |
| 15 | D4: storage's specs pass unchanged on the shared helper | — | 17 suites, 295 tests, no spec edited |

Suites: `tenant.email-config.spec.ts` (23), `tenant.email-routes.spec.ts` (18),
`write-only-secrets.spec.ts` (9).

### Frontend tests — each mutation run and seen red, then restored

| # | Test | Mutation | Red? |
|---|---|---|---|
| 1 | Set: the pair and Replace, no input; Replace: an empty password input, no reveal | render an input while set | yes |
| 2 | Untouched secrets send NO secret key, never "set" | fill the form from the GET, secrets included | yes — see note 1 |
| 3 | Each provider shows exactly its fields | swap SMTP's and SES's lists | yes |
| 4 | Port follows encryption until edited; a stored non-default port counts as edited | always overwrite the port | yes |
| 5 | No provider: the sentence and Connect, no form | render the form anyway | yes |
| 6 | No address in the sentence when `defaultSender` is null | print a fallback | yes |
| 7 | Disconnect confirms first, then DELETE | call DELETE without the confirm | yes |
| 8 | Arabic labels; product names Latin; the address isolated | — | — |

Specs: `secret-field.component.spec.ts` (5), `email-provider-settings.component.spec.ts` (13).

### Checks, each on its own exit status

- Backend: `tsc`, build, 131 suites / 2,982 tests, tenant isolation 177, `check:worker-gate`.
- Frontend: `tsc` (app and specs), `ng build`, `verify:built-index`, 1,487 of 1,487, i18n parity 18 of 18.
- Frontend `check:*`: formatting (after the union fix below), contrast, icon-labels, dialog-overlays, dialog-density, create-gating, action-gating, action-gating:selftest, field-control, confirm-translated, reserved-slugs, vercel-config — all exit 0.

### Browser check — local only, al-nakheel's tenant admin persona, both languages

In English and in Arabic (`dir="rtl"` at every step):
- the resting sentence, with the platform sender in bidi isolates, and no form;
- Connect, SMTP, a made-up host and a random password, saved (200; the PATCH carried it);
- reload: the password reads "set" in the GET and as the "set" pair on screen, with no input; **no response from the email route ever contained either password** (18 exchanges);
- saved again untouched: the PATCH had no password key, and the GET still says set with the same date;
- Replace: the new password was sent, the GET still says set, with a new date;
- Disconnect behind the confirm ("Disconnect SMTP / on-premises Exchange?" / "قطع الاتصال بـ SMTP / خادم Exchange داخلي؟"), DELETE 200, the sentence again, and **al-nakheel's `emailConfig` null in the database** afterwards.

Screenshots: `.playwright-mcp/c83-{en,ar}-{1..7}-*.png`.

### What differs from the plan, and why

1. **The platform sender helper already existed** (`resolvePlatformSender()`, ACC-130), so GET reads it; no second helper.
2. **The set date reads "29 Sep 2026", not "29 Sep"**: it goes through the formatting layer (`amDate`, ACC-94), which has one date format.
3. **Every provider's sender is `fromAddress`**, labelled per the drawing (sender address, sender mailbox, sender verified identity).
4. **The shared helper takes an optional secret list.** Storage passes none, so every storage field still keeps on `''`. Email names its secrets, so an ordinary field sent `''` is cleared — otherwise an optional sender name could never be emptied.
5. **Turning SMTP authentication off means Disconnect**: D3 has no per-secret remove, so a cleared username with a stored password is refused (D5), naming the pair.
6. **SES's access key ID is an ordinary field**; only the secret access key is a secret.
7. **PATCH and DELETE return the masked GET shape**, so the screen needs no second read.
8. **Cancel instead of Disconnect while connecting** with nothing stored: there is nothing to disconnect yet.
9. **Disconnect with nothing connected writes nothing and audits nothing.**
10. **Frontend test 2 has a pre-render half.** `am-secret-field` also clears its control when it renders, which masked the plan's mutation; the new test pins the screen on its own.
11. **Storage's own specs do not pin "empty keeps"** (finding): removing that branch turned only the helper's spec red. The helper spec covers both callers.
12. **`check:formatting` reads `| number` as the Angular pipe**, so the unions are written `number | string`. The scan is unchanged.
13. **`adminSettings.provider` is now unused**; the plan's D8 list did not name it, so it stays.
