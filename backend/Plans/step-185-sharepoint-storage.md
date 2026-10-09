# Step 185 — SharePoint document library as a tenant storage location

Linear: ACC-185 (CF-06b, High). Branch: `feature/ACC-185-sharepoint-storage`,
cut from `origin/dev` at `562b019`.

**Status: APPROVED by Ahmad on 8 Oct, with every §9 recommendation (Q1–Q6) as
written.** Work runs in four stages with two stop points (§10): the setup half,
then STOP 1 (a live Test on al-manara, never confirmed), then the rest, then
STOP 2 (full checks, before `/ready-to-pr`).

**The model (Ahmad, 8 Oct): SharePoint works like MinIO.** The customer's own IT
prepares everything in their own Microsoft tenant, following our guide
(`docs/customer/sharepoint-storage-setup.md`). The tenant admin then enters the
values in AccreditMe. **AccreditMe has no Entra app of its own:** no
admin-consent flow, no callback, no state tokens, no delegated sign-in, no site
search, no held token, no publisher verification. The previous draft's sections
on all of those are removed.

Builds on ACC-177 (SYSTEM-REFERENCE §16). Backend only; lane A builds the
screens from "AccreditMe Storage Settings.dc.html". That drawing is not in
`frontend/design-reference/`, so §3.4 lists what the screens must show.

---

## 0. What was verified before planning

| Claim | Finding |
|---|---|
| Resolver | `StorageResolverService` (`forUpload`, `forCandidate`, `forFile`) is the only code that builds a provider. `forFile` refuses `FILE_UNAVAILABLE` when a file's own location is no longer configured. SharePoint becomes a fourth `case`, shaped like MinIO. |
| MinIO's rules | `confirm()`: once, needs a passing test (guarded `updateMany`). `update()` after confirmation: only new keys for the SAME endpoint and bucket, after a passing test; anything else gets `STORAGE_CHANGE_BY_PLATFORM`. SharePoint reuses both, with tenant + site + library in place of endpoint + bucket. |
| **Draft saves write the provider today** | `update()` before confirmation runs `data: { storageProvider: dto.provider, … }`. A SharePoint draft would write `SHAREPOINT`, which the brief forbids. **It changes (§3.1):** only Confirm writes `storageProvider`. `test()` already writes nothing. |
| Downloads | `openDownload` falls back to `files/stream/:token` (15 minutes) when a provider has no `signedDownloadUrl`. SharePoint streams with no change. |
| Quota | `cloudUsageBytes` counts `provider: 'S3'` only, so SharePoint is excluded with no change. |
| Secrets | `storageConfig` is encrypted. MinIO's secret is write-only and reported as `'set'`. The SharePoint secret follows exactly that pattern. |
| Setup health | Detectors are pure database reads (`storageAlmostFull`). An expiry detector is equally cheap. A Graph probe is not a detector; it runs before them (§5). |
| Scheduled work | `storage-purge` runs daily (`RecycleBinService.purgeExpired`), the natural home for the 30-day secret notice. |
| Railway | One replica. Nothing here depends on it: there is no held state anywhere now. |

---

## 1. Microsoft access model — the customer's own app

### 1.1 What the customer creates, and what it can reach

- **A single-tenant app registration in the customer's own Entra tenant,** with
  a client secret.
