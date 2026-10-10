# Step 189 — File viewer for attachments (ACC-189)

**Status: APPROVED, BUILDING (10 Oct).** D1–D5 answered (§10); the drawing
was accepted in the design review and is built to once it is copied into
`frontend/design-reference/` on this branch — where it and this plan differ,
the drawing wins on anything visual.
- Branch: `feature/ACC-189-file-viewer`, from `origin/dev` at `b9d76d3`,
  with `origin/dev` merged in on 10 Oct.

**Ahmad's rule:** every attachment anywhere in the app can be viewed inside the
app, not only downloaded.
- Task evidence uses the viewer first.
- Meetings and Document Management reuse it unchanged.

---

## 1. What exists today, measured on `b9d76d3`

| Piece | Where | What it does |
|---|---|---|
| The only attachment list | `frontend/.../task-evidence-list/task-evidence-list.component.ts` | Rows offer Download (`pi-download`) and Delete. There is no View. The DTO already carries `file.{id, name, mimeType, sizeBytes}`. |
| Download mint | `GET /tasks/:id/evidence/:evidenceId/download` → `TaskEvidenceService.download()` → `StoredFileService.openDownload()` | Checks `assertCanSeeEvidence()`, writes a log line, then returns `{ url, viaApi, expiresAt }`. |
| AccreditMe cloud (Supabase S3) and MinIO | `S3CompatibleStorageProvider.signedDownloadUrl()` | A 15-minute pre-signed GET with `ResponseContentDisposition: attachment`. `viaApi: false`. |
| Local folder and SharePoint | `GET /files/stream/:token` (`files.controller.ts`) | An HMAC token naming one file and one organisation, valid 15 minutes, needing no session. Sends `attachment`, `nosniff` and `no-store`. `viaApi: true`; the URL is relative to the API base. |
| Opening a download | `FilesService.open()` | `location.assign(url)`. This works only because the response is an attachment. |
| Allowed types | `backend/.../file-content.ts` | pdf, docx, xlsx, pptx, doc, xls, ppt, csv, txt, png, jpg, jpeg, gif, webp, heic, heif. The type is checked from content as well as name, and **the stored `mimeType` is the server's**. SVG and HTML are refused at upload. |
| API headers | `main.ts` | Helmet 8: CSP on, `frameguard: deny`, `noSniff`. Helmet's defaults add `Cross-Origin-Resource-Policy: same-origin`. |
| Frontend serving | `frontend/nginx.conf` | Proxies `/api/` to the backend, so **the API is same-origin with the app**; `environment.apiUrl` is the relative `/api/v1`. No CSP is set. |
| HTTP interceptor | `core/interceptors/auth.interceptor.ts` | Clones **every** HttpClient request with `withCredentials: true`. There is no opt-out. |
| Refusal words | `FilesService` `REFUSAL_CODES` and `files.refusal.*` in en/ar | **`STORAGE_ACCESS_WITHDRAWN` is missing in both languages.** ACC-185 was backend only, so a SharePoint withdrawal shows the server's English message today. |
| Download audit | `task-evidence.service.ts` | **A log line, not an audit row**: "A read, so a log line and not an audit row (ACC-101's reasoning)". |

---

## 2. Q1 — How the viewer gets the bytes

**Answer: the frontend fetches the minted URL as bytes and renders them itself.**
Nothing is ever served inline by our origin or by storage, so `frameguard` and
the `attachment` disposition don't matter.

