# Step 260 — the Storage settings screen (ACC-260)

**Lane A** (screens). Plan only; no code is built from it until the open decisions in §8 are answered.

The backend has been live since ACC-177 and ACC-185 (SYSTEM-REFERENCE §16, §16.14), but no screen uses it, so a tenant admin can't see or set their storage. Until a location is confirmed, every upload in every organisation is refused `STORAGE_NOT_CONFIRMED`. Today nobody can confirm one without calling the API by hand.

## Sources

- **Design:** `frontend/design-reference/AccreditMe Storage Settings.dc.html`, accepted 7 Oct, round 2, committed first on this branch. The file is 1,140 lines:
  - markup at L1–526;
  - data and logic at L528–1138;
  - 23 location states selectable by the `state` Tweak (L528, L613–694).
- **API plans:** `backend/Plans/step-177-file-storage.md` (§8, §11) and `backend/Plans/step-185-sharepoint-storage.md` (§3, §5).
- **The code**, which this plan was checked against:
  - `backend/src/foundation/file-storage/`;
  - `frontend/src/app/foundation/admin-settings/`;
  - `shared/components/secret-field/`;
  - `shared/files/files.service.ts`;
  - `foundation/setup-health/`.
- **Ticket:** ACC-260. ACC-182 is the platform side of moving a location, and is not this ticket.

**One finding governs the whole plan.** The design's SharePoint section is older than the SharePoint API that was built. The design (7 Oct) draws SharePoint as an admin-consent sign-in: "Connect to Microsoft ↗", wait for Microsoft, then a site picker. It has no Tenant ID, Client ID, secret, expiry or Disconnect (L645–689, L909–919; Disconnect "removed" at L282, L1014, L1076).

On 8 Oct Ahmad dropped that flow for one the customer prepares (ACC-185, CLAUDE.md: "That design was drafted first and dropped … do not reintroduce it"). The API and this ticket's own scope both use the dropped design's replacement:
- Tenant ID, Client ID and a write-only client secret;
- Site URL, Library name and an optional secret expiry;
- Test, Confirm, Replace secret, the Disconnect lock and access withdrawn.

So the SharePoint part of the design can't be built as drawn. §8 D1 asks what to build instead. Everything else in the design matches the API closely.

---

## 1. Inventory: what the design draws, against what the API gives

### Shared shape of the API

**Routes:**
- Every route is under `/api/v1`.
- `tenant/storage` (`storage-settings.controller.ts:14`) and `tenant/recycle-bin` (`recycle-bin.controller.ts:14`) are `TenantGuard` + `PermissionGuard`, and each route is `tenant:manage_config`.
- No route has its own throttle; the global 600 a minute per user applies.

**Requests and responses:**
- Every write returns the whole `IStorageSettings` again, so the screen re-renders from the response rather than patching itself.
- Unknown body fields are refused 400 (global `forbidNonWhitelisted`).
- Refusals carry a `code` (`storage-refusal.ts:45-73`). The frontend already translates every storage code in `FilesService.refusal()` (`shared/files/files.service.ts:24-45, 93-100`), in both languages.

### 1.1 The page and its rail entry

| Design | API / app today |
|---|---|
| Page "File storage", breadcrumb "Settings / File storage", subtitle "Where your organisation's uploaded files are kept…" (L51–53, L784). Settings template, 1130px (L45, L753). | **No route, no screen.** Admin settings children are `organization-profile`, `email-provider`, `ai-settings` and `task-sla` (`admin-settings.routes.ts:17-49`), each with its own `canActivate: [permissionGuard]`. The rail items `emailProvider` and `aiCredits` are `tenant:manage_config` in Administration (`nav-items.ts:304-322`). |
| No rail is drawn; only the breadcrumb. | The breadcrumb comes from the nav model (ACC-79), so a rail item gives "{tenant} › Administration › File storage". |
| "Denied" outcome: "the shared not-allowed page … 'File storage settings are open to tenant administrators.'" (L1038). | **No not-allowed page exists.** `permissionGuard` sends a refused URL to `/home`, and the item is absent from the rail. That is the app's convention; see Not built as drawn (§7). |
| "Loading: strip, radio list and both lower cards as skeletons … never flashes 'Not confirmed'" (L1035); "Error: page error with Retry" (L1039). | `GET /tenant/storage` (`storage-settings.controller.ts:19-23`, built at `storage-settings.service.ts:84-141`). One read gives everything the page shows. |

### 1.2 The current-location strip

The strip (L55–68, variants in `CUR` L697–705) holds a name, a detail line, a status chip, an optional "Request a change…" button and an optional request line.

| Design | API |
|---|---|
| "Not confirmed yet" · "✕ Uploads blocked" (L698) | `confirmed: false`. `provider` is `S3` until confirmed (schema default, `prisma/schema.prisma:360`); the option being set up is `draftProvider`, which is null for a cloud draft. |
| "Confirmed 3 Oct 2026 by Hessa Al-Mutairi" (L696) | `confirmedAt` and `confirmedBy {id, name}` (`service.ts:96-97`). |
| "· 1,284 files" (L699) | **No file count in GET.** `usage.usedBytes` covers AccreditMe cloud only; `sharepoint.filesStored` covers SharePoint only (`service.ts:89-91, 134-138`). See gap G6. |
| "✓ Working" chip (L699–703) | **No health for cloud, MinIO or local.** Only SharePoint has a state, `sharepoint.accessLostAt` and `accessLostReason` (`service.ts:124-125`). See gap G4. |
| "✕ Can't be reached · new uploads are refused" for SharePoint (L704) | `sharepoint.accessLostAt` set. |
| MinIO detail "minio.alnakheel.local · accreditme-files"; local "\\fileserver01\…"; SharePoint "Quality Department › Quality Documents" (L700–703) | The tenant's own values: `minio.endpoint` / `bucket`, `local.rootPath`, and `sharepoint.siteName` / `libraryName`. |
| Pending request: "Change requested 7 Oct 2026 by Hessa Al-Mutairi · AccreditMe will contact you"; Request button absent (L701, L709, L1028) | `changeRequestedAt` and `changeRequestedBy` (`service.ts:98-99`). **Never cleared:** the only writer is `service.ts:270`. See gap G7. |

### 1.3 The location card: four options

The design draws a radio group of four options (L70–140, options at L713–729). The save bar (L134–139) holds a reason on the left and the primary button; Cancel appears only after first visit.

