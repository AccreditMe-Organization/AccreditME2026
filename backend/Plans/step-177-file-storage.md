# Step 177 — File storage per organisation, and file evidence on tasks

Linear: ACC-177 (CF-06). Branch: `feature/ACC-177-file-storage`.
Plan approved by Ahmad on 2026-10-07, with the answers recorded in section 11.
Where an answer changed the plan, the plan text below already reflects it.

---

## 1. What was verified before planning

| Claim | Finding |
|---|---|
| Provider code | `StorageProvider` interface and `S3StorageProvider` in `backend/src/providers/storage`. The S3 constructor read `AWS_REGION ?? 'me-south-1'` and fell back to empty strings for keys and bucket. |
| `STORAGE_PROVIDER` | Registered and exported by `tenant.module.ts`, injected by nothing. |
| `Organization` | `storageProvider` (S3 / MINIO / LOCAL_FILESYSTEM, default S3), `storageConfig` (AES-256-GCM, `common/utils/tenant-config-crypto.ts`), `maxStorageGb` (default 10). |
| Shared dev database | al-manara, al-nakheel and platform: all `S3`, no `storageConfig`, `maxStorageGb` 10. `Plan` has no rows. |
| `TaskEvidence` | `s3Key`, `fileName`, `fileSize`, `mimeType` exist and are unused. Rows: 1 TEXT, 1 LINK, none with a key. `TaskEvidenceType` already has `ATTACHMENT`. |
| AWS settings | None in `.railway/railway.ts`. Local `.env` has blank keys and bucket. |
| Libraries | `multer` 2.1.1 via `@nestjs/platform-express` (no `@types/multer`); `file-type` 21 via `@nestjs/common` (ESM-only); `@aws-sdk/client-s3` and the presigner installed. |
| Docker | Not available. WSL2 Ubuntu exists. |
| Evidence today | Add-only: link or record reference, by an active assignee. No list endpoint, no delete, the UI shows a count. The only read path is `GET /tasks/:id`, gated by parent visibility. |

Conflicts found:

1. `GET /tenant/config` returned decrypted `storageConfig`, `authConfig` and `aiConfig`; `GET /tenant/email-config` returned decrypted email config. Harmless while empty, a secret leak once a MinIO key is stored.
2. Evidence counts (`complete()` and three list `_count`s) count every row; they must exclude deleted evidence.
3. CLAUDE.md "Foundation Outcomes" advertised `STORAGE_PROVIDER` as ready to inject.

---

## 2. Per-organisation resolution

New module `backend/src/foundation/file-storage/`. `StorageResolverService` is the ONLY code that builds a provider. Nothing else constructs or injects one; `STORAGE_PROVIDER` and the env-reading `S3StorageProvider` constructor are removed.

- **S3 (default).** AccreditMe's own bucket, from platform env only: `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. A missing value refuses with `STORAGE_NOT_CONFIGURED`, "File storage isn't set up yet" — never a default region. Optional `AWS_S3_ENDPOINT` + `AWS_S3_FORCE_PATH_STYLE` point it at an S3-compatible endpoint (used for local testing; platform env is trusted and not subject to the tenant SSRF guard).
- **MinIO.** Endpoint, region, bucket and keys from `storageConfig.minio`; the same S3-compatible provider class with `forcePathStyle`.
  - HTTPS only, and the endpoint's resolved addresses must be public, unless platform env `STORAGE_ALLOW_PRIVATE_ENDPOINTS=true` (Tier 2/3, where http is also allowed).
  - **The address check runs at connect time on every request**, not only when settings are saved, so a DNS change cannot slip past it. The check resolves the host, refuses private, loopback, link-local, CGNAT, multicast and unspecified ranges (v4 and v6, including v4-mapped v6), and the S3 client's lookup is pinned to the vetted address so the connection cannot be re-resolved elsewhere between check and connect.
- **Local folder.** Only when platform env `LOCAL_STORAGE_BASE` is set. The tenant's `rootPath` must resolve inside it. Every key is resolved and checked against the root with `startsWith(root + sep)`; keys are server-built from `[A-Za-z0-9._-]` segments, so traversal is impossible twice over. Files are streamed through the API.

Provider interface: `put(key, body, mimeType)`, `getStream(key)`, `delete(key)`, `signedDownloadUrl(key, ttlSeconds, { fileName, mimeType })` (S3/MinIO only; sets `ResponseContentDisposition` and `ResponseContentType`).