- **Recommended permission: application `Lists.SelectedOperations.Selected`
  plus a `write` grant on ONE library.** The permission alone reaches nothing:
  *"Selected scopes require an explicit assignment action; an application
  consented for Lists.SelectedOperations.Selected would initially have no
  access."* ([Selected permissions overview](https://learn.microsoft.com/en-us/graph/permissions-selected-overview))
  The grant is `POST /sites/{site-id}/lists/{list-id}/permissions`
  ([Create permission on a list](https://learn.microsoft.com/en-us/graph/api/list-post-permissions)).
- **Also accepted: application `Sites.Selected` plus a site grant**
  (`POST /sites/{site-id}/permissions`;
  [Create permission on a site](https://learn.microsoft.com/en-us/graph/api/site-post-permissions)).
  It reaches the whole site, but it is the common, long-standing pattern, and
  some IT teams already have it.
- **Never `Sites.ReadWrite.All` application.** If a customer's app holds it,
  AccreditMe still works; the guide simply tells them not to.
- **The cost of the library grant,** which the guide states: *"Assigning
  application permissions to lists … breaks inheritance on the assigned
  resource"* (Selected overview). Hence the recommendation of a library used
  only by AccreditMe.

### 1.2 Who in the customer's tenant does what

| Task | Who | Source |
|---|---|---|
| Register the app, create the secret | Application Developer or above | — |
| Grant admin consent to a Graph **application** permission | **Privileged Role Administrator** or Global Administrator. Cloud Application Administrator and Application Administrator are excluded for *"Microsoft Graph app roles (application permissions)"* | [Grant tenant-wide admin consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent) |
| Create the **library** grant | A SharePoint Administrator, or an owner of the site (the delegated caller needs rights on the list). The list API page lists delegated `Sites.ReadWrite.All` as least privileged; the Selected overview's table says `Sites.FullControl.All`. The guide uses `Sites.FullControl.All`, which works under either reading. | List grant page; Selected overview |
| Create a **site** grant (the alternative) | *"In delegated workflows, the user must have an administrator role, such as SharePoint Administrator or higher"* | Site grant page |

### 1.3 Tokens: plain `fetch`, no MSAL

The client-credentials request with a shared secret is one form POST:

```
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
client_id, scope=https://graph.microsoft.com/.default, client_secret, grant_type=client_credentials
```

`{tenant}` takes *"GUID or domain-name format"*, so a primary domain is accepted
as entered. It returns `access_token` and `expires_in`, with *"refresh tokens
will never be granted with this flow"*.
([Client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow))

**Decision: no `@azure/msal-node`.** With a secret there is no assertion to
sign, so MSAL's main value — certificate signing — doesn't apply here. Microsoft
does recommend MSAL in general ("when possible"); what we'd lose is its token
cache, which is ten lines:

- a `Map` keyed by `(tenantId, clientId, sha256(secret))`;
- each token reused until 5 minutes before `expires_in`;
- in memory only, never logged.

Hashing the secret into the key means rotating the secret can never reuse a
token from the old one. **No new dependency.**

The tenant is stored as the admin typed it. After the first successful token,
the tenant GUID is recorded as well, read from the `tid` claim of our own token,
and that GUID is what the post-confirmation lock compares.

### 1.4 Resolving what the admin typed — the open question to settle live

- **Site:** `GET /sites/{hostname}:/{server-relative-path}`
  ([Get site by path](https://learn.microsoft.com/en-us/graph/api/site-getbypath)).
  The documented app-only least privilege is **`Sites.Read.All`**. Neither
  Selected permission is listed.
- **Library:** `GET /sites/{site-id}/lists?$filter=displayName eq '{name}'&$expand=drive`
  returns the list id and its drive id together.

**So whether an app holding ONLY a library grant can resolve the site URL and
the library name is NOT settled by the documentation.** With `Sites.Selected`
and a site grant it should work, because the app can read its own site.

The live test (§7) settles it. **If it fails under the library-only grant,
the proposal is:** the tenant admin enters the **Site ID and Library ID**
instead. They are the two values the customer's IT already has: the guide's
PowerShell prints both just before it creates the grant. The screen would offer
"Site URL and library name" or "Site ID and library ID". AccreditMe then calls
`GET /sites/{site-id}/lists/{list-id}/drive` (and `GET /sites/{site-id}` for
the display name); whether those work under a library grant is checked in the
same run. If even that fails, only `Sites.Selected` would be supported, and
that comes back to Ahmad.

---

## 2. What the tenant admin enters

| Field | Rule | Stored |
|---|---|---|
| Tenant ID | a GUID, or a domain name (e.g. `contoso.onmicrosoft.com`, `contoso.com`). Validated by shape; Test proves it. | encrypted config, plus the resolved GUID after a passing test |
| Client ID | a GUID | encrypted config |
| Client secret | **write-only**: never returned, shown as `"set"`, never logged | encrypted config |
| Site URL | `https://{host}.sharepoint.com/sites/...` or `/teams/...`, HTTPS only, the host ending in `.sharepoint.com` (plus a list for national clouds, Q3) | encrypted config, with the resolved site id and display name |
| Library name | the display name, 1–255 characters | encrypted config, with the resolved list id, drive id and URL |
| Secret expires on | optional date | encrypted config |

**`storageConfig.sharepoint`** (encrypted, with the secret inside it as the
MinIO secret is):

```ts
{
  tenant, tenantId?, clientId, clientSecret, siteUrl, libraryName, secretExpiresOn?,
  resolved?: { siteId, siteName, listId, driveId, libraryUrl, resolvedAt }
}
```

`resolved` is written by a passing Test, or by a save that runs one. It is what
Confirm locks and what the provider uses.

**The host check** — `*.sharepoint.com` over HTTPS — is the SharePoint
equivalent of MinIO's private-address guard. AccreditMe only ever calls
`login.microsoftonline.com` and `graph.microsoft.com`; the site URL is parsed
into a host and a path for Graph, and **never fetched directly**, so no internal
address can be reached through it.

---

## 3. API

Every endpoint is on the existing storage-settings controller: `TenantGuard` +
`PermissionGuard` + `@Permissions(tenant:manage_config)`. **No new route except
Disconnect.**

### 3.1 The existing endpoints, extended

- **`PATCH /tenant/storage`** — `{ provider: 'SHAREPOINT', sharepoint: { tenant, clientId, clientSecret?, siteUrl, libraryName, secretExpiresOn? } }`.
  - **Before confirmation:** saves a draft into `storageConfig` and **does NOT
    write `storageProvider`.** This changes `update()` for every provider: only
    Confirm writes the provider. A MinIO or local draft therefore no longer
    flips the provider either. That is harmless, because uploads are refused
    until confirmation anyway, and it keeps one rule.
    - A new non-secret `draftProvider` in the config tells the screen which
      option was chosen.
    - A spec pins that saving and Test never write `storageProvider`.
  - **After confirmation:** only `clientId`, `clientSecret` and
    `secretExpiresOn` may change, and only after a passing test against the
    SAME tenant GUID, site id and list id. Changing the tenant, site URL or
    library name gets `STORAGE_CHANGE_BY_PLATFORM` (403).
- **`POST /tenant/storage/test`** — `{ provider: 'SHAREPOINT', sharepoint?: {…candidate} }`.
  Merges the candidate over the stored values, so a blank secret means "the
  saved one", the same as MinIO. **Saves nothing, and writes nothing to
  `Organization`.** The steps, each reported pass or fail with a plain reason:

  | Step | Fails as (`code` → message) |
  |---|---|
  | `configure` | `STORAGE_SETTINGS_INCOMPLETE`, or a bad site URL → *"Enter the SharePoint site's address, starting https:// and ending .sharepoint.com/…"* |
  | `token` | `AADSTS90002` / `AADSTS900023` → **`SHAREPOINT_TENANT_NOT_FOUND`** *"Microsoft doesn't recognise this tenant ID"*; `AADSTS700016` → **`SHAREPOINT_CLIENT_NOT_FOUND`** *"Wrong tenant or client ID — this app isn't registered in that tenant"*; `AADSTS7000215` / `AADSTS7000222` → **`SHAREPOINT_SECRET_INVALID`** *"The client secret is invalid or has expired"*; `AADSTS7000112` → **`SHAREPOINT_APP_DISABLED`** *"The app is disabled in your tenant"* |
  | `site` | 403/404 → **`SHAREPOINT_SITE_NOT_FOUND`** *"Site not found, or the app has no access to it"* |
  | `library` | no match → **`SHAREPOINT_LIBRARY_NOT_FOUND`** *"No document library with that name on this site"* |
  | `write` | 401/403 → **`SHAREPOINT_NO_WRITE_ACCESS`** *"The app can see the library but can't add files — grant it write access"* |
  | `read`, `delete` | as for every provider |

  Code descriptions:
  [Entra error codes](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes)
  (`AADSTS7000215`: *"Invalid client secret is provided"*; `AADSTS7000222`:
  *"The provided client secret keys are expired"*; `AADSTS700016`: *"The
  application wasn't found in the directory/tenant"*; `AADSTS90002`: *"The
  tenant name wasn't found"*). The raw Microsoft message is never returned; it
  is logged, without the request body.
- **`POST /tenant/storage/confirm`** — `{ provider: 'SHAREPOINT' }`. As for
  MinIO: it re-runs the test against the stored values, then writes
  `storageProvider = SHAREPOINT` and the confirmation stamp in one guarded
  update. **This is the only place `SHAREPOINT` is ever written.**
- **`GET /tenant/storage`** gains:

  ```ts
  sharepoint: {
    offered: true;                     // no platform env needed any more
    tenant: string | null;             // as typed; the customer's own, shown to them
    tenantId: string | null;           // resolved GUID
    clientId: string | null;
    clientSecret: 'set' | null;
    siteUrl: string | null;  siteName: string | null;
    libraryName: string | null;  libraryUrl: string | null;
    secretExpiresOn: string | null;
    accessLostAt: string | null;
    accessLostReason: 'SECRET_INVALID' | 'CONSENT_REVOKED' | 'GRANT_REMOVED' | 'LIBRARY_GONE' | null;
    filesStored: number;               // SharePoint files not yet purged
    disconnectAllowed: boolean;
  };
  draftProvider: StorageProviderKind | null;
  ```

  Nothing about AccreditMe's own cloud is added (rule 7).

### 3.2 The one new route

**`POST /tenant/storage/disconnect`** — the brief puts Disconnect in the
SharePoint model. The route is provider-neutral, but this ticket wires SharePoint
only (Q5).

- **Before confirmation:** clears the SharePoint block and `draftProvider`.
- **After confirmation, with no unpurged SharePoint file:**
  - `storageProvider` returns to `S3`;
  - `storageConfirmedAt` and `storageConfirmedById` are cleared;
  - the block is cleared;
  - audited as `storage_disconnected`, with the tenant, site and library in
    the record.

  The organisation is back to unconfirmed AccreditMe cloud, and uploads are
  refused until someone confirms again.
- **With any SharePoint file not purged** (live or in the recycle bin):
  **`STORAGE_LOCKED_BY_FILES`** (409), with `filesStored` in the details.
- **Uses a guarded update,** so two admins disconnecting at once can't both
  succeed. The file count runs inside the same transaction, so an upload
  landing at that moment can't be stranded.

The response reminds the admin that the app registration and its grant live in
their tenant: AccreditMe cannot remove them, and the guide says how.

### 3.3 New refusal codes

All live in `storage-refusal.ts`, with one English message each, and the
frontend maps them in English and Arabic.

| Code | HTTP |
|---|---|
| `STORAGE_ACCESS_WITHDRAWN` | 409 |
| `STORAGE_LOCKED_BY_FILES` | 409 |
| `SHAREPOINT_TENANT_NOT_FOUND` | 400 |
| `SHAREPOINT_CLIENT_NOT_FOUND` | 400 |
| `SHAREPOINT_SECRET_INVALID` | 400 |
| `SHAREPOINT_APP_DISABLED` | 400 |
| `SHAREPOINT_SITE_NOT_FOUND` | 400 |
| `SHAREPOINT_LIBRARY_NOT_FOUND` | 400 |
| `SHAREPOINT_NO_WRITE_ACCESS` | 400 |

The `SHAREPOINT_*` codes travel inside `STORAGE_TEST_FAILED`'s `cause`, the same
way MinIO's test failures report today.

### 3.4 What lane A's screens must show

- The six fields, with the secret write-only and shown as "Set".
- Test, with the step that failed and its plain reason.
- Confirm.
- After confirmation:
  - the tenant, site and library, read-only;
  - "Replace secret" and "Change client ID", each running Test before it saves.
- The secret's expiry date, and the 30-day warning.
- The access-withdrawn state, with its reason and what to fix in Microsoft.
- Disconnect, with its lock and the reason.
- A link to the customer guide.

---

## 4. `SharePointStorageProvider` (kept from the previous draft)

- **Built only by `StorageResolverService`:**
  - `forCandidate('SHAREPOINT', config)` for a Test;
  - `forUpload` once confirmed;
  - `forFile(file)`, which checks that `file.msDriveId` equals the configured
    `resolved.driveId`, or refuses `FILE_UNAVAILABLE`.
- **Interface:** `put()` may return `{ externalId }`; `getStream()` and
  `delete()` take an optional `externalId`. S3 and local ignore it.
  `StoredFileService.recordInTx` writes `msSiteId`, `msDriveId` and
  `msItemId`, so a file renamed or moved inside SharePoint is still found.
- **Upload:** `PUT /drives/{driveId}/root:/AccreditMe/{module}/{recordId}/{random}-{name}:/content?@microsoft.graph.conflictBehavior=fail`.
  - Simple upload *"only supports files up to 250 MB in size"*
    ([Upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content)),
    so our 25 MB cap needs **no upload session**.
  - `{organizationId}/` is dropped from the path, because the library is the
    customer's own; `storageKey` is unchanged.
  - Whether a path PUT creates missing folders is checked live. The fallback
    is creating them first.
- **Download:** `GET /drives/{driveId}/items/{itemId}/content`. Graph answers
  302 to a pre-authenticated URL; we follow it server-side and pipe the bytes.
  The client gets `files/stream/:token`, so we keep our own `Content-Disposition`
  (the original name, Arabic included), our own entitlement and our own log
  line. Graph's `downloadUrl` can't set the saved name, and it works for anyone
  holding it.
- **Delete (purge only):** `DELETE /drives/{driveId}/items/{itemId}`.
- **Throttling:** on 429 or 503, wait `Retry-After` (seconds or an HTTP date),
  with exponential backoff when no header is sent
  ([Throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)).
  - **Interactive requests** (upload, download, Test): at most 3 attempts and
    20 seconds of waiting in total, then `STORAGE_UNAVAILABLE` (502) with
    `retryAfterSeconds`.
  - **The purge job** leaves a throttled file for the next day's run.
  - No other 4xx is retried.
- **Purge lands in the customer's SharePoint recycle bin:** *"Deleting items
  using this method moves the items to the recycle bin instead of permanently
  deleting the item."* ([Delete a file or folder](https://learn.microsoft.com/en-us/graph/api/driveitem-delete)).
  AccreditMe's own delete and restore make no Graph call at all. The guide says
  this plainly, and so does the connection test's probe file
  (`AccreditMe/_probe/…`).

---

## 5. Withdrawn access, and the secret's expiry

### 5.1 Detection

One classifier in the Graph client:

| Signal | Reason |
|---|---|
| `AADSTS7000215` / `AADSTS7000222` | `SECRET_INVALID` — **an invalid or expired secret IS withdrawn access**, as the brief says |
| `AADSTS700016`, `AADSTS7000112`, or Graph 401 on a fresh token | `CONSENT_REVOKED` (the app was deleted, disabled or un-consented) |
| Graph 403 on the drive | `GRANT_REMOVED` |
| Graph 404 on the drive | `LIBRARY_GONE` |

Not a withdrawal:

- **404 on one item:** that file was deleted inside SharePoint. The download is
  refused `FILE_UNAVAILABLE`, and the connection is fine.
- **Timeouts, 5xx and throttling** that survive the retries: refused
  `STORAGE_UNAVAILABLE`. Transient, so no stamp is written.

### 5.2 What happens then

- **Uploads and downloads** are refused **`STORAGE_ACCESS_WITHDRAWN`** (409).
  The decision is made LIVE from the failing call, never from the stored flag
  (ACC-82).
- **`storageAccessLostAt` and `storageAccessLostReason`** are stamped by the
  one `updateMany` that moves them from null. That same call sends the
  **single** notice to the tenant admins, in English and Arabic, through
  `StorageNoticesService`. Later failures stamp nothing and send nothing.
- **Setup health:** a new condition, **`STORAGE_ACCESS_WITHDRAWN`**, open while
  the flag is set, with a Fix pointing at storage settings.
- **The single scheduled recomputer is a probe** that the hourly Setup health
  reconciler runs before its detectors, for every confirmed SharePoint
  organisation:
  - one token request plus `GET /drives/{driveId}?$select=id`;
  - it SETS the flag on a withdrawal signal, and CLEARS it when access works
    again (for example after the customer's IT re-granted access, or a new
    secret was saved);
  - clearing re-arms the notice for the next loss.
- **Saving a new secret or client ID that passes Test also clears it.** That is
  this model's "connect again": the tenant, site and library cannot change, so
  it is the same location by construction.

### 5.3 The secret's expiry — proposed

- **The notice:** if `secretExpiresOn` is set, the tenant admins are told once,
  30 days before, in English and Arabic.
  - It is sent by the existing **daily** `storage-purge` job (new step
    `warnExpiringSecrets()`).
  - It is guarded by a new nullable `Organization.storageSecretWarnedAt`,
    stamped by the one `updateMany` that moves it from null.
  - It is cleared whenever `secretExpiresOn` changes, so a replaced secret
    warns again 30 days before ITS expiry.
  - If the date is missing, nothing is sent: we cannot know it.
- **Setup health, proposed because it is cheap:** a new condition
  **`STORAGE_SECRET_EXPIRING`**, open from 30 days before the date until the
  secret is replaced or the date passes. After the date, the probe will find
  `SECRET_INVALID` and `STORAGE_ACCESS_WITHDRAWN` takes over. The detector is
  one database read and one config decrypt per SharePoint organisation, the
  same shape as `storageAlmostFull`.
  - The bell gets the event (the notice); Setup health gets the condition
    (ACC-82).

---

## 6. Tests

Graph and the token endpoint are faked: an injected `GraphHttp`, with no real
network. Every tenant-isolation spec carries the CI gate's exact name.

- **Only Confirm writes the provider** — the spec the brief asks for:
  - `PATCH` (draft) and `POST /test` with `provider: 'SHAREPOINT'` leave
    `Organization.storageProvider` unchanged;
  - `POST /confirm` is the only call that writes `SHAREPOINT`;
  - asserted on the Prisma calls, not only on the response.
- **Tenant isolation:**
  - Organisation B's settings never show A's tenant, client, site or library.
  - B's test or save never uses A's config.
  - `forFile` refuses a file whose drive isn't the organisation's library.
  - B's download token for A's file is a 404.
  - The token cache key includes the tenant, client and secret hash, so two
    organisations sharing a Microsoft tenant never share a token.
- **Locks:**
  - After confirmation, changing the tenant, site URL or library name gets
    `STORAGE_CHANGE_BY_PLATFORM`.
  - A new secret is saved only after a passing test against the SAME tenant
    GUID, site id and list id. A secret that passes against a DIFFERENT
    resolved library is refused.
  - `PATCH` switching provider after confirmation gets 403.
  - Disconnect with a live file, or one in the recycle bin, gets
    `STORAGE_LOCKED_BY_FILES`. With only purged files it succeeds, back to
    unconfirmed S3, and is audited.
  - Disconnect before confirmation clears the draft.
- **Test reasons:** each AADSTS code and each Graph status maps to its step and
  plain reason. No Microsoft message, secret or token appears in a response.
- **Withdrawn access:**
  - Each signal maps to its reason; an invalid or expired secret is withdrawn.
  - Only the first failure stamps the flag and sends a notice.
  - An item 404 and a transient failure stamp nothing.
  - The probe sets and clears the flag, and a passing secret save clears it.
  - The Setup health condition opens and closes with the flag.
- **Secret expiry:**
  - Exactly one notice, at 30 days.
  - None without a date.
  - A changed date re-arms it.
  - The condition opens at 30 days and closes on replacement.
- **Throttling:**
  - `Retry-After` in seconds, and as an HTTP date, are honoured.
  - Three strikes give `STORAGE_UNAVAILABLE`.
  - 503 is treated like 429; a 400 is never retried.
- **Recycle bin and purge on SharePoint files:**
  - Delete and restore make no Graph call.
  - Purge deletes by item id.
  - A purge failing because access was withdrawn leaves the row unpurged, to be
    retried the next day.
  - Usage never counts SharePoint bytes.
- **Upload and download:**
  - The upload path and `conflictBehavior=fail` are sent as specified.
  - The ids are recorded.
  - A download streams with the original name.
- **A log spy** over a full run (save, test, upload, download, purge, a failed
  token request) proves the secret, every access token, the token request body
  and the `Authorization` header never reach the logger.
- **Site URL guard:** an `http://`, a non-`sharepoint.com` host, embedded
  credentials, or an IP address are each refused at `configure`.

---

## 7. Live testing — Ahmad's tenant, al-manara, NOT confirmed

- **Ahmad enters his own values** through the local API, or the local screens
  if lane A has them, as an al-manara tenant admin. **He never pastes the
  secret to me;** I see only `"set"`.
- I run **Test** against his tenant and report each step.
- **Nothing is confirmed** on the shared database before ACC-185 is deployed:
  the deployed Prisma client doesn't know `SHAREPOINT` (ACC-173's rule). Saving
  and Test don't write it (§6 pins that), and I query al-manara's
  `storageProvider` before and after to show it is still `S3`.
- **Settled in that run:**
  1. With **only the library grant**, can the app resolve the **site URL** and
     **library name** to ids? (§1.4.) If not:
     - do the **site and library ids** work, through
       `GET /sites/{id}/lists/{id}/drive`?
     - and what to propose — the ids, or the library URL — written up for
       Ahmad.
  2. Does the path PUT create the `AccreditMe/…` folders?
  3. The probe file's write, read and delete, and where the deleted probe lands
     (the SharePoint recycle bin, checked by Ahmad).
- **After merge and deploy** (a later run, Ahmad's call): Confirm on al-manara,
  upload evidence, compare SHA-256, check usage is unchanged, revoke the grant
  to see the withdrawn path, put back a secret, and purge into the recycle bin.

---

## 8. Migration, dependency and docs

**Migration** (one, additive only):

- enum values `StorageProvider.SHAREPOINT`,
  `SetupConditionType.STORAGE_ACCESS_WITHDRAWN` and
  `SetupConditionType.STORAGE_SECRET_EXPIRING`;
- `Organization.storageAccessLostAt`, `storageAccessLostReason` and
  `storageSecretWarnedAt`;
- `StoredFile.msSiteId`, `msDriveId` and `msItemId`.

All nullable; no rename, drop or tightening. It is safe against the deployed
code only while no row uses a new enum value. Nothing writes one until the code
ships, and §7 keeps it that way.

**Dependency:** none added (§1.3).

**Docs:**

- **CLAUDE.md:**
  - "Storage Providers Per Tenant" gains Option 4, the customer's SharePoint
    library, set up by the customer as MinIO is.
  - Key Architecture Decisions gains an ACC-185 entry: the customer's app,
    MinIO-like locks, only Confirm writes the provider, withdrawn access
    including an expired secret, purge into their recycle bin, the expiry
    notice.
- **SYSTEM-REFERENCE §16:**
  - 16.1 model;
  - 16.2 resolver;
  - 16.5 download;
  - 16.7 settings and Disconnect;
  - 16.8 codes;
  - 16.10 quota;
  - 16.11 purge into their recycle bin;
  - new 16.14 on withdrawn access and secret expiry;
  - 16.13 "Not built".
- **SYSTEM-REFERENCE §13.2:** rows for the two new conditions.
- **§3.10–3.11 need no change.** They cover task requests, holds, the SLA limit
  and edit/cancel/reopen; file evidence is §16.6. Recorded so the absence reads
  as checked.
- **`backend/.env.example`:** nothing. No platform variable exists for
  SharePoint any more.
- **New: `docs/customer/sharepoint-storage-setup.md`** — the customer guide,
  English. Arabic follows as `sharepoint-storage-setup.ar.md` beside it.

---

## 9. Questions for Ahmad — ANSWERED 8 Oct: every recommendation accepted

| # | Decision |
|---|---|
| Q1 | Customer guides live in `docs/customer/`. |
| Q2 | If the library grant cannot resolve names: Site ID + Library ID, from the guide's PowerShell output. |
| Q3 | `*.sharepoint.com` only for now. |
| Q4 | Add the `STORAGE_SECRET_EXPIRING` Setup health condition. |
| Q5 | Disconnect wired for SharePoint only in this ticket; the route is provider-neutral. |
| Q6 | Only Confirm writes `storageProvider`, for every provider. |

The questions as asked, kept for the reasoning:

1. **Where customer guides live.** Recommended: **`docs/customer/`** in the
   repo, as versioned Markdown, until there is a help site. The frontend can
   link to the published copy later.
2. **If the library grant can't resolve names** (§1.4): offer **site ID +
   library ID** as the alternative input, taken from the guide's PowerShell
   output. Recommended over the library URL, which needs the same name
   resolution.
3. **National clouds.** Accept only `*.sharepoint.com` now. Recommended: **yes**.
   US Government and 21Vianet use other hosts and token endpoints; add them
   when a customer needs one.
4. **The secret expiry Setup health condition** (§5.3). Recommended: **add it**.
   It is one detector and one enum value, and it puts the date in front of
   whoever looks at Setup health, rather than only in a bell notice that can
   be dismissed.
5. **Disconnect for MinIO and local too?** The brief scopes it to SharePoint.
   Recommended: wire it for **SharePoint only** in this ticket, with the route
   provider-neutral, and extend it to MinIO and local in their own ticket once
   lane A's drawing shows it there.
6. **The draft-save change** (§3.1). Only Confirm writes `storageProvider`, for
   every provider. Recommended: **yes**. It is the rule the brief states, and
   one rule for all options. The only visible change: before confirmation,
   `provider` reads `S3` and `draftProvider` names the choice.

---

## 10. Progress

- [x] Ticket ACC-185 and branch
- [x] First draft (AccreditMe-owned app), superseded 8 Oct
- [x] Rewritten for the customer-owned app; customer guide drafted
- [x] Ahmad's answers recorded here (8 Oct: Q1–Q6 as recommended)

**Stage 1 — the setup half (no migration):**
- [x] Token client and cache — plain `fetch`, no MSAL
- [x] SharePoint settings fields, with the secret write-only
- [x] Test, with a plain reason per step
- [x] Q6: only Confirm writes `storageProvider`, with the spec on database
      writes; mutation-tested (a draft writing it fails 4 specs)
- [x] `draftProvider`
- [x] Specs:
  - backend 114 suites / 2,650 tests; isolation 161; `check:worker-gate` 0;
  - the log spy is mutation-tested: logging the candidate fails it
- [x] Smoke test against the real Microsoft, saving nothing:
  - an unknown tenant gives `SHAREPOINT_TENANT_NOT_FOUND`;
  - a real tenant with an unknown client gives `SHAREPOINT_CLIENT_NOT_FOUND`;
  - a site off SharePoint stops at `configure`;
  - al-manara stays `S3`, with config null

**STOP 1 — live Test on al-manara, never confirmed (8 Oct):**
- [x] Ahmad followed the guide on his test tenant, with his own site and library
      names, and entered the values through the prompting script (draft saved
      18:23 UTC; the audit names the fields only).
- [x] (a) **The site URL and library name resolve** under the guide's library
      grant. So do the Site ID and Library ID. The ids are an alternative input,
      not a requirement.
- [x] (b) Both ways passed all eight steps: configure → token → site → library →
      write → read → verify → delete. The site's name was readable as well.
- [x] (c) The path upload to `AccreditMe/_probe/…` succeeded in a library
      without that folder, so a path PUT creates folders. The delete passed, so
      the probe went to the SharePoint recycle bin. Ahmad to confirm both
      visually.
- [ ] (d) **DEFERRED** — revoking and re-granting needs Ahmad's Office 365 admin,
      available in two days. It runs in the post-deploy live run, or earlier if
      the admin is available.
- [x] (e) al-manara's `storageProvider` was `S3` before, after Ahmad's run, and
      after two re-runs; it stayed unconfirmed.
- [x] (f) Guide fix: `New-`, `Get-` and `Remove-MgSiteListPermission` exist only
      in the beta module, so every one is now an `Invoke-MgGraphRequest` call
      against v1.0 (POST, GET, DELETE `.../permissions/{id}`). The guide now
      also explains the `Sites.FullControl.All` sign-in and its admin consent,
      and shows where the Permission ID comes from.

**Stage 3 — continued straight on (Test passed both ways; al-manara stayed S3):**
- [x] Migration `20261008183440_acc185_sharepoint_storage`, generated by
      `prisma migrate diff` and additive only.
  - Locally: all 50 migrations applied cleanly to a fresh PostgreSQL (PGlite).
  - Shared database: applied 8 Oct, after the full suite passed. Then:
    0 `SHAREPOINT` organisations, 0 rows of either new condition, al-manara `S3`,
    and the live app healthy.
- [x] Provider and resolver case, and the `StoredFile` columns.
- [x] Confirm records the resolved location; credentials replaceable for the
      same library only; Disconnect.
- [x] Withdrawn access: stamped once, one notice, an hourly probe that sets and
      clears it, refused live.
- [x] The secret-expiry notice (daily) and both Setup health conditions,
      including frontend rows in English and Arabic.
- [x] Purge checks reachability first; the daily job defers.
- [x] Found and closed: `PATCH /tenant` could set `storageProvider` past
      Confirm and the lock (Q6). Now a 400.
- [x] Specs:
  - backend 119 suites / 2,735 tests; isolation 165;
  - three guards mutation-tested — the same library on replacement,
    Disconnect with files, and purge reachability.
- [x] Docs: CLAUDE.md (Option 4, the jobs, Key Architecture Decisions
      ACC-185) and SYSTEM-REFERENCE (§16.1–16.13, new §16.14, §13.2).
- [x] Rebased onto dev `08029ab` (ACC-120 sign-in), no conflicts.

**STOP 2 — full checks, then a report** (Ahmad runs `/ready-to-pr` himself)
- [x] Reported 9 Oct. Checks re-run by `/ready-to-pr` on `40bbab9` over dev
      `08029ab`:
  - backend TypeScript 0; 119 suites / 2,735 tests; isolation 165;
  - frontend TypeScript (app and spec) 0; `ng build` succeeds; 1,286 tests
    (seed 82887);
  - 12 `check:*` scans, every one exit 0.

**After the merge and deploy — the live run on al-manara:**
- [ ] Confirm, upload, download, withdraw, rotate the secret, purge.
- [ ] (d) revoke and re-grant (above).