| Option (design, L715–716) | `offeredProviders` | Notes |
|---|---|---|
| "AccreditMe cloud": "Managed by AccreditMe. Nothing to set up." | `S3`, always | — |
| "MinIO on your own servers" | `MINIO`, always | — |
| "Local folder or network drive" | `LOCAL_FILESYSTEM` only when `LOCAL_STORAGE_BASE` is set (`storage-resolver.service.ts:212-214`) | The design shows it disabled with "Available on an on-premises installation." when not offered (L716, L720–721, L642–644). |
| "SharePoint Online" | `SHAREPOINT`, always | — |

**After confirming,** every option but the current one is disabled with its description kept; the current one gets a grey dot and a "Current" chip (L720–725, L1027).

### 1.4 The first-time confirm step, for each location

**AccreditMe cloud**
- **Design (L614–616):** "Nothing to set up" banner and "Confirm AccreditMe cloud…", always enabled.
- **API:** `POST /tenant/storage/confirm` with `{ provider: 'S3' }` (`controller.ts:37-46`, `service.ts:147-193`). No test is required, and the platform env isn't checked at confirm.

**MinIO**
- **Design fields (L600–605):** Endpoint URL (required, LTR), Bucket (required), Region (optional), Access key (required), Secret key (required, secret), and a "Use HTTPS" select.
- **API fields (`MinioSettingsDto`, `dto/update-storage-settings.dto.ts:74-105`):** `endpoint` (http/https URL, so the scheme IS the HTTPS choice), `region`, `bucket`, `accessKeyId` and `secretAccessKey`. There's no HTTPS field (gap G9).
- **Test box (L575–593, L618–636):** "Write a small test file" → "Read it back" → "Delete it", with running, pass, fail and stale states.
- **API test:** `POST /tenant/storage/test` with the candidate in the body (`controller.ts:71-77`, `service.ts:384-468`).
  - It returns `{ ok, provider, passed[], failedStep, code, message, sharepoint }`, always as a 200.
  - Its steps are `configure | write | read | verify | delete` for MinIO and local (`interfaces/storage-settings.interface.ts:67`).
  - **It saves nothing to the database**, but it does write a probe file into the storage under test and deletes it.
- **Confirm:** "Confirm MinIO…" is enabled only after a pass for exactly the values on screen ("Settings changed since the test · test again", L635–637). The API's confirm runs its own test and refuses `STORAGE_TEST_FAILED` with `failedStep` and `cause` (`service.ts:154-162, 470-479`), so the screen's stale check is a convenience, not the guarantee.

**Local folder**
- **Design (L638–641):** a "Folder path" field, Test, then "Confirm local folder…".
- **API:** `local.rootPath`, relative to `LOCAL_STORAGE_BASE`, with no `.` or `..` segments (`dto:107-117`). The test runs configure, write, read, verify and delete.
- **Mismatch:** the design's example is a UNC path ("\\fileserver01\…"), but the API takes a path relative to the installation's base. The help text must say so (gap G10).

**SharePoint:** see §1.6. The design's flow is the dropped consent flow.

**The confirm dialog (L851–860, 420 wide)**
- Title "Confirm AccreditMe cloud?"; context "File storage · first-time setup".
- Body: "Uploads open for everyone as soon as you confirm. After this, only AccreditMe can change where files are stored."
- Pairs: Location, and Confirmed by.
- Buttons: Cancel and Confirm.
- For MinIO, local and SharePoint the Location pair shows the endpoint, path or library, LTR.
- A failed confirm "keeps the values and says nothing changed ('Uploads are still blocked')" (L1039).

**API errors on confirm:**
- `STORAGE_ALREADY_CONFIRMED` (409, also on losing a race);
- `STORAGE_SETTINGS_INCOMPLETE`;
- `STORAGE_PROVIDER_NOT_ALLOWED`;
- `STORAGE_ENDPOINT_NOT_ALLOWED`;
- `SHAREPOINT_SITE_URL_INVALID`;
- `STORAGE_TEST_FAILED`.

### 1.5 The fixed-location state, Request a change, and a pending request

**Locked fields (L606–610, L1052)**
- Surface-grey with 🔒. The first carries "Changing where files are stored is done by AccreditMe."; the rest say "Locked".
- **API (`REPLACEABLE_AFTER_CONFIRM`, `service.ts:25-30`):**
  - S3 and local: nothing is replaceable.
  - MinIO: the access key and secret only.
  - SharePoint: the client ID, client secret and secret expiry.
- Anything else is refused 403 `STORAGE_CHANGE_BY_PLATFORM` (`service.ts:486-497`).

**MinIO key replacement (L667–672)**
- "Replace" on either credential opens both (L1054); Test, then "Save new key", with Cancel.
- **API:** `PATCH /tenant/storage` with the two keys. A non-expiry change must pass a test before it saves (`service.ts:212-230`).

**"Request a change…" (L64, L708; dialog L861–872, Form 560)**
- Title "Request a change of storage"; context "Current: …".
- Note: "AccreditMe will contact you…".
- Pairs: Requested by, and Sent to.
- An optional "Anything we should know?".
- Buttons: Cancel and "Send request".
- **API:** `POST /tenant/storage/change-request` with `{ message? ≤ 1000 }` (`controller.ts:49-58`, `service.ts:263-284`).
  - It is allowed only once confirmed, else `STORAGE_NOT_CONFIRMED`.
  - It notifies every platform admin, in-app, in both languages.
  - **The message is not stored** on the organisation. It goes only into the audit row and the notification.

**Pending request (L690–692, L701, L1028)**
- A line on the strip, with no Request button: "One open request at a time".
- **API:** `changeRequestedAt` and `changeRequestedBy`.
  - Nothing reports a request as handled. A repeat request is allowed and notifies again (`service.ts:259-261`), so "one at a time" is the screen's rule, not the server's.
  - The stamp is never cleared (gap G7).

### 1.6 SharePoint

**What the design draws** (L645–689, L909–919, consent flow):
- "Connect to Microsoft ↗";
- "Waiting for Microsoft…";
- Microsoft tenant and "Approved by" pairs;
- a Site field with a 520px site picker (search and list) and a Document library select;
- Test, then "Confirm SharePoint…".