---

## 3. Stored-file record

`StoredFile` remembers the provider and location each file was written to:
`provider`, `bucket` and `endpoint` (S3/MinIO), `rootPath` (Local). Switching an organisation's provider affects new uploads only; existing files are read from their own location.

**Location changes (answer 2).** Changing the MinIO endpoint or bucket, or the Local root path, while live files exist at the current location is REFUSED (409): "N files are stored at this location. Changing it would make them unreadable." Replacing keys for the same endpoint and bucket is allowed. Switching provider is allowed; the old MinIO or Local settings stay stored, so their files remain readable. Moving files between locations is a later tool (follow-up).

`TaskEvidence` points at the file through `storedFileId` (unique). Its legacy `s3Key` / `fileName` / `fileSize` / `mimeType` columns stay unused; dropping them is a later contract step. `TaskEvidence` gains `deletedAt` / `deletedById`.

---

## 4. Object keys and names

Key: `{organizationId}/{module}/{recordId}/{cuid}-{safeName}`.
`safeName` is ASCII `[A-Za-z0-9._-]`, at most 80 characters, keeps the extension, and falls back to `file.<ext>`.

Display name: the original, NFC-normalised, control characters and path separators stripped, trimmed, at most 255 characters.

Downloads send `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>` (RFC 5987/6266), so Arabic names survive.

---

## 5. Upload

- `multipart/form-data`, one field `file`; multer in memory, `limits: { fileSize: cap + 1, files: 1 }`. SHA-256 from the buffer.
- **Size cap: 25 MB** per file; platform env `MAX_UPLOAD_MB` overrides (answer 6). CLAUDE.md's 50 MB updated.
- **Allow-list**, extension AND content must agree; the stored MIME type is the server's:

  | Group | Formats |
  |---|---|
  | Documents | PDF, DOCX, XLSX, PPTX, legacy DOC, XLS, PPT |
  | Data | CSV, TXT (valid UTF-8, no NUL bytes) |
  | Images | PNG, JPEG, GIF, WEBP, HEIC |

  Refused: SVG, HTML, RTF, ZIP, executables, macro-enabled Office (`.docm`, `.xlsm`, `.pptm`). Content is sniffed by magic bytes plus a ZIP central-directory check for `word/`, `xl/`, `ppt/`. A small in-house sniffer, not `file-type` (ESM-only; Jest).
- **Quota**: pre-check, upload, then the authoritative check in a transaction under `pg_advisory_xact_lock` for the organisation, summing live `sizeBytes`; over the limit, the object is deleted and the upload refused (`STORAGE_QUOTA_EXCEEDED`). `Organization.maxStorageGb` governs.
- **Audit**: one row per upload (the `TaskEvidence` CREATE row, with the file summary) and one per delete.

---

## 6. Download

Permission first, then the file's own location. Who may download: current or former assignees, anyone who may manage the task (`mayManage()`), or anyone passing `getByIdForViewer` parent visibility. Everyone else, and other organisations, get the identical 404.