**Measured (9 Oct, live API, al-nakheel's ACC-177 proof file).**
- Status codes and header names only were printed; the URL never was.
- A pre-signed GET to `*.storage.supabase.co` answers **200 with
  `Access-Control-Allow-Origin: *`**, and no `Access-Control-Allow-Credentials`,
  for every origin tried:

| Origin | GET | OPTIONS preflight (`Range`) |
|---|---|---|
| `https://al-nakheel.accreditme.app` | 200, ACAO `*` | 200, allow-headers present |
| `http://al-nakheel.localhost:4201` | 200, ACAO `*` | 200, allow-headers present |
| `http://localhost:4201` | 200, ACAO `*` | 200, allow-headers present |

**Consequences:**
1. **The S3 fetch must be sent WITHOUT credentials.** A browser rejects a `*`
   answer to a credentialed request, and our interceptor makes every
   HttpClient request credentialed. So the viewer fetches through an
   HttpClient built on **`HttpBackend`**: it bypasses every interceptor, and
   `withCredentials` stays false.
   - The stream route needs no session either (the token is the entitlement),
     so one fetch path serves both kinds of URL.
   - The mint call itself stays on the normal HttpClient, which needs the
     session.
2. **Stream URLs (local folder, SharePoint)** resolve against
   `environment.apiUrl`. They are same-origin in development (the dev proxy)
   and in production (nginx `/api/`), so neither CORS nor CORP applies.
3. **MinIO (a customer's own endpoint)** answers CORS however the customer
   configured it. MinIO's default allows any origin; a restricted bucket would
   fail the fetch.
   - No MinIO tenant exists.
   - Phase 1: a failed cross-origin fetch shows "This file can't be previewed
     from your storage", with Download. That message is a specific error state,
     not the generic one.
   - The MinIO setup notes gain one line: allow GET from
     `https://{slug}.accreditme.app`.
   - **Decision D3 below** offers streaming MinIO through the API instead.

**No API streaming is needed for S3.** If we streamed every provider through
the API for viewing, the cost would be:
- every view of an AccreditMe-cloud file passing through the API: up to 25 MB
  of Railway egress per view, plus Supabase-to-Railway ingress;
- a socket held open for the transfer.

That is unnecessary while Supabase answers CORS. SharePoint and local-folder
files already take this path for downloads.

---

## 3. Q2 — How PDFs are rendered

**Answer: `pdfjs-dist`, rendering to canvas. Not the browser's viewer in an iframe.**

- **Why not an iframe on a blob URL:**
  - **Chrome on Android** has no inline PDF viewer; it downloads instead.
  - **iOS Safari** shows an iframe'd PDF as a single static first page, or a
    page you cannot scroll inside the frame.
  - The built-in viewers' toolbars differ by browser, so the drawing's page
    count and zoom couldn't be ours or translated.
  - A blob frame is also the one place a future CSP would need `frame-src blob:`.
- **pdf.js** draws the same in every browser we support, and the controls
  (page n of N, zoom, fit) are our own components in both languages.
- **Arabic PDFs:**
  - pdf.js draws the glyphs from the fonts embedded in the file, so shaped
    Arabic renders as authored, right to left, on any device.
  - Non-embedded standard fonts are covered by shipping pdf.js's
    `standard_fonts` and `cmaps` folders as static assets
    (`standardFontDataUrl`, `cMapUrl`, `cMapPacked: true`).
  - Pages are never mirrored in an Arabic session: a page is the document,
    not the chrome (the ACC-79 rule: UI language ≠ document language).
- **Text layer:** canvas only in Phase 1. Selecting and searching text is a
  later ask; the text layer also carries a known bidi-ordering cost for
  Arabic selection.
- **Hardening:**
  - `isEvalSupported: false` (the CVE-2024-4367 class).
  - No annotation JavaScript, because pdf.js has no scripting without
    `pdf.sandbox`, which we won't ship.
  - Links in annotations are not made clickable in Phase 1.
- **New dependency:** `pdfjs-dist@6.4.299`. Mozilla's PDF renderer is the only
  maintained, permissively licensed, browser-only one. Licence **Apache-2.0**.
  - We use the **legacy build** (`pdfjs-dist/legacy/build/pdf.min.mjs`,
    524 KB, and `pdf.worker.min.mjs`, 1.3 MB). The modern build targets only
    the latest browsers, and our floor is Safari 16.4 / Firefox 115.
  - It is lazy-loaded the first time a PDF is opened, so it never enters the
    main bundle.
  - The worker is loaded with `new Worker(new URL(..., import.meta.url))`,
    which Angular's esbuild builder bundles.
  - Risk to check at build time: that nginx serves `.mjs` as JavaScript.

**Other Phase 1 types — no new dependency:**
- **Images (png, jpg, jpeg, gif, webp):** `<img>` on an object URL.
  - Fit to window, plus zoom in, zoom out and actual size, with keyboard
    `+`, `−` and `0`.
  - `alt` is the file name.
  - SVG never reaches here: it is refused at upload.
- **txt:** the bytes are decoded as **UTF-8** in the browser (`TextDecoder`,
  with the BOM stripped). The text is shown with Angular text interpolation in
  a `<pre>`, **never `innerHTML`**. A test feeds it `<script>` and
  `<img onerror>` and asserts they render as literal text.
- **csv:** a small in-house parser (RFC 4180: quotes, doubled quotes, CRLF,
  quoted newlines, BOM) feeding a plain `<table>`.
  - It stops after **500 rows**, showing "Showing the first 500 rows".
  - Cells are bound as text, never as HTML.
  - No dependency, matching ACC-177's in-house sniffer: ~50 lines with its own
    spec, against `papaparse` (MIT) for one table.
- **Which renderer a file gets** is decided by the server's `mimeType` (from
  content) and nothing the browser guesses:
  - `application/pdf` → PDF;
  - `image/png|jpeg|gif|webp` → image;
  - `text/plain` → text;
  - `text/csv` → table;
  - anything else → the "No preview for this type yet" panel with Download.

---

## 4. Q3 — Backend changes

**No inline mode is added.** Under Q1 the server never serves a file inline:
every response stays `attachment` and `nosniff`. So a download token can never
be "turned into" inline viewing, because no inline response exists to turn it
into. That is stronger than a separate token claim, and it costs nothing.

**What does change, kept small:**

1. **A view mint per host, beside the download mint:**
   `GET /tasks/:id/evidence/:evidenceId/view`.
   - **Same entitlement**: the same `assertCanSeeEvidence()`, the same query,
     and the identical 404 for anyone else. Viewing is allowed exactly where
     downloading is.
   - **Refuses types outside Phase 1**: 409 `PREVIEW_NOT_AVAILABLE` when the
     stored `mimeType` is not in a single backend list
     (`PREVIEWABLE_MIME_TYPES`, beside `file-content.ts`).
   - **Logs its own line**: "File … on task … viewed by …". So views and
     downloads are told apart.
   - **Returns the same `IFileDownload`.** The bytes are the same, and the
     disposition stays `attachment`, because the viewer reads the bytes and
     the browser never opens the URL.
   - A shared helper, `StoredFileService.openView(file)`, holds the type
     check, so Meetings and Documents mint views the same way.
2. **txt and csv as `text/plain; charset=utf-8`** — **not needed**, and
   deliberately not done.
   - The viewer decodes the bytes as UTF-8 itself, and nothing else ever
     renders them.
   - The stored type stays what the content sniffer decided (`text/plain`,
     `text/csv`), and downloads keep it, so Excel still opens a downloaded CSV
     as a CSV.
   - `nosniff` stays on the stream route.
3. **No migration.**

---

## 5. Point 6 — Audit of views

**Downloads write no audit row today.** They write a log line, by ACC-101's
rule that reads are logged, not audited. AuditLog records mutations; it is
append-only, retained three years and exported to the tenant. Reads appended
there would be attacker-writable volume.

**Proposal — decision D1:**
- Views get **the same log line as downloads**, saying "viewed" rather than
  "opened", so the two are told apart.
- If an access trail customers can see is wanted — who opened which controlled
  document, an accreditation question that Document Management will raise —
  it should be its **own** append-only `FileAccess` record: file, actor,
  view or download, time, address. It would have its own retention and
  surface, under its own ticket, and would cover downloads and views together.
- AuditLog stays for mutations.

---

## 6. The shared viewer — shape

All of it lives in `frontend/src/app/shared/files/`.

```ts
export interface IViewableFile { id: string; name: string; mimeType: string; sizeBytes: number }

export interface IFileViewerRequest {
  files: readonly IViewableFile[];                           // only real files; links and notes are not passed
  startIndex: number;
  access: (file: IViewableFile) => Observable<IFileDownload>; // the host's VIEW mint
  download: (file: IViewableFile) => void;                   // the host's existing download
}

FileViewerService.open(request): void   // one viewer at a time
```

- **`FileViewerComponent`, in a DRAWER (settled by the drawing; was a dialog):**
  - ONE shared `am-drawer` on PrimeNG Drawer, so later screens reuse it.
  - It opens from the END side: right in English, left in Arabic. The side is
    set from the language explicitly; PrimeNG is not trusted to flip it.
  - Modal: the page behind is dimmed and inert; clicking the mask does NOT
    close it.
  - 60% of the window wide, 720px minimum, with a fixed header and footer.
  - Expand switches to full screen and becomes Restore. Below 900px it is
    always full screen and Expand is hidden.
  - Registered with **`LayerStackService`**, so **Esc closes only the top
    layer**. The viewer can open from the evidence dialog on My tasks, which
    is itself a layer.
  - The header has the file name (`dir="auto"`), the type and size, and a
    "From …" line the opening list passes in ("From a task's evidence").
  - Previous and Next walk the list it was opened from, "n / total" counting
    files only (links are not passed; no-preview files are).
  - Focus returns to the row of the file LAST SHOWN, not the one first opened.
  - No deep link: the URL does not change.
  - Download is always offered, except in the deleted and SharePoint-withdrawn
    states.
  - The viewer keeps the version it opened until it is closed.
  - The look comes from the drawing.
- **Renderers:** one small component per kind (`pdf`, `image`, `text`, `csv`,
  `unsupported`), chosen by the type mapping above.
- **`FileBytesService`:** mints through the host's `access()`, then fetches
  with an `HttpBackend` client (no interceptors, no credentials). It resolves
  `viaApi` URLs against `environment.apiUrl`, and reports progress.
- **Task evidence:**
  - every ATTACHMENT row gets a View `am-icon-button` (`pi pi-eye`, labelled
    "View {name}");
  - the file name becomes a button that opens the viewer at that file;
  - the list passes only its file rows;
  - Download and Delete are unchanged.
- **Keyboard and screen readers:**
  - focus moves into the dialog and returns to the control that opened it;
  - Tab is trapped inside;
  - `aria-labelledby` points at the file name;
  - a polite live region announces "File 2 of 5: name", then "Loading", then
    the loaded or error state;
  - PageUp and PageDown move pages in a PDF;
  - the arrow keys move between files, **swapped in Arabic** so the key toward
    the next arrow means next;
  - the PDF canvas carries "Page n of N".
- **Right to left:**
  - logical properties throughout;
  - Previous and Next icons mirror;
  - document content (PDF pages, images, CSV cells) is never mirrored; CSV
    cells use `dir="auto"`.
- **Strings in English and Arabic**: every label, the loading state, and each
  error:
  - unsupported type;
  - too large to preview (a guard only: 25 MB is the upload cap);
  - can't be previewed from your storage (a cross-origin failure);
  - the file is no longer available;
  - SharePoint access withdrawn: `files.refusal.STORAGE_ACCESS_WITHDRAWN` is
    **added**, along with its code in `REFUSAL_CODES`;
  - link expired, which retries the mint once, then shows the error.
- **Formatting:** sizes through `FilesService.size()`, numbers through the
  formatting layer, so `check:formatting` holds.

---

## 7. Q4 — Phase 2: Word, Excel, PowerPoint, legacy Office, HEIC

**Never** use a viewer that sends a file to a third party, such as the Office
Online viewer with a public URL.

### (a) A converter service on Railway (recommended for Office)

- **What:** Gotenberg (MIT), which wraps LibreOffice headless, as its own
  Railway service. It is private: no public domain, reachable only on Railway's
  private network, with no outbound network of its own.
- **Formats:** docx, xlsx, pptx, doc, xls and ppt convert to PDF, and the PDF
  is shown by the Phase 1 PDF renderer.
- **HEIC:** LibreOffice doesn't read it. Add ImageMagick with libheif to the
  same service, or a tiny sidecar, converting to JPEG. Safari 17+ shows HEIC
  natively, but Chrome and Firefox don't.
- **Fidelity:**
  - High for docx and pptx.
  - Good for xlsx: it prints by print area, so wide sheets split across pages.
  - Legacy formats are fine.
  - Arabic needs the fonts in the image; Gotenberg ships Noto, and IBM Plex
    Sans Arabic is added to match the app.
- **Where the preview lives — recommended: STORED, beside the original, in the
  same storage.** In a customer's SharePoint library that means
  `AccreditMe/.../{random}-{name}.preview.pdf`.
  - The preview is a `StoredFile` row with a nullable `previewOfId`. That is
    an additive migration, done under the Phase 2 ticket.
  - It is generated by a BullMQ job after upload, and lazily on first view for
    older files.
  - **Lifecycle follows the original, in the same transaction:**
    - soft-delete hides both;
    - restore restores both;
    - purge purges both (SharePoint: both go to the recycle bin);
    - the 30-day job and the recycle bin list only originals.
  - **Quota:** an AccreditMe-cloud preview counts, because it is real bytes.
  - **Residency:** a SharePoint customer's preview stays in their library,
    never in AccreditMe cloud.
- **Not stored, converted on every view:** this has no lifecycle at all. But it
  costs 2–10 s and a LibreOffice process per view, and the bytes cross to the
  converter every time. Fine for a pilot, wrong at volume.
- **Cost:**
  - One Railway service sized at about 2 GB RAM, kept warm, roughly
    $15–25 a month at current Railway rates. To be measured, not quoted.
  - The job queue already exists.
  - Tier 3 runs the same container in the customer's stack.
- **Security:** LibreOffice parses untrusted files.
  - Isolated container, with no egress.
  - A per-conversion timeout and memory cap.
  - Macros disabled (Gotenberg's default).
  - Conversion must run **after** virus scanning once ACC-178 exists, and
    Phase 2 should not ship ahead of ACC-178.

### (b) Browser-only renderers

| Type | Library | Licence | Fidelity, and what it can't show |
|---|---|---|---|
| docx | `docx-preview` 0.4.1 | Apache-2.0 | Fair. Headers, footers, tables and images mostly right. RTL partial. Fields, text boxes, SmartArt and charts are lost. The HTML it builds must be sandboxed (no scripts). |
| docx | `mammoth` 1.13 | BSD-2-Clause | Content only: semantic HTML, no layout. Fine for reading, not for "what the document looks like". |
| xlsx | `exceljs` 4.4 | MIT | Values and basic styles into a table. No charts, images or conditional formats; formulas only as cached values. |
| pptx | `pptx-preview` 1.0.7 | ISC | Low. Simple slides only; animations, charts and SmartArt are lost. |
| doc, xls, ppt | none maintained on npm (SheetJS left npm, ACC-75) | — | Nothing. These would stay download-only. |
| heic/heif | `heic2any` 0.0.4, which bundles libheif | MIT wrapper; **libheif is LGPL-3.0** | Works, but ~1 MB+ of wasm, and an LGPL component in the bundle needs a licence decision. Safari 17+ needs none of it. |

Cost: no server, but several large lazy-loaded bundles; a lower and uneven
fidelity, uneven Arabic, and legacy formats uncovered. A reviewer comparing
"what the policy looks like" would see layout that isn't the document's.

### (c) Download only

Costs nothing. It is what Phase 1 already does for these types.

**Recommendation (decision D2):** (a) with stored previews, after ACC-178,
under its own ticket. Until then (c), which Phase 1 already is.

---

## 8. Q5 — Memory with 25 MB files

- **One file in memory at a time.**
  - Moving to another file or closing the viewer first **aborts** the
    in-flight fetch: the observable is unsubscribed, so `HttpClient` aborts
    the XHR.
  - It then **revokes** the current object URL (`URL.revokeObjectURL`) and
    drops the `ArrayBuffer` reference.
  - Only then is the next one fetched.
- **No prefetching of neighbours.**
- **PDF:**
  - The bytes go to pdf.js as `data` and are transferred to the worker, with
    no object URL.
  - Moving away or closing calls `loadingTask.destroy()` and
    `pdfDocument.destroy()`.
  - One `PDFWorker` lives for one viewer session and is terminated on close.
  - Pages render **lazily**: only those near the viewport (IntersectionObserver).
  - Canvases far from view are released (width and height set to 0).
  - `maxCanvasPixels` caps zoom memory.
- **txt:** only the first **1 MB** is decoded, with "Showing the first 1 MB".
  The `ArrayBuffer` is dropped after decoding.
- **csv:** the parse stops at 500 rows, then the bytes are dropped.
- **Images:** one object URL, revoked on switch and on close.
- **Lifecycle:** `DestroyRef` cleanup guarantees the revoke and destroy even
  when the host is torn down underneath the viewer, for example when a list
  refreshes. A spec asserts `revokeObjectURL` is called on close, on next, and
  on destroy.

---

## 9. Q6 — Tests and the live proof

**Frontend specs:**
- **`FileViewerComponent`:**
  - opens at `startIndex`, and Previous and Next stop at the ends;
  - Esc closes it, and only when it is the top layer;
  - focus returns to the opener;
  - the live region announces;
  - arrow-key direction is swapped in Arabic;
  - each type picks its renderer, and anything else gets the unsupported
    panel with a working Download;
  - error states: `STORAGE_ACCESS_WITHDRAWN` in both languages, the
    cross-origin failure, `PREVIEW_NOT_AVAILABLE`, and an expired link
    retried once;
  - **`revokeObjectURL` on close, on next, and on destroy**;
  - an in-flight fetch is aborted on next.
- **`FileBytesService`:**
  - the fetch goes through `HttpBackend` with `withCredentials` false. This is
    asserted, and mutation-tested: switching to the intercepted client must
    fail it;
  - `viaApi` resolution;
  - progress.
- **Renderers:**
  - text renders `<script>` and `<img onerror>` literally;
  - CSV cap and note;
  - BOM and Arabic text;
  - a PDF opens through a pdf.js stub: page count, zoom, `destroy()` on switch.
- **The CSV parser:** quotes, doubled quotes, CRLF, quoted newlines, BOM,
  ragged rows.
- **`TaskEvidenceListComponent`:**
  - a View button and a name button on file rows only;
  - they open the viewer with only the file rows, at the clicked one;
  - Download and Delete are unchanged.
- **Translation parity:** every new key exists in en and ar. The existing scans
  stay green: `check:icon-labels` (the eye button has a label),
  `check:formatting` and `check:dialog-overlays`.

**Backend specs:**
- The view mint returns 200 for anyone who may download.
- It returns the identical 404 for anyone who may not.
- It returns 409 `PREVIEW_NOT_AVAILABLE` for docx, heic and the other
  non-Phase-1 types.
- It writes the "viewed" log line, and no AuditLog row.
- `itEnforcesTenantIsolation` for the new query path.
- The stream route still sends `attachment` and `nosniff`.

**Live proof** (at build time, locally on 3001/4201):
- **al-manara (SharePoint):** view the image already on the cancelled task
  "SharePoint screen test". It is read-only, still viewable, and **not
  purged**.
- **al-nakheel (AccreditMe cloud, Supabase):** view the ACC-177 PDF. Then
  upload test files and view each one:
  - a multi-page PDF that includes Arabic;
  - png, gif and webp images;
  - a UTF-8 Arabic txt containing `<script>`;
  - a 2,000-row CSV, to show the cap;
  - a docx, to show the unsupported panel.
- **Check** in English and Arabic, at desktop and phone width, keyboard only.
  Confirm the network shows the S3 GET without cookies.
- **Afterwards** delete and purge every extra test file.
- Report status codes and header names only, never a URL or token.

---

## 10. Decisions for Ahmad

| # | Question | Recommendation |
|---|---|---|
| D1 | Views: the same log line as downloads, or a customer-visible access trail? | A log line now ("viewed" vs "opened"). An access trail is its own `FileAccess` record under its own ticket, covering downloads too, not AuditLog. |
| D2 | Phase 2 approach | (a) Converter with stored previews, after ACC-178. Until then, download only. |
| D3 | MinIO with a restrictive CORS policy | Phase 1 shows "can't be previewed from your storage" and documents the CORS line. Alternative: stream MinIO views through the API at up to 25 MB of egress per view; no tenant uses MinIO today. |
| D4 | PDF text selection and search | Not in Phase 1 (canvas only); a later ask. |
| D5 | pdfjs-dist, Apache-2.0, legacy build, lazy-loaded | Accept. |

**Answers (Ahmad, 10 Oct):**
- **D1:** a log line only ("viewed"), like downloads. No audit row, no
  customer-visible access trail.
- **D2:** Word, Excel, PowerPoint, legacy Office and HEIC are download only
  for now ("No preview for this type yet"). Previews are ACC-192.
- **D3:** a MinIO that blocks cross-origin requests shows "This file can't be
  previewed from your organization's storage" with Download, and the CORS
  setting goes in the customer docs. MinIO views are NEVER streamed through
  the API.
- **D4:** no text selection or search in PDFs in this version.
- **D5:** pdfjs-dist, Apache-2.0, legacy build, loaded only the first time a
  PDF is opened. Eval off, PDF scripting out.

## 11. Progress

- [x] Ticket ACC-189 and branch
- [x] Q1 measured: Supabase answers CORS (`*`, no credentials) for tenant
      subdomains and localhost
- [x] Plan written
- [x] Ahmad's answers to D1–D5
- [ ] Design drawing copied into `frontend/design-reference/` — accepted in
      review; the file is not on the branch yet
- [x] Backend: `GET /tasks/:id/evidence/:evidenceId/view`, the download's
      entitlement and 404 (`fileForViewer()`, shared); `StoredFileService.openView()`;
      `PREVIEWABLE_MIME_TYPES`; 409 `PREVIEW_NOT_AVAILABLE`; "viewed" log line.
  - The evidence method is `openView()`: `TaskEvidenceService` already has a
    private `view()` that maps list rows.
- [x] `files.refusal.STORAGE_ACCESS_WITHDRAWN` and `PREVIEW_NOT_AVAILABLE` in
      en and ar, and in `REFUSAL_CODES`.
- [x] `pdfjs-dist@6.4.299`, lockfile written on Linux. Assets copied by
      `angular.json`: the worker, `cmaps`, `standard_fonts`, `iccs`, and the
      image-decoder wasm WITHOUT `quickjs-eval.*`.
- [x] Non-visual frontend: the viewer contract, `FileBytesService` (no
      credentials on storage, mutation-tested), the CSV reader, the text
      decoder, the lazy pdf.js loader, the type mapping.
- [x] `docs/customer/minio-storage-viewing.md` (D3).
- [ ] `am-drawer`, the viewer, its renderers and states, task evidence wiring
      — after the drawing is on the branch.
- [ ] Live proof (§9), then Progress closed.

**Where the build differs from the plan so far:**
- **pdf.js 6 has no `isEvalSupported` option**: it has no eval or
  `new Function` path at all (checked in the shipped build). "Eval off" holds
  by construction. Its PDF scripting needs `pdf.sandbox` and a QuickJS wasm,
  neither shipped.
- **pdf.js 6 decodes JBIG2, JPEG 2000 and ICC profiles with wasm**, with
  plain-JS fallbacks. Both are shipped from our origin, so scanned PDFs render
  even if a future CSP refuses wasm.
- **The API is no longer same-origin with the app in production** (ACC-130:
  the app on Vercel, the API on `api.accreditme.app`). Stream URLs are fetched
  cross-origin without credentials; the API's CORS reflects the app's origin,
  so this works.
- **Vercel's CSP (report-only today) has `connect-src 'self'
  https://api.accreditme.app`.** Once enforced, it blocks the viewer's fetch
  of a Supabase pre-signed URL and of any customer MinIO. It needs the
  Supabase storage host before it is enforced.