After confirming, it shows:
- "Access · Set · approved 1 Oct 2026";
- the site and library locked;
- access withdrawn: a danger banner and "Connect again ↗" (L682–686);
- connecting again (L687–689).

It draws no Disconnect and no secret expiry.

**What the API takes and returns** (`SharePointSettingsDto`, `dto:20-72`; the GET block at `service.ts:108-131`):

| Field | API | Shown back |
|---|---|---|
| Tenant ID (GUID or domain) | `tenant` | in clear, as typed |
| Client ID (GUID) | `clientId` | in clear |
| Client secret (8–512) | `clientSecret` | `'set'` or null, never the value |
| Site URL | `siteUrl` | in clear |
| Library name | `libraryName` | in clear |
| Secret expiry (optional, YYYY-MM-DD) | `secretExpiresOn` | in clear |
| *(alternative to URL and name)* | `siteId`, `listId` | in clear |
| *(after Confirm)* | — | `tenantId`, `siteName`, `siteWebUrl`, `libraryWebUrl` |
| *(state)* | — | `accessLostAt`, `accessLostReason` (`SECRET_INVALID`, `CONSENT_REVOKED`, `GRANT_REMOVED` or `LIBRARY_GONE`), `filesStored`, `disconnectAllowed` |

**Test**
- Steps: `configure → token → site → library → write → read → verify → delete`.
- Per-step codes:
  - token: `SHAREPOINT_TENANT_NOT_FOUND`, `SHAREPOINT_CLIENT_NOT_FOUND`, `SHAREPOINT_SECRET_INVALID`, `SHAREPOINT_APP_DISABLED`;
  - site: `SHAREPOINT_SITE_URL_INVALID`, `SHAREPOINT_SITE_NOT_FOUND`;
  - library: `SHAREPOINT_LIBRARY_NOT_FOUND`;
  - write: `SHAREPOINT_NO_WRITE_ACCESS`;
  - otherwise `STORAGE_UNAVAILABLE`.
- Each step has up to 60 seconds.
- A pass returns the resolved site and library, so the screen can show "Quality Department › Quality Documents" before Confirm.

**Confirm:** tests, then records the resolved location (`service.ts:159-161`).

**After Confirm** (`PATCH`)
- Replace secret, or change the client ID: each must pass a test AND reach the same tenant, site, list and drive, else `STORAGE_CHANGE_BY_PLATFORM` (`service.ts:505-518`).
- An expiry-only change needs no test.

**Disconnect:** `POST /tenant/storage/disconnect` (`controller.ts:63-68`, `service.ts:303-373`).
- Before Confirm: it clears the SharePoint draft.
- After Confirm on SharePoint with nothing stored there: back to unconfirmed AccreditMe cloud.
- Otherwise:
  - `STORAGE_LOCKED_BY_FILES` (409, with `filesStored`);
  - `STORAGE_CHANGE_BY_PLATFORM` on any other provider.

**Access withdrawn**
- Set by a failing live call or by the hourly probe (`sharepoint-access.service.ts:87-103, 144-162`).
- Cleared by the probe, a passing credential replacement, confirm or disconnect.
- **A passing Test does NOT clear it** (gap G5).

**Secret expiring**
- Setup health shows `STORAGE_SECRET_EXPIRING` from 30 days before `secretExpiresOn` (`setup-condition.detectors.ts:422-441`).
- One notice goes to the tenant admins (`sharepoint-access.service.ts:171-196`).

### 1.7 The Recycle bin

The page is drawn at L345–434 with notes at L1080–1097.

| Design | API (`recycle-bin.controller.ts`, `recycle-bin.service.ts`) |
|---|---|
| Its own Settings page, "Recycle bin", breadcrumb "Settings / Recycle bin"; header "18 files · 212 MB. Deleted files stay here for 30 days…" (L352–354) | `GET /tenant/recycle-bin` → `IRecycleBinItem[]`, the whole list with **no paging**, newest deletion first (`service.ts:48-75`). |
| Columns: [✓] · File (name, type and size) · From (record type, and the record as a link) · Deleted by · Deleted · Days left (amber at ≤ 3) · Actions (L370–387) | `{ id, name, mimeType, sizeBytes, record: { type, id, name }, deletedBy, deletedAt, purgesAt, daysLeft }`. `record.name` is filled for tasks only, the one owner type today. |
| Search, the filter chips "Record type ▾", "Deleted by ▾" and "Deleted ▾", the sort "Soonest to expire first", and a pager "1–6 of 18" (L357–363, L388) | Nothing server-side: the client does all of it (gap G8). |
| Gone record: the name struck through and not a link, no Restore, "Can't be restored: the record it came from no longer exists." (L386) | **Not flagged in the list.** `record.name` null is ambiguous (any non-task owner), and restore refuses `FILE_RECORD_GONE` (409, `service.ts:86-89`). See gap G8. |
| Restore one ("Restore 'name'? It goes back to <record>."), or several, with gone rows skipped and counted (L885–894) | `POST /tenant/recycle-bin/:fileId/restore`, one file per call, returning the refreshed list (`controller.ts:38-47`, `service.ts:78-115`). Bulk restore is N calls. |
| Purge: "Purge 3 files for good?", the tick "I understand these files will be gone for good", Purge disabled until it's ticked (L895–906); per-file outcomes (L1096) | `POST /tenant/recycle-bin/purge` with `{ fileIds: 1–100 }`. **All or nothing:** any id not in the bin gets 404. SharePoint files are checked as reachable first: `STORAGE_ACCESS_WITHDRAWN` or `STORAGE_UNAVAILABLE` (`service.ts:120-180`). |
| Empty: "The recycle bin is empty"; filtered empty: "No deleted files match", with Clear filters (L407–416) | — |
| "Delete a file" dialog (L873–884), where bin items come from | Already built on the task evidence list (`task-evidence-list.component.ts:380-382`). It isn't this ticket's (§7). |

### 1.8 Usage, and the 25 MB upload limit

**Usage card (L143–152, cases at L731–736: normal, near, full, own)**
- Shows e.g. "3.2 GB of 10 GB", an "Almost full" meter from 90%, "Includes 212 MB in the recycle bin", and for own storage "no AccreditMe limit applies".
- **API:** `usage: { usedBytes, maxStorageGb }` in GET. This is AccreditMe cloud only, counting deleted files until they are purged (`stored-file.service.ts:225-231`).
- **Missing:** the recycle bin's share, and anything for MinIO, local or SharePoint (gap G6). The bin's share can be summed on the client from the bin list.