S3/MinIO: a presigned URL valid 15 minutes. Local: an API URL carrying a 15-minute HMAC token bound to file, organisation and expiry, which streams the file (answer 5). No audit row for downloads (ACC-101's reasoning for reads); a log line instead.

---

## 7. Task evidence

- `POST /tasks/:id/evidence/file` — the same rule as adding a link: an active assignee, task open or on hold, under the row lock. Stored as `ATTACHMENT`, labelled "File".
- Evidence-required completion counts live evidence of any type. **Every evidence count excludes deleted evidence.**
- `GET /tasks/:id/evidence` — the item 6 rule. Storage keys are never returned; `GET /tasks/:id` filters deleted evidence and drops the key.
- `DELETE /tasks/:id/evidence/:evidenceId` — one route for every evidence type (answer 4): the uploader, while an active assignee, task open or on hold. A closed task: 409 "Evidence on a closed task can't be removed". A file's bytes are removed; the evidence and stored-file rows are soft-deleted (answer 3).
- Reopen keeps evidence.

---

## 8. Storage settings API (`tenant:manage_config`, no screen)

- `GET /tenant/storage` — provider, `{ minio: { endpoint, region, bucket, accessKeyId: "set" | null, secretAccessKey: "set" | null } }`, `{ local: { rootPath } }`, which providers this installation allows, `usage: { usedBytes, maxStorageGb }`.
- `PATCH /tenant/storage` — secrets write-only (omitted keeps the stored one), validated, encrypted, audited with changed field names only. The location-change refusal of section 3 applies.
- `POST /tenant/storage/test` — an optional candidate body merged with stored secrets; **saves nothing**. Writes a probe at `{orgId}/_probe/{cuid}`, reads it back, compares the SHA-256, deletes it, and reports the failed step: `configure`, `write`, `read`, `verify`, `delete`. Errors sanitised; a 10-second timeout per step.

Secrets elsewhere (answer 8): `GET /tenant/config` masks `storageConfig`, `authConfig` and `aiConfig`, and `GET /tenant/email-config` masks its secrets, as `"set"` or null — unless a frontend screen prefills or shows one, in which case that endpoint stays unmasked and is reported.

---

## 9. Tests and messages

- Tenant isolation tests named `should NOT return records belonging to a different tenant` for every new route and the quota sum.
- Every refusal the UI shows carries a stable `code` (the `AuthRefusalException` precedent): `STORAGE_NOT_CONFIGURED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_EMPTY`, `STORAGE_QUOTA_EXCEEDED`, `STORAGE_UNAVAILABLE`, `FILE_UNAVAILABLE`, `STORAGE_LOCATION_IN_USE`. The frontend maps codes to EN and AR, with the English message as fallback.

---

## 10. Migration (additive only)

`20261007_acc177_stored_file`: new enum `StoredFileOwnerType` (`TASK`), new table `StoredFile` (with `rootPath` beside `bucket` and `endpoint`, added for answer 2), and nullable `TaskEvidence.storedFileId` (unique), `deletedAt`, `deletedById`, with their foreign keys. A new table and nullable columns; the deployed client never selects them, and no existing enum changes.

---

## 11. Ahmad's answers (2026-10-07)

1. **Gates** as recommended. Local only when `LOCAL_STORAGE_BASE` is set, confined under it. MinIO HTTPS on public addresses unless `STORAGE_ALLOW_PRIVATE_ENDPOINTS=true`. The private-address check runs at connect time on every request, not only when settings are saved.
2. **Location changes**: changing the MinIO endpoint or bucket, or the Local root path, while live files exist there is REFUSED (409) naming the count — "N files are stored at this location. Changing it would make them unreadable." Replacing keys for the same endpoint and bucket is allowed. Switching provider is allowed; the old settings stay stored so their files remain readable. Moving files between locations is a later tool.
3. **Delete** removes the bytes and keeps the soft-deleted rows.
4. **One delete route** for all evidence types, by the uploader while an active assignee, task open or on hold.
5. **Local downloads**: HMAC token URL, 15 minutes.
6. **Size cap 25 MB**, `MAX_UPLOAD_MB` overrides; CLAUDE.md's 50 MB updated. Legacy DOC, XLS, PPT and HEIC included. Virus scanning is a High follow-up, since legacy Office files can carry macros.
7. **Frontend in this ticket**, built to the accepted drawing (`frontend/design-reference/AccreditMe Task Screens.dc.html`, committed on this branch), section 3.7: one "Add evidence" dialog — link, record reference if it already exists in the UI (otherwise link and file only), and file upload (drag and drop or browse, progress, the refusal messages, size and type limits shown) — plus an evidence list with download and delete. Opened from the rows on My tasks and the committee task list, replacing "Add link". Components the future task view (ACC-120 slice 3) can host unchanged. Evidence on a completed or cancelled task is read-only. Dialogs within the 420px cap, English and Arabic.
8. **Secrets**: mask `storageConfig`, `authConfig`, `aiConfig` in `GET /tenant/config` and the email config in `GET /tenant/email-config`, as `"set"` or null. If a settings screen prefills or shows a secret from these, leave that endpoint unmasked and report it (a lane A ticket follows).
9. **MinIO** for the local end-to-end test: download `minio.exe` from dl.min.io into the scratchpad, verify it against MinIO's published SHA-256, bind it to 127.0.0.1 only, delete it and its data folder when done.

Also:

- **Region decided**: AccreditMe's bucket goes in `eu-central-1` (Frankfurt) for now, next to the database; both move to the Gulf before the first real customer. Recorded in CLAUDE.md.
- `ATTACHMENT` is the stored type for file evidence, labelled "File".
- Linear follow-ups: virus scanning (High), orphan-object reconciler (Medium), moving files between storage locations (Low). Rate limiting stays with ACC-129.
- Cleanup proof at the end: no live test `StoredFile` or evidence rows left, and all three organisations still `S3` with no `storageConfig`.

---

## 12. Local testing

- Unit tests: Local provider against a temporary folder; S3/MinIO against a mocked `S3Client.send`.
- End to end: `minio.exe` on `127.0.0.1:9000`. The local backend's PLATFORM S3 settings point at it (`AWS_S3_ENDPOINT`, path-style, a local bucket and keys); every organisation stays `S3` in the database. Upload, list, download and delete as seeded personas, EN and AR. MinIO and Local proven through `POST /tenant/storage/test` with a candidate body, which saves nothing.
- After merge, Railway refuses uploads with "File storage isn't set up yet" until the bucket and AWS variables exist.

---

## 13. Progress

- [x] Plan and design reference committed
- [x] Migration applied and committed
- [x] File-storage module: providers, resolver, address guard, sniffer, keys, names, stored files, quota, download token
- [x] Storage settings API
- [x] Secret masking on `/tenant/config` (`/tenant/email-config` left unmasked: its screen saves the whole object back — reported)
- [x] Task evidence: file upload, list, download, delete; counts exclude deleted
- [x] Backend specs and tenant isolation tests
- [x] Frontend: Add evidence dialog, evidence list, wired into My tasks and the committee task list
- [x] i18n EN/AR
- [x] Docs: CLAUDE.md, SYSTEM-REFERENCE.md
- [x] Linear follow-ups: ACC-178 (virus scanning, High), ACC-179 (orphan reconciler, Medium), ACC-180 (moving files, Low)
- [x] Browser pass, EN/AR (no-bucket refusal, link evidence, Evidence panel, layering)
- [x] Live store end to end — SeaweedFS 4.48 (Apache-2.0, Windows build, MD5 verified), not MinIO (410 Gone) or AIStor (commercial)
- [x] Cleanup proof

---

## 14. Changes after the build report (Ahmad, 7 Oct 04:17 and 04:32)

Everything above stands except where this section replaces it.

### Answers to the build report

- **Live proof**: not AIStor (commercial licence). SeaweedFS (Apache-2.0) from
  its official GitHub releases — the Windows build if one exists, otherwise the
  Linux build in WSL Ubuntu — verified against the release's published
  checksum, its S3 gateway bound to 127.0.0.1 only, the local backend's PLATFORM
  settings pointed at it (`AWS_S3_ENDPOINT`, path-style). Prove upload, list,
  download, delete, restore and purge end to end as seeded personas; then
  delete the binary and its data folder.
- `StoredFile.rootPath`: accepted. Leaving `GET /tenant/email-config`
  unmasked: accepted — a High lane A ticket, "Email settings screen shows and
  saves raw secrets" (the JSON editor needs write-only secret fields before the
  endpoint can be masked).
