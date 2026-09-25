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

## Templates was HAND-PATCHED at Rev 8 — an export will silently revert it

**This section exists because the patch below lives inside a folder that the
next Claude Design export replaces wholesale.** It is recorded here, one level
above, precisely so the correction is recoverable rather than lost in silence.

### What happened

Design System Rev 8 corrected the standard field block from **75px to 79px**
(label 18 + 4 + control 36 + 4 + slot 17). Its own changelog is explicit that
*"the drawings always rendered 79; only the arithmetic was wrong"*. Compact is
unchanged at 71 (can message) and 52 (cannot).

**Templates was not regenerated in that export**, so every body sum it printed
was still computed at 75 — and ACC-120 slices 4 through 10 read their
measurements from that file. Claude Code hand-patched the live figures rather
than leave seven unbuilt slices working from arithmetic 4px light per block.

### The rule applied, because the file is not uniformly "live"

`694px` appears five times in Templates, `279px` three, spread across artboard
captions, changelog entries, an FAQ answer and an instances list. Patching
some and not others would leave mixed-vintage numbers in one file, which is
worse than uniformly stale — a reader could no longer tell which were updated.
So:

* **CORRECTED** — artboard captions and the prose that measures what is drawn
  now, plus the live instances entry.
* **LEFT INTACT** — dated changelog entries. They record what a past revision
  said and are history, not claims about the current drawing. Rev 6's
  "249px — three field blocks", "414px to 358px" and "750px to 694px" are
  deliberately untouched.

### The corrections

| drawing | was | now |
| -- | -- | -- |
| New Task, one step | 694 (274 over) | **710 (290 over)** |
| New Task, step 1 | 279 | **287** |
| New Task, date view | 358 | **362** (58 spare, was 62) |
| Assign head | 341 | **345** (75 spare, was 79) |
| Set acting head | 249 | **261** |
| Set acting head, date view | 358 | **362** |
| Add holiday (historical "was") | 515 | **~527** — composition not printed, so the tilde is kept rather than inventing precision |

**No density decision flips.** A flip needs standard ≤ 420 at 75 and > 420 at
79, so a candidate must sit within 4px × blocks of the cap; the closest has
58px of spare. Nothing new exceeds 420 even at compact — every sum above the
cap is already resolved by a decision (Add holiday became an inline row, New
Task became two steps, the editors are page panels).

Two clarifications were added while patching: Assign head now **states** its
composition (79 + 8 + 258 = 345) rather than leaving it reconstructable only
by arithmetic coincidence, and the stage editor's 536px now says the 420 cap
is a diagnostic comparison rather than a violation, since the cap governs
dialog bodies and a page panel has none.

The stage/transition editors' 536px is **unchanged**: its parts are 77 / 172 /
77 / 77 / 56, none of them standard field blocks.

Compact List Panel, Users List, App Shell and Committee Record carry **no
arithmetic at all** — no body sums, no mention of the field block or the cap —
so 79 cannot invalidate anything in them.

### The process lesson, which is the durable part

Four files came back from the export as *"churn — zero content diff"* and that
read as the safe outcome. **The file most in need of regenerating was in that
group.** "Unchanged" and "correct" came apart: Templates didn't change because
nothing in it was edited, while the constant it depends on moved in another
file.

The Design System **owns** the field-block constant; Templates **prints sums
derived from it**. An export that changes a constant in one file should warn
when a consumer of it was not regenerated in the same run. Until it does, the
reader's rule is: **a "churn" verdict is only reassuring once you have checked
whether the file carries arithmetic.**

---

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