**Upload rules card (L153–163, L765–779)**
- "Maximum file size · 25 MB per file", the allowed types, and "Scanning … once scanning ships".
- **API:**
  - `maxUploadBytes` in GET;
  - `GET /files/upload-limits` → `{ maxUploadBytes, allowedExtensions }`, `TenantGuard` only (`files.controller.ts:37-41`). The default is 25 MB, from `MAX_UPLOAD_MB` (`storage-platform-env.ts:20, 55-59`).
- The size comes from the server and is never written as "25" in the frontend.
- **Scanning is not built** (ACC-178), so its row is absent, not "coming".

### 1.9 Setup health, and the upload control

- **Setup health already renders** `STORAGE_ALMOST_FULL`, `STORAGE_ACCESS_WITHDRAWN` and `STORAGE_SECRET_EXPIRING`, with **no Fix**: `fixTargetFor` returns null and says these screens "are lane A's and not built" (`setup-health-page.component.ts:103-111`). This ticket gives them their Fix:
  - almost full → the bin;
  - the other two → the page.
- **The design also draws "File storage not confirmed · uploads are blocked"** as a Setup health row (L820–824). **No such condition exists** (gap G11).
- **The upload control (design §7, L436–507)** is a shared `am-file-upload` with 14 states and four homes. The task evidence dialog already does most of this (`task-add-evidence-dialog.component.ts`).
  - The one piece this ticket needs is the **tenant-admin variant** of "Storage not set up" (L980): "Uploads are blocked for everyone until a location is confirmed. · Set up file storage".
  - Today every user sees "Ask your administrator.", the administrator included, with no link (`en.json:2673`).

---

## 2. Access

| What | Permission | Where |
|---|---|---|
| The page, `GET`/`PATCH /tenant/storage`, confirm, test, change-request, disconnect | `tenant:manage_config` | `storage-settings.controller.ts:20-72` |
| The recycle bin: list, restore, purge | `tenant:manage_config`, the same, checked | `recycle-bin.controller.ts:20-40` |
| Upload limits | any signed-in user (`TenantGuard` only) | `files.controller.ts:37-38` |
| The Setup health rows | `setup:view` | SYSTEM-REFERENCE §13 |
| The rail entries | `admin:access` (the group) + `tenant:manage_config` (the item) | `nav-items.ts:183-192, 304-322` |

- **Who holds `tenant:manage_config`:** TENANT_ADMIN. Its sentence already reads "Set up email, storage, deadlines and AI" (`en.json:623`).
- **The rail:** two items in Administration, after Email provider and AI credits:
  - **"File storage"** → `/admin-settings/storage`;
  - **"Recycle bin"** → `/admin-settings/recycle-bin`.

  Each is a child of `admin-settings.routes.ts` with its own `canActivate: [permissionGuard]`, the rule ACC-79 set for that file. The route permission comes from the nav item (ACC-79).
- **Inside the page:** every control gates on the same permission, so a custom role can't reach a control the server refuses.
  - The page has nothing to show a viewer without the permission, so there's no read-only variant (the design draws none, L1038).
  - The bin's icon actions are wrapped in `@if (canManage())`, as `check:action-gating` requires (`frontend/scripts/check-action-gating.mjs:108`).
- **The specs that pin the admin set** must change with the new items:
  - `admin-settings.routes.spec.ts:12-19`;
  - `nav-items.spec.ts:336-347`, and `:377` (13 items → 15);
  - `permission.guard.spec.ts:385-388`, `:416-419`;
  - `route-guard-invariant.spec.ts`.

---

## 3. The rules, and how the screen keeps them

**1. Never show AccreditMe's own storage region, bucket or endpoint.**
- **The server:** `GET /tenant/storage` never reads the platform env. `get()` reads only the tenant's own config and Organization columns (`service.ts:84-141`). `platformS3Settings()` is reached only by the resolver (`storage-resolver.service.ts:270-286`).
- **Pinned by a spec:** `storage-settings.service.spec.ts:109-121` sets the AWS env and asserts that neither the region nor the bucket appears. The test result carries only provider, steps, a code and a fixed message.
- **The screen adds nothing that could leak:**
  - The cloud option shows only "Managed by AccreditMe" (L615, L662, L1030). It renders no field for AccreditMe cloud, whatever GET holds.
  - A test of AccreditMe cloud shows only the steps and a pass or the failed step's sentence. Never `message` as free text: the codes are translated by `FilesService.refusal()`, and an untranslated code shows a generic sentence.
  - A layout spec asserts that no text on the page matches the AWS env values given to a test build.

**2. Secrets are write-only and never shown back.**
- **The server:** MinIO `accessKeyId` / `secretAccessKey` and SharePoint `clientSecret` come back only as `'set'` or null (`service.ts:104-105, 113`).
  - The merge keeps a stored secret when the field is omitted (`common/config/write-only-secrets.ts:21-38`).
  - The audit row names fields, never values (`service.ts:610-614`).