- No Record kind, no scanning line, the Evidence dialog standing in for the
  task page, the two scan changes and `closed` on the list: accepted.

### New behaviour

1. **Confirm before first upload.** A new organisation defaults to AccreditMe
   cloud (S3), but ALL uploads are refused until a tenant admin confirms.
   Nullable `Organization.storageConfirmedAt` and `storageConfirmedById` (FK,
   ON DELETE SET NULL). `POST /tenant/storage/confirm` (`tenant:manage_config`)
   takes the chosen location (AccreditMe cloud, or MinIO or Local where this
   installation allows them), requires a passing connection test for MinIO and
   Local, saves, sets the two columns and writes an audit row. Until then
   uploads refuse with `STORAGE_NOT_CONFIRMED`, "File storage isn't set up yet.
   Ask your administrator.", checked before `STORAGE_NOT_CONFIGURED`. All three
   existing organisations are unconfirmed; no backfill.
2. **No self-service switching** (replaces answer 2 of §11). Once confirmed,
   `PATCH /tenant/storage` refuses any change of provider, MinIO endpoint or
   bucket, or Local root with 403 `STORAGE_CHANGE_BY_PLATFORM`, "Changing where
   files are stored is done by AccreditMe. Contact support." Replacing the
   access key and secret for the SAME MinIO endpoint and bucket stays allowed,
   with a passing test. `GET /tenant/storage` returns confirmed true/false and
   who confirmed and when. AccreditMe's own region, bucket or endpoint is never
   returned to a tenant; for AccreditMe cloud, only the provider.
