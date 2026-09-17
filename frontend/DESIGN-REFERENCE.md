# AccreditMe design reference

The folder beside this file, [`design-reference/`](design-reference/), is the
**design specification the frontend is built against**. It is not decoration and
not a mock-up gallery: the design foundation ticket implements its tokens,
templates and states, and a screen that disagrees with it is wrong until one of the
two is deliberately changed.

## `design-reference/` belongs to Claude Design — nothing hand-authored goes inside it

**`frontend/design-reference/` is written wholesale by Claude Design. Nothing
hand-authored should ever be placed inside it.** Each new export replaces the whole
folder rather than merging file by file, so anything a person adds there — notes, a
readme, an ignore rule — is deleted by the next export, silently.

That is why this document lives **here, one level above the folder**, rather than
inside it: exports can overwrite everything they write without touching the
document that explains them. It used to be `design-reference/Readme.md`, which is
exactly where an export would have eaten it.

Because exports replace the folder wholesale, `git log` and `git diff` on
`design-reference/` are the history of the design.

## The files

| File (in `design-reference/`) | What it is |
| -- | -- |
| **`AccreditMe Design System.dc.html`** | **Authoritative.** 11 artboards: tokens (colour, space, radius, type), components, states and their rules. Every other file names its tokens — when a value differs between this file and another, this one is right. |
| `AccreditMe Templates.dc.html` | 7 page templates, plus the icon set, the notification panel and the task record page. Built from the system file's tokens. |
| `AccreditMe App Shell.dc.html` | Earlier single-screen file: the rail, top bar and content column. |
| `AccreditMe Committee Record.dc.html` | Earlier single-screen file: the object-detail (record) page, drawn on Committee. |
| `AccreditMe Users List.dc.html` | Earlier single-screen file: the full list page. |
| `AccreditMe Compact List Panel.dc.html` | Earlier single-screen file: the compact list as a panel inside a record page. |
| `support.js` | Shared runtime the `.dc.html` files load. Not a design artefact; do not edit. |
| `.thumbnail` | A generated preview image of the export. Kept deliberately — see below. |

The four single-screen files came before the two consolidated files and are kept
for the detail they carry. **Where one of them and the Templates file disagree, the
Templates file is the later decision.**

## Revisions: read "What changed", not this document

Both the system file and the templates file carry a **"What changed" artboard**
that records every revision: what moved, on which artboard or template, and why.
**That artboard is the authoritative revision record.** It travels inside the file
it describes, so it cannot drift from it.

This document deliberately states no revision number. A number kept here would go
stale the first time someone exported without updating it; the artboard cannot.
Read it before assuming an older screenshot, ticket or conversation still describes
the current design.

Five review findings raised against the previous export are closed in the export
this document was written for:

1. Export permissions and provenance.
2. The document-scroll constraint for the two editors that left the dialog.
3. The Arabic organisation name, and its dependency on ACC-89.
4. `requiredPermission` as a catalogue select, with a stale-value state.
5. The stage escalation field — held pending the decision to keep both escalation
   systems, and now drawn.

## Why `.thumbnail` is in git

It is generated, but it is part of the export: the design tool writes it into the
folder alongside everything else, so committing the folder as exported keeps each
commit a faithful snapshot. It is small (about 21 KB). Ignoring it would need a
rule outside the folder — an ignore file placed inside `design-reference/` would be
deleted by the next wholesale export, which is the same reason this document is not
in there — and would make that folder the one place where "what was exported" and
"what is in git" differ. The cost of keeping it is a small binary diff on each
export.

## Opening the files

Open a `.dc.html` file directly in a browser. Each needs `support.js` beside it, and
loads **IBM Plex Sans Arabic from Google Fonts** over the network. Opened offline,
the files still work but fall back to a system font, so Arabic text will not look
as designed — check a network connection before judging Arabic typography.