- **The screen:**
  - Every secret uses `am-secret-field` (`shared/components/secret-field/secret-field.component.ts`): "Set" with Replace, no reveal, `autocomplete="new-password"`. It was built for this screen (its doc comment, `:20-44`).
  - The form never holds a stored secret: GET has none, and `applyStored` copies only non-secrets (the email screen's rule).
  - A secret is sent only when the user typed one, and is cleared after the save.
  - A spec asserts that the request bodies of Test, Confirm and Save carry a secret only when typed, and that no rendered text contains a typed secret after saving.
- **The design's "Show" action while typing (L594–599) is NOT built.** `am-secret-field` has no reveal, by decision (ACC-181). See §8 D7.
- **One server-side wrinkle:** a JSON `null` for a secret would clear it, because `mergeKeepingSecrets` skips only `undefined` and `''`. The screen never sends `null` for a secret, so this needs no backend change. A spec pins it.

**3. Uploads are 25 MB everywhere.** The value is read from the server (`maxUploadBytes`), never hard-coded.

---

## 4. Gaps: what the design needs that the API doesn't give

| # | Gap | Kind | Recommendation |
|---|---|---|---|
| G1 | **SharePoint is drawn as the dropped consent flow** (§1.6) | design | **Blocking for the SharePoint PR only** (D1). Build the API's fields, laid out like MinIO's. |
| G2 | **Disconnect and its lock are not drawn** (removed, L282) | design | Build it, as the ticket and API say: SharePoint only (D2). |
| G3 | **The secret's expiry and its 30-day state are not drawn** | design | Build the optional field and the warning line (D3). |
| G4 | **"✓ Working" / "Health unknown" / "last tested …"** for cloud, MinIO and local: nothing is stored | backend, or wait | Frontend only: the chip says "Confirmed", SharePoint shows withdrawn from `accessLostAt`, and test results are shown for the current visit only. No automatic test on load, because a test writes a probe file into the store (D4). |
| G5 | **A passing Test doesn't clear "access withdrawn"** (only the hourly probe, a credential replacement, confirm or disconnect do) | backend | Small backend change in its own PR: a passing test of the CONFIRMED SharePoint location calls `markRestored()`. Otherwise the page reads "can't be reached" for up to an hour after the customer fixes it (D5). |
| G6 | **File counts and own-storage usage** ("1,284 files", "2,410 files · 18.4 GB", L699, L734) | backend, or wait | Frontend only: omit the counts. Show the cloud usage meter, the bin's share summed from the bin list, and for own storage the sentence "no AccreditMe limit applies" plus any leftover cloud usage. |
| G7 | **The change-request stamp is never cleared**, and nothing marks it handled | backend (ACC-182) | Show the line as drawn. ACC-182 must clear the stamp when AccreditMe acts, so this plan adds that to ACC-182 rather than here. Until then the line stays after a move. |
| G8 | **The recycle bin has no paging, filtering or "record gone" flag** | frontend now; backend later | Client-side search, filters, sort and pager. The list is bounded by 30 days of deletions. A gone record is shown only when restore refuses `FILE_RECORD_GONE`, and that row is then struck through. Server paging and a `recordExists` flag go in a later ticket if a tenant's bin grows large. |
| G9 | **MinIO "Use HTTPS" select**: the API has none, and the endpoint's scheme carries it | frontend only | No separate control: the scheme is part of the URL, with the drawn help text "Off sends files unencrypted…" moved to the endpoint's hint (D8). |
| G10 | **Local folder path**: the design shows a UNC path; the API takes a path relative to the installation's storage base | frontend only (copy) | The help text says "relative to the storage folder AccreditMe was installed with". Local is offered only on-premises anyway. |
| G11 | **"File storage not confirmed" as a Setup health condition** (L820–824) | backend + migration (a new enum value) | **Wait:** a follow-up ticket. The page's strip and the upload refusal already say it. |
| G12 | **Secret "Set · 3 Oct 2026"**: storage secrets have no set date (the email config has `secretsSetAt`; storage doesn't) | backend, or wait | Show "Set" without a date (`am-secret-field` already does when `setAt` is null). A follow-up can add `secretsSetAt` to the storage config. |
| G13 | **The upload control's tenant-admin variant** with "Set up file storage" (L980) | frontend only | In this ticket: the evidence dialog shows the variant to holders of `tenant:manage_config`, with the link. |
| G14 | **Purge per-file outcomes** (L1096) against the API's all-or-nothing | frontend only | Purge the selection in one call. On a 404, reload the bin and say "Some files had already gone; nothing was purged. Check the list and try again." Restore is per file, so it reports per file. |

**No gap needs a backend change before the first PR.** G5 is the only backend change recommended inside this ticket. G7 belongs to ACC-182, and G11 and G12 are follow-ups.

---

## 5. Testing without writes

**The rule for every check here:**
- No confirm, PATCH, change-request, disconnect, test, purge or restore reaches the shared database or the real store.
- Confirming fixes an organisation's location for good, and even Test writes a probe file into the storage under test.
- Local GETs as Hessa are fine.

**Frontend specs (Karma)**
- `HttpTestingController` is answered with fixtures, one per state.
- A shared `storage-settings.fixtures.ts` builds `IStorageSettings` for:

| State | How |
|---|---|
| Unconfirmed, nothing drafted | `confirmed: false`, `provider: 'S3'`, `draftProvider: null` |
| Unconfirmed with local offered / not offered | `offeredProviders` with / without `LOCAL_FILESYSTEM` |
| Confirmed: cloud, MinIO, local, SharePoint | `confirmed: true`, `confirmedAt`/`By`, the block filled, secrets `'set'` |
| SharePoint healthy | `accessLostAt: null` |
| SharePoint secret expiring | `secretExpiresOn` within 30 days |
| SharePoint access withdrawn | `accessLostAt` set, one fixture per `accessLostReason` |
| SharePoint with files (Disconnect locked) / without | `filesStored: 3, disconnectAllowed: false` / `0, true` |
| Change pending | `changeRequestedAt`/`By` set |
| Usage: normal, near, full, own | `usage.usedBytes` against `maxStorageGb` |

- **Test results** have fixtures for every step and code: pass, fail at write, read, verify or delete, each SharePoint step, and timeout.
- **The recycle bin:** empty, one file, 18 files across record types and deleters, ≤ 3 days left, and a restore refused `FILE_RECORD_GONE`.
- **Refusals:** each write's refusal codes, through `FilesService.refusal()`.
- **Secrets:** request bodies are asserted to carry a secret only when typed.

**Layout specs:** EN and AR at 1130 / 988, 358 and 328 px of content. They cover:
- the strip, the radio list, the cards and the bin;
- no sideways scroll;
- dialogs under the 420 cap: Confirm 94 / 104 and Purge 130 / 142 as drawn; Request a change is a 560 form at 204 / 222.

**Backend**
- No change, except G5. Its unit tests go in `storage-settings.sharepoint.spec.ts`.
- `npm run test:db` gets one db-spec showing that a passing test of the confirmed location clears `storageAccessLostAt` under the same guarded update as the probe. It runs on the throwaway local Postgres (:55433), never :55432.

**Browser (local, as Hessa, EN and AR, 1280 and 390)**
- `GET /tenant/storage` and `GET /tenant/recycle-bin` are answered by Playwright `route.fulfill` with each fixture above, so every state is reached without touching the organisation.
- Every non-GET to `/tenant/storage*` and `/tenant/recycle-bin*` is fulfilled from a literal (a pass, a refusal) and never continued.
- A guard route aborts, and counts as a failure, any of those that isn't explicitly fulfilled.
- Nothing uses `route.fetch()`.
- Non-GETs are counted in two groups: sign-in/refresh (expected), and everything else, which must be 0 reaching the server.

---

## 6. The PR split

Each PR is one draft into `dev`, run through `/ready-to-pr` by Ahmad, and touches no migration unless stated.

**PR A — "File storage: the page, read-only states"** (blocks nothing; it can start now)
- **Scope:**
  - the `StorageSettingsService` and DTO types for `GET /tenant/storage`;
  - the route `/admin-settings/storage` with its guard, the rail item "File storage", and i18n;
  - the strip in every read state: unconfirmed, confirmed per provider, the pending request line, SharePoint withdrawn and expiring;
  - the radio list after confirming: locked fields, the "Current" chip, offered or not;
  - the usage card and the upload rules card;
  - loading skeletons and the error with Retry;
  - Setup health's Fix for `STORAGE_ACCESS_WITHDRAWN` and `STORAGE_SECRET_EXPIRING` → the page.
  - No write controls yet: the confirm button and Request a change arrive in PR B.
- **Tests:** fixtures for every read state; the route, nav and guard specs updated; rule 1's no-leak assertion; layout.
- **Browser:** each read state through interception, EN and AR at 1280 and 390, with 0 writes.

**PR B — "File storage: first-time setup, and Request a change"**
- **Scope:**
  - AccreditMe cloud, MinIO and the local folder: their fields, Test with its steps, the stale check, and the confirm dialog;
  - Request a change: the Form 560 dialog and the pending line taking over;
  - MinIO key replacement after Confirm: Replace opens both, then Test and "Save new key";
  - the upload control's tenant-admin variant with "Set up file storage" (G13).
- **Tests:** every state 1–10 and 15–19 and 23 in the design's table (L613–694); secrets only when typed; each refusal code; the confirm and request dialogs measured.
- **Browser:** every write fulfilled from a literal; 0 writes reaching the server.

**PR C — "File storage: SharePoint"** (waits on D1–D3)
- **Scope:** the fields as decided in D1 (Tenant ID, Client ID, secret, Site URL, Library name, optional expiry), plus:
  - Test with the SharePoint steps and their sentences;
  - the resolved site and library shown before Confirm;
  - Confirm;
  - after Confirm: Replace secret, Change client ID and a new expiry date;
  - the access-withdrawn banner, with its reason and what to fix in Microsoft;
  - the 30-day expiry line;
  - Disconnect, with its lock (`filesStored`) and reason;
  - a link to the customer guide (`docs/customer/sharepoint-storage-setup.md`, published where Ahmad decides).
- **Backend, if D5 is yes:** a passing test of the confirmed SharePoint location clears the withdrawn stamp, with unit tests and a db-spec.
- **Tests:** every SharePoint fixture; each step's code; the Disconnect lock; secrets write-only.
- **Browser:** as PR B.

**PR D — "Recycle bin"** (independent of B and C)
- **Scope:**
  - the route `/admin-settings/recycle-bin` and its rail item;
  - the list, with client-side search, filters, sort and pager (G8);
  - Restore, one or several, reported per file;
  - Purge with the tick, one call, and its refusals (G14);
  - the empty and filtered-empty states;
  - the gone-record row after `FILE_RECORD_GONE`;
  - Setup health's Fix for `STORAGE_ALMOST_FULL` → the bin;
  - the storage page's "Open recycle bin" link from the usage card.
- **Tests:** every bin fixture; the action gating; the dialogs measured.
- **Browser:** with the bin list intercepted, and restore and purge fulfilled from literals.

**Order:** A → B → D → C. D can run beside B. C waits only on the decisions.

---

## 7. Not built as drawn, and why

- **The SharePoint consent flow** (G1; D1).
- **No not-allowed page:** a refused URL goes to Home and the rail item is absent, the app's convention since ACC-70 and ACC-79. The design's denied page (L1038) would be a new shared component for one screen.
- **No "Show" on a typed secret** (D7).
- **No Switch, switch confirm or Disconnect for cloud, MinIO or local:** that matches the design. Disconnect exists for SharePoint only (D2).
- **No scanning row in Upload rules:** scanning isn't built (ACC-178).
- **No `am-file-upload` shared control, and no Delete-a-file dialog:** the task evidence dialog and list already exist (ACC-177). The design's §7 control is a separate refactor across the four homes, for a later ticket. Only the tenant-admin variant (G13) is in this ticket.
- **No draft save:** the design has no "Save for later". Test and Confirm send the values on screen. The API's pre-confirm `PATCH` draft is not used by the screen (D6).

---

## 8. Open decisions for Ahmad

**Blocking: these hold PR C only. A, B and D can start without them.**

- **D1 — SharePoint: build the API's fields, not the drawn consent flow?**
  - The drawn flow was dropped on 8 Oct, and the ticket lists the fields.
  - **Recommended:** build the six fields from ACC-185 §3.4, laid out in the MinIO pattern the design does draw:
    - the field rows;
    - the test box with SharePoint's steps (Sign in to Microsoft · Find the site · Find the library · Write · Read back · Delete);
    - the resolved "site › library" on a pass;
    - the same confirm dialog.
  - Ask the design thread for a quick pass of the SharePoint section afterwards, so the design file and the code agree.
- **D2 — Disconnect for SharePoint:** the design removed it; the ticket and API have it.
  - **Recommended:** build it as the API does: SharePoint only, absent for the other locations, and refused with its reason while files are stored there.
- **D3 — The secret's expiry field and the 30-day warning:** not drawn; in the ticket and API.
  - **Recommended:** the optional date field, plus a warning line in the SharePoint body from 30 days before: "The client secret expires on {date}. Create a new one in Microsoft and replace it here."

**Not blocking: the recommendation is what gets built unless told otherwise.**

- **D4 — The strip's status chip.**
  - **Recommended:** "Confirmed" for cloud, MinIO and local, since nothing measures their health (G4).
  - SharePoint shows "Can't be reached" while `accessLostAt` is set.
  - "Test again" runs a test on demand and shows its result for this visit. The page never runs a test by itself, because a test writes a file.
- **D5 — Does a passing Test clear "access withdrawn"?**
  - **Recommended:** yes, with a small backend change in PR C (G5). Otherwise the page says "can't be reached" for up to an hour after the customer fixes the grant.
- **D6 — Draft save before Confirm.**
  - **Recommended:** none, as drawn. Values typed before Confirm live only on the page.
- **D7 — The "Show" action while typing a secret** (design L594–599).
  - **Recommended:** not built. `am-secret-field` has no reveal by ACC-181's rule; one rule for every secret in the app.
- **D8 — MinIO "Use HTTPS".**
  - **Recommended:** no separate control. The endpoint's `https://` or `http://` is the choice, with the drawn warning in its help text (G9).
- **D9 — Rail labels and placement.**
  - **Recommended:** "File storage" and "Recycle bin" (the design's names), in Administration after AI credits, at `/admin-settings/storage` and `/admin-settings/recycle-bin`.
- **D10 — The change-request line after AccreditMe acts.**
  - **Recommended:** add "clear the request stamp when the change is made" to ACC-182 (G7). This ticket shows the line as drawn.
- **D11 — "File storage not confirmed" as a Setup health condition** (G11).
  - **Recommended:** a follow-up ticket, since it needs an enum value and a migration. The strip and the upload refusal already say it.
- **D12 — Where the customer SharePoint guide is linked from.**
  - **Recommended:** a "How to prepare SharePoint" link in the SharePoint body to wherever `docs/customer/sharepoint-storage-setup.md` is published. If it isn't published anywhere a customer can open, the link waits and the body keeps a sentence instead.

---

## Review answers (24 Oct)

- **D1:** build the API's six SharePoint fields (Tenant ID, Client ID, write-only secret, Site URL, Library name, optional expiry) in the MinIO layout the design draws, not the dropped consent flow.
- **D2:** Disconnect for SharePoint only, refused with its reason while files are stored there.
- **D3:** the optional expiry date field, plus a warning line from 30 days before.
- **D4–D9 and D12:** as recommended. For D12, if the customer guide isn't published anywhere a customer can open, the link waits and the body keeps a sentence.
- **D5:** yes; the small backend change goes in PR C.
- **D10:** noted on ACC-182.
- **D11:** filed as ACC-261 (lane B, needs a migration).

### PR A as built (CC-143, 24 Oct)

Branch `feature/ACC-260-storage-settings`, with `dev` merged in at `bab1c02`
(#213). Frontend only; no backend change.

**Built:**
- `StorageSettingsService` and `IStorageSettings`, field for field the
  backend's interface.
- `storage-view.ts`: the state logic as pure functions — the strip, the
  options, the current location's fields, SharePoint health, and usage.
- `StorageLocationComponent` (the "Where files are kept" card) and
  `StorageSettingsComponent` (the page).
- The route `/admin-settings/storage` with its own `permissionGuard`, and the
  rail item "File storage" after AI credits.
- Setup health's Fix for `STORAGE_ACCESS_WITHDRAWN` and
  `STORAGE_SECRET_EXPIRING`.
- English and Arabic.

**Built differently from the design:**
- **No write control:** no Request a change, Test again, Replace or Confirm.
  Those are PRs B and C.
- **The chip says "Confirmed", not "Working"** (D4): nothing measures health.
- **Secrets read "Set" with no date** (G12).
- **No file counts** (G6). Usage has no recycle-bin line yet; that comes with
  PR D.
- **No scanning row** in Upload rules (ACC-178).
- **Before confirming, the options are a plain list,** with nothing selected or
  open, and the subtitle says what is true now. Choosing one comes with PR B.
- **"Fixed for your organisation. Only AccreditMe can move it."** replaces "· to
  move, request a change" until that control exists (PR B).
- **SharePoint follows D1:** the six fields, with the tenant, site and library
  locked.
- **"Today" for the expiry warning is the UTC calendar day,** so the 30-day line
  can be a day early or late near midnight in the tenant's zone.

**Layout spec** (EN and AR at 988, 358 and 328px of content, five states each):
- **Nothing is wider than the frame:** sideways 0 in every case.
- **Usage and rules** sit side by side at 988 and stack on a phone.
- **A long MinIO endpoint wraps** inside its field at 328.

**Mutation checks:** 15, each red on a failing test:
- the not-confirmed state;
- the danger tone;
- withdrawn shown as Confirmed;
- AccreditMe cloud showing a location (rule 1);
- a raw secret marker (rule 2);
- options not greyed;
- the 30-day boundary;
- withdrawn priority;
- the 90% boundary;
- own storage before confirming;
- the request line hidden;
- a write control appearing;
- the route with no guard;
- the rail item on `tenant:view`;
- the Setup health Fix with no permission.

### PR B as built (CC-147, 25 Oct)

Branch `feature/ACC-260-storage-setup`, from `dev` at `341545f` (#215).
Frontend only; no backend change.

**Built:**
- `StorageSettingsService`: `test`, `confirm`, `replaceKeys` (PATCH) and
  `requestChange`, with `IStorageTestResult` and `IStorageCandidate` field for
  field the backend's.
- `storage-setup.ts`: the setup rules as pure functions — the request bodies,
  the stale check, the test box's view, the reason beside Confirm, the
  Location pair, and the DTO's validators.
- `StorageTestBoxComponent`, `StorageConfirmDialogComponent` (Confirm 420),
  `StorageRequestDialogComponent` (Form 560); `StorageLocationComponent` holds
  the forms and the test state.
- `am-secret-field` gained `forceShowErrors` and `replaceClicked` (opt-in).
- The task evidence dialog's admin variant (G13), with "Set up file storage".
- English and Arabic.

**Built differently from the design, or from this plan:**
- **The test shows five steps, not three:** configure, write, read, verify and
  delete — what the API runs (`runTest`). While it runs, every step shows
  "not run yet": the API answers once, at the end, so the drawn "step 2 of 3"
  can't be known.
- **A failed step's sentence comes from the STEP, not the server.** The design
  quotes the server ("access is denied for bucket …", L620–624); the API sends
  `STORAGE_UNAVAILABLE` for every MinIO and local failure and keeps the
  provider's words for its log, so the screen says what that step needs and
  where to look. The delete sentence can't name the probe file either.
- **No "Use HTTPS" select** (G9, D8): the endpoint's scheme is the choice, and
  its hint says what http:// does.
- **The folder path is relative to the installation's storage folder** (G10),
  so the drawn UNC path is refused on screen with what is accepted.
- **No "Show" while typing a secret** (D7).
- **SharePoint is listed but not selectable** before confirming, as PR A drew
  it; it is set up in PR C.
- **A draft saved through the API is picked up**: its option is selected, its
  values shown and its stored keys read "set" (typing one is then optional).
  The screen still saves no draft (D6).
- **No "Test again" on a confirmed location** (D4's on-demand test): not in
  this PR's scope.
- **"Confirmed by" and "Requested by" name the signed-in user**, as the
  session has them ("Dr. Hessa Al-Dosari").
- **The admin variant (G13) appears after the first refused upload**: the
  evidence dialog does not read the storage settings beforehand, so the
  drawn "off" zone before any upload isn't shown.
- **Request a change in Arabic measures 219, not the drawn 222:** `am-field`'s
  message row is one 17px line in both languages, where the drawing's Arabic
  help line is 20px. Changing `am-field` would move every form.

**Layout spec** (EN and AR at 988, 358 and 328px of content, five setup states
each): nothing wider than the frame, sideways 0 in every case. Dialog bodies:
Confirm 94 / 104 as drawn (and with a long endpoint, cut inside the dialog);
Request a change 204 / 219.

**Mutation checks:** 18, each red on a failing test:
- an untyped secret sent anyway;
- the form not emptied after Confirm;
- the stale check off;
- Confirm open without a pass;
- a failed step losing its sentence;
- the server's message shown for an unknown refusal;
- STORAGE_TEST_FAILED at confirm losing its step;
- AccreditMe cloud's Location not its name (rule 1);
- a local folder choosable where not offered;
- Replace opening only one key;
- Save new key sending more than the two keys;
- Request a change shown while one is pending;
- Test pressable while running;
- Test sending with invalid fields;
- the admin variant shown to everyone, and not shown to the admin;
- the secret field not telling its caller about Replace;
- the Request textarea not at the drawn height.

### Change request contact (PR B2, CC-151, 26 Oct)

Branch `feature/ACC-260-change-request-contact`, from `dev` at `3f02863`
(#220). Backend and frontend; no migration.

**Built:**
- `StorageChangeRequestDto` keeps the optional `message` (at most 1,000) and
  requires three more fields. Each is trimmed first:
  - `contactName`: 1–120 characters.
  - `contactEmail`: an email, at most 254.
  - `contactPhone`: "+" and a country code, then digits with spaces or
    dashes (`/^\+\d[\d -]*\d$/`), 8–20 characters, kept as typed.
- `requestChange()` passes the contact to the notice and puts it in the audit
  metadata beside `message` (`storage_change_requested`). Nothing new is
  stored on the organisation: its write is still the request time and who
  asked.
- The platform admins' notice adds a contact line after "Asked by …", in
  English and Arabic, and now goes in-app AND by email (`channel: 'BOTH'`).
  The other storage notices stay in-app.
- The request dialog has a contact group above the note:
  - Name and email start as the signed-in admin's. The phone starts empty,
    since no profile holds one.
  - The hint reads "AccreditMe will contact this person about the move. It
    may be your IT or security team."
  - Email and phone sit side by side where they fit and stack on a phone.
    Both are `dir="ltr"`.
  - The same rules as the server apply. A field says what is wrong once it has
    been left.
  - The body sends `contactName`, `contactEmail` and `contactPhone`, plus the
    note when there is one.

**Built differently from the design, or from the brief:**
- **No "Requested by" or "Sent to" pairs** (Ahmad, 26 Oct, CC-151b). With the
  contact group the body measured 435 / 441 at standard density and 433 / 433
  at compact, all over the 420 cap. Without the pairs it is 362 / 385 at
  standard density. The requester is always the signed-in admin, and the
  notice still names them ("Asked by …").
- **Send is never disabled** (CLAUDE.md, ACC-238, rule 5.2; Ahmad, CC-151b).
  The brief said "disabled until valid". Pressed on an invalid form, Send marks
  every field, shows every error and sends nothing.
- **The Arabic notice isolates the email and phone** (U+2066 … U+2069), so
  they read left to right inside the Arabic sentence. Before this the body had
  no isolation at all.
- **The email rule on screen requires a dot in the domain**, which is what the
  server's `IsEmail` accepts in practice, so `name@localhost` is refused on
  both sides.
- **Typing a phone counts as unsaved work**, so Escape asks before discarding
  it, just as a typed note does.
- **The layout spec holds the dialog body to the 420 cap alone.** Karma's
  window is about 600px tall, where the cap's `60vh` falls under 420 and a
  body that fits grows a scrollbar. That narrows the text and the English note
  wraps (383 instead of 362). The smallest screen these users have is 768px
  tall, where the cap is the 420. The browser measured the same 362.
- **KNOWN EXCEPTION, WAITING ON AHMAD'S DECISION: at phone widths the body is
  over the 420 cap and scrolls.** Measured (EN / AR): 495 / 528 at 358 and
  495 / 548 at 328, with email and phone stacked. At 560 it fits, 362 / 385.
  PR B measured this dialog only at 988, so this is the first phone
  measurement of it. Left as built (CC-151c): not compacted or stepped until
  Ahmad decides. ACC-120's order for a dialog over the cap is compaction
  first, then a step on a seam the form already has, then a page.

**Layout spec** (EN and AR at the 560 the page gives it, 358 and 328): nothing
sideways, nothing past the dialog. Body 362 / 385, 495 / 528 and 495 / 548.

**Mutation checks:** 10 backend and 17 frontend, each red on a failing test.
- Backend:
  - an invalid email, a phone with no "+", an empty name, or a phone of any
    length accepted;
  - the contact left out of the audit row, or written to the organisation;
  - the notice in-app only;
  - the English or Arabic body losing the contact;
  - the Arabic email and phone not isolated.
- Frontend:
  - each of the three fields not required;
  - the phone pattern or its length dropped;
  - the email pattern loosened;
  - Send disabled while invalid, or an invalid form sent;
  - errors not shown on Send, or not shown once a field is left;
  - the phone sent empty, or the contact not trimmed;
  - no prefill;
  - email or phone not left to right;
  - email and phone forced side by side;
  - a wider gap in the group.

**Browser check** (local, as Hessa, EN and AR at 1280 and 390):
- GET `/tenant/storage` was answered from a confirmed fixture.
- POST `/tenant/storage/change-request` was fulfilled from a literal, and its
  body asserted in each of the four runs.
- The guard aborted 0 other storage writes.
- Non-GETs: sign-in and refresh, 2 (expected); everything else reaching the
  server, 0.