3. **Request a change.** `POST /tenant/storage/change-request`
   (`tenant:manage_config`, only once confirmed), optional message ≤ 1,000
   characters. Notifies every platform admin of AccreditMe's platform
   organisation (in-app, EN/AR, after commit), naming the organisation, who
   asked, when, and the message. Nullable `Organization.storageChangeRequestedAt`
   and `storageChangeRequestedById` (FK, ON DELETE SET NULL), returned by
   `GET /tenant/storage`. A repeat request updates the date and notifies again.
   Audited. The switch itself happens outside the system, later from platform
   admin screens — a Medium Linear ticket, "screens not designed yet".
4. **Deleting a file is a 30-day soft delete** (replaces answer 3 of §11), for
   every record type, through `StoredFileService`: hidden from users at once,
   audited, bytes KEPT. Nullable `StoredFile.purgedAt`, `restoredAt`,
   `restoredById`. Tenant admins (`tenant:manage_config`):
   - `GET /tenant/recycle-bin` — deleted, unpurged files: name, size, type, the
     record it came from (type and display name), who deleted it and when, days
     left. A deleted file can never be viewed, downloaded or edited.
   - `POST /tenant/recycle-bin/:fileId/restore` — back to its original record
     (task evidence: the evidence row's `deletedAt` cleared too), audited.
     Restoring into a record that has since closed is allowed; refused, with a
     reason, if the record no longer exists.
   - `POST /tenant/recycle-bin/purge` with `fileIds` (1–100) — bytes deleted
     now, `purgedAt` set, one audit row per file. All or nothing; an id not in
     this organisation's bin gets the identical 404. The warning is the
     screen's job.
   - A daily worker job purges files deleted more than 30 days ago (bytes
     deleted, `purgedAt` set, audited; restored files untouched). Unit-tested,
     and proved locally once with a backdated test file.
   Deleted links and record references are soft-deleted and audited, but are
   not in the bin and cannot be restored.
5. **Quota**: only files on AccreditMe cloud count toward `maxStorageGb`,
   including deleted files not yet purged. Purged files stop counting.
6. **90% warning**: an upload that takes AccreditMe-cloud usage to 90% or more
   notifies the organisation's tenant admins once (EN/AR, after commit).
   Nullable `Organization.storageWarnedAt`, cleared when usage drops below 90%.
   A Setup health condition "Storage almost full" shows while usage is at 90%
   or more.
7. **Frontend**: the Add evidence dialog shows the `STORAGE_NOT_CONFIRMED`
   message. The storage settings, confirm, request-a-change and recycle bin
   screens are NOT built here (lane A, from the design thread's drawings).

**Migration**: a NEW migration file, additive only; the first one stays as
applied. **Local testing**: AccreditMe cloud may be confirmed for al-nakheel
through the new endpoint to prove uploads; at the end al-nakheel's
`storageConfirmedAt` and `storageConfirmedById` are reset to null. Cleanup proof
as before, plus 0 live `StoredFile` rows, the SeaweedFS files gone, and no
organisation's storage settings changed.

### Progress (§14)

- [x] Plan section, ACC-181 (lane A, High) and ACC-182 (Medium) created
- [x] Second migration applied and committed (`20261007050540_acc177_storage_confirmation_recycle_bin`)
- [x] Confirm, no self-service switching, change requests
- [x] 30-day recycle bin, restore, purge, daily purge job
- [x] Quota on AccreditMe cloud only, deleted-unpurged counted
- [x] 90% warning and "Storage almost full"
- [x] Frontend: the not-confirmed message, recycle-bin wording, Setup health row
- [x] Specs and tenant isolation tests
- [x] Live proof against SeaweedFS: upload, list, download, delete, restore, purge, daily purge
- [x] Docs: CLAUDE.md, SYSTEM-REFERENCE.md §16
- [x] Cleanup proof: 0 live StoredFile rows, SeaweedFS removed, all three organisations unconfirmed with no config
