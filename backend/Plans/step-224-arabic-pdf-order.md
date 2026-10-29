# Step 224 — AI summary: Arabic PDFs are read in reversed order

Linear: **ACC-224** (lane B, High, Bug; related to ACC-193).
Branch: `fix/ACC-224-arabic-pdf-order`, from `origin/dev` at `2ac8174`.
**Status:** BUILT — merged as #170 (7948f37), 13 Oct.

When written: **APPROVED as written (Ahmad, 13 Oct), with the recommendations on Q1, Q2 and Q3 (§11). The short mixed-fragment case (§3) stays a recorded known limit. Building.**

**Scope:**
- **What changes:** how a PDF page's text is assembled before the model reads it, how a key point is cut, and one word in the AI log's description.
- **What does not change:**
  - no migration;
  - the price (15), model, effort and limits stay as they are;
  - no frontend change;
  - no organisation's credits are touched.
- **Already done in this prompt:** the four ACC-193 test files that were deleted at clean-up have been purged from al-nakheel's recycle bin, and no `AiFileSummary` row remains (§10).

---

## 1. What is wrong, and why

Seen in ACC-193's live proof (13 Oct, al-nakheel), and reproduced locally with the same code on the same file. A Chrome-made Arabic PDF reached the model like this:

```
( ر ا ب ت خ ا ة ق ی ث و ) ن ی د ی ل ا ة ف ا ظ ن ة س ا ی س
```

The document actually says "سياسة نظافة اليدين (وثيقة اختبار)". The model rebuilt a correct summary anyway, but:
- it cost **1,331 input tokens**, against 678 for the same document in English;
- a longer or more technical Arabic document will not reliably survive it.

**What pdfjs returns for that line.** This is a dump of the items on the mixed fixture's first line (§5), in stream order:

| # | `str` | `dir` | x | width |
|---|---|---|---|---|
| 0 | `ح.` | rtl | 185.3 | 10.9 |
| 1 | `ﺎ` | rtl | 196.2 | 3.0 |
| 2 | `ﻧ` | rtl | 199.2 | 3.2 |
| 3 | `ﺟ` | rtl | 202.3 | 6.9 |
| 4 | `" "` | ltr | 209.2 | 4.8 |
| … | … | | | |
| 11 | `%` | ltr | 242.9 | 11.6 |
| 12 | `95` | ltr | 254.5 | 14.5 |
| … | … | | | |
| 20 | `زام` | rtl | 297.4 | 13.4 |
| … | … | | | |
| 37 | `IPC-07` | ltr | 428.2 | 40.5 |

Three facts follow from this dump:

1. **Chrome writes the line in VISUAL order**: left to right on the page, so the end of the Arabic sentence comes first.
2. **Mostly one glyph per item**, and Chrome's word spaces are separate `" "` items.
3. **Inside an item, pdfjs has already put the text in logical order** (`زام` is the end of "التزام", read correctly). Only the ORDER OF ITEMS is visual.

`pdf-text.worker.mjs` keeps the stream order and puts a space after every item. That produces the reversed, letter-spaced text above.

**What is NOT affected.**
- **English PDFs:** they are read correctly today.
- **Word's Arabic PDFs:** read correctly too. Word stores the text in logical order, as whole words, with x DECREASING along a right-to-left line, and no space items (dump of `word-mixed.pdf`: `تطبق` at x 518.9, `السياسة` at 485.0, `IPC-07` at 444.2, …).

The fix must leave both exactly as they are (§4).

---

## 2. The fix (point 1)

### 2.1 Where it runs

**The worker sends each page's ITEMS, and a new TypeScript function builds the page's text** (`extract/pdf-page-text.ts`, `pageText(items)`).

- The worker posts `{ type: 'page', n, items }`. Each item is `{ s, rtl, x, y, w, size, eol }`, taken from pdfjs's `str`, `dir`, `transform` and `width`.
- `PdfTextExtractor` calls `opts.onPage(n, pageText(items))`.
- **`onPage`'s contract is unchanged**, so `file-text.ts` and everything above it are untouched.

**Why not inside the worker.** The worker is plain `.mjs`, which the backend's Jest cannot import (ACC-193). Logic left there could only be tested through a real worker, one fixture at a time.

As TypeScript, the ordering is:
- typed;
- linted;
- unit-tested with hand-built item lists, for the cases no fixture can pin cheaply;
- still tested end to end on the real PDFs through the real worker.

**Cost on the main thread, measured:**
- 0.65 ms per page for a dense Chrome Arabic page (588 items);
- 0.03 ms for an English page;
- the 100-page cap is therefore about 65 ms, spread across the page messages.

The PDF parse, which is the expensive part, stays in the worker.

### 2.2 Which lines are touched

A page is cut into lines where pdfjs marks an end of line (`hasEOL`), as today. There is one extra rule: a jump in baseline of more than half the font size also starts a new line. This is a safety net; every fixture already marks its line ends.

**A line is reordered only when BOTH hold:**
- it contains right-to-left letters (Arabic or Hebrew blocks, presentation forms included); and
- **its right-to-left items run rightwards:** among consecutive right-to-left items in stream order, more steps go to a larger x than to a smaller one.

| Source | What its right-to-left items do | Result |
|---|---|---|
| Chrome | run rightwards (visual order) | reordered |
| Word | run leftwards (logical order) | untouched |
| An Arabic line pdfjs returns as a single item | has no pairs to compare | untouched — pdfjs already ordered it |
| Every line with no right-to-left letters, i.e. every English line | not considered | untouched |

**Every line that is not reordered is produced by the SAME expression as today:** each item's text, then `'\n'` after an end-of-line item and `' '` after any other. So "exactly as today" is a property of the code path, not a hope, and §4's parity tests pin it.

### 2.3 How a reordered line is rebuilt

1. **Marks.** An item made only of combining marks attaches to the item it sits over. Chrome draws tanween as its own zero-width item, e.g. `" ً"` over the alef of "يوماً". It attaches to the item whose span contains its x, or to the nearest item.
2. **Visual string.** Items are sorted by x (left edge), and each is put back into its visual form:
   - a right-to-left item is passed through the bidi algorithm with a right-to-left base (logical → visual). This is NOT a plain string reversal, because pdfjs keeps digits in reading order inside a right-to-left item: `١٤٤٧` is one `rtl` item, and reversing it gave `٧٤٤١` in the first prototype;
   - left-to-right items stay as they are.
3. **Word spaces** come from two signals, either of which is enough:
   - a whitespace item (Chrome's `" "`);
   - a horizontal gap between two items wider than **0.15 em** (the larger of the two items' font sizes).

   Measured on all three Chrome Arabic files:
   - between glyphs of one word, 0.000–0.001 em;
   - across a word space, 0.278 em, which is Arial's space.

   0.15 em sits in the middle, with a wide margin either side. With every space item removed, the gap rule alone produced byte-identical text on all three files, so a generator that leaves out space items is covered too.
4. **Reorder** the visual string to logical order with the Unicode Bidirectional Algorithm (§3).
5. **Fold presentation forms.** `normalizeText()` already applies NFKC to every PDF (ACC-193). It now works on text in the right order, which it never had before. **Q1** asks about four codepoints NFKC folds to Persian letters rather than Arabic ones.

---

## 3. Mixed lines (point 2)

Latin words, numbers and codes inside an Arabic line must keep their own reading order. **The rule cannot be "reverse the line, then reverse each left-to-right item back".** It gets numbers wrong:

| Visual on the page | Correct reading | A plain item-level rule gives |
|---|---|---|
| `%` left of `95`, in an Arabic sentence | `95%` | `%95` |

Under the Unicode bidi rules:
- a number that follows Arabic letters is an Arabic number;
- the `%` beside it is then NOT part of the number, so it stays with the right-to-left text.

**The reorder is therefore the full Unicode Bidirectional Algorithm (UAX #9)** applied to the line's visual string: weak types (W1–W7), neutrals (N1–N2), levels (I1–I2), then reversal by level (L2). **Q2** asks which implementation to use.

What it produced on real Chrome output:

| On the page | Read as |
|---|---|
| `IPC-07` | `IPC-07` |
| `2026،` | `2026،` |
| `95%` | `95%` |
| `Hand Hygiene Audit` | `Hand Hygiene Audit` |
| `12/10/2026` | `12/10/2026` |
| `١٤٤٧` (Arabic-Indic digits) | `١٤٤٧` |
| `3.5` | `3.5` |
| `(IPC)` | `(IPC)` — brackets on the right sides |
| `ICU-2` | `ICU-2` |
| `4B` | `4B` |
| an English sentence quoting `الجناح الشرقي` | the English in order, the Arabic phrase reading correctly |

**The base direction of a reordered line** decides where its Latin runs sit. It is taken in this order:
1. the majority of the line's letters, right-to-left against all others;
2. on a tie, the majority across the whole page;
3. on a page tie, right-to-left.

An Arabic paragraph's lines are right-to-left. An English sentence quoting Arabic stays left-to-right, and only its Arabic run is reordered: "The ward is called الجناح الشرقي and its code is E-4."

**Known limit:** a very short wrapped fragment whose letters are mostly Latin, inside an Arabic paragraph (say a line holding only "في ICU-2"), takes a left-to-right base and puts its two parts in the wrong order. The words themselves stay correct. The page majority cannot help, because the line itself has a majority. This was judged rarer and cheaper than the alternative (guessing from line alignment), and is recorded rather than solved.

---

## 4. No harm to correct files (point 3)

**The guarantee:** a line goes through the new code only if it has right-to-left letters AND they run rightwards (§2.2). Everything else uses today's expression unchanged.

**Proved three ways:**

1. **Parity tests on real PDFs.** For the Word Arabic, Word mixed and English fixtures, and for the existing generated English fixtures (`pdf-fixture.ts`), the test computes TODAY's text with today's join, written out in the spec as the reference, and asserts the new text is identical character for character.
2. **Measured now with the prototype.** Identical on: `word-ar.pdf`, `word-mixed.pdf`, `chrome-en.pdf`, and the ACC-193 live `hand-hygiene-policy-en.pdf` (1,166 characters, both ways).
3. **The existing ACC-193 specs** (`pdf-text-extractor.spec.ts` and `file-text.spec.ts`) keep their exact expected strings, unedited.

**Word's own extraction quirks stay, by this requirement.** Word's ToUnicode data produces:
- `األقسام` for "الأقسام";
- `االلتزام` for "الالتزام";
- a dropped tanween ("شهريا");
- a space before the full stop.

These are as today, and out of scope here. They are **ACC-225**, which must fix the ligature at the glyph level (a text swap would break real words such as ألم). The model reads them.

---

## 5. Test fixtures and their extracted text (point 4)

All are real PDFs from real generators, made on this machine and committed under `extract/fixtures/` with a `README.md`. The README holds the HTML sources, the Chrome command, and the Word COM script, so anyone can regenerate them. There is no LibreOffice on this machine; **Word is the logical-order generator**, which point 4 allows ("Word-or-LibreOffice").

| Fixture | Made by | Size |
|---|---|---|
| `chrome-ar.pdf` | Chrome 153 headless `--print-to-pdf`, Arial | 22 KB |
| `word-ar.pdf` | Word 16 `ExportAsFixedFormat`, RTL paragraphs, Arial | 52 KB |
| `chrome-mixed.pdf` | Chrome, Arabic with a code, a year, a percentage and a Latin phrase | 30 KB |
| `word-mixed.pdf` | Word, the same two lines | 61 KB |
| `chrome-hard.pdf` | Chrome: a date, Arabic-Indic digits, a decimal, a code in brackets, a wrapped paragraph, and an English line quoting Arabic | 36 KB |
| `chrome-en.pdf` | Chrome, English with a code and numbers | 28 KB |

Below, **today** and **new** are what the model would receive: `[page n]` plus `normalizeText()`, exactly as `readFileText()` builds it. Persian forms are shown as NFKC leaves them; Q1's fold would change ی → ي and ھ → ه.

### `chrome-ar.pdf` — Chrome, Arabic

Today:
```
( ر ا ب ت خ ا ة ق ی ث و ) ن ی د ی ل ا ة ف ا ظ ن ة س ا ی س
دوى. ع ل ن ا م د ح ل ل ة ی ر ی ر س ل م ا ا س ق لأ ا ع ی م ج ي ف ن ی د ی ل ا ة ف ا ظ ن د ع وا ق ة س ا ی س ل ذه ا ھ دد ح ت
ح. ا ن ج ل ك ي ف ً ا ی ر ھ ش زام ت ل لا دوى ا ع ل ا ة ح ف ا ك م ق ی ر ف ق ق د ی
```
New:
```
سیاسة نظافة الیدین (وثیقة اختبار)
تحدد ھذه السیاسة قواعد نظافة الیدین في جمیع الأقسام السریریة للحد من العدوى.
یدقق فریق مكافحة العدوى الالتزام شھریاً في كل جناح.
```

### `word-ar.pdf` — Word, Arabic (identical to today)
```
سياسة نظافة اليدين ( وثيقة اختبار )
تحدد هذه السياسة قواعد نظافة اليدين في جميع األقسام السريرية للحد من العدوى .
يدقق فريق مكافحة العدوى االلتزام شهريا في كل جناح .
```

### `chrome-mixed.pdf` — Chrome, a mixed Arabic/English line with a code and numbers

Today:
```
ح. ا ن ج ل ك ي ف % 95 ة ب س ن ب زام ت ل دف ا ھ ل ، وا 2026 م ا ع ذ ن م IPC-07 ة س ا ی س ل ا ق ب ط ت
. ق ی ق د ت ل ن ا م ً ا م و ی 14 ل ب ق Hand Hygiene Audit ل ی ل د ع ج را
```
New:
```
تطبق السیاسة IPC-07 منذ عام 2026، والھدف التزام بنسبة 95% في كل جناح.
راجع دلیل Hand Hygiene Audit قبل 14 یوماً من التدقیق.
```

### `word-mixed.pdf` — Word, the same lines (identical to today)
```
تطبق السياسة IPC-07 منذ عام 2026 ، والهدف التزام بنسبة 95 % في كل جناح .
راجع دليل Hand Hygiene Audit قبل 14 يوما من التدقيق .
```

### `chrome-hard.pdf` — Chrome, the hard cases

Today:
```
ل. ی ل د ل ن ا م 3.5 ة خ س ن ل وا ( IPC ) ا ھ ز م ور ١٤٤٧ م ق ر ب 12/10/2026 ي ف درت ص
ة ی ا ھ ن ل ب ق دوى ع ل ا ة ح ف ا ك م ة ن ج ل ى ل ر إ ی ر ق ت ل ا ع ف ر ی وع، و ب س ل أ ك ICU-2 ة ق ط ن م و 4B ح ا ن ج ي ف ق ی ق د ت ل ل ا ص وا ت ی
ل. ق لأ ا ى ل ع وات ن س 10 دة م ل ودة ج ل ل ا ج س ي ف خ س ن ل ا ى ق ب ت ر، و ھ ش ل ا
The ward is called ي ق ر ش ل ح ا ا ن ج ل ا and its code is E-4.
```
New:
```
صدرت في 12/10/2026 برقم ١٤٤٧ ورمزھا (IPC) والنسخة 3.5 من الدلیل.
یتواصل التدقیق في جناح 4B ومنطقة ICU-2 كل أسبوع، ویرفع التقریر إلى لجنة مكافحة العدوى قبل نھایة
الشھر، وتبقى النسخ في سجل الجودة لمدة 10 سنوات على الأقل.
The ward is called الجناح الشرقي and its code is E-4.
```

### `chrome-en.pdf` — Chrome, English (identical to today)
```
Hand Hygiene Policy IPC-07 (test document)
Staff clean their hands at the five moments. The target is 95% compliance in 2026.
Wards below 80% for two months submit a corrective action plan within 14 days.
```

### The ACC-193 live file, `hand-hygiene-policy-ar.pdf` (for comparison only; not committed)

Today it is 1,136 characters of reversed, letter-spaced text. New, 717 characters:
```
سیاسة نظافة الیدین (وثیقة اختبار)
الغرض: تحدد ھذه السیاسة قواعد نظافة الیدین في جمیع الأقسام السریریة في المستشفى للحد من العدوى
المرتبطة بالرعایة الصحیة.
النطاق: تنطبق على جمیع الموظفین والطلاب والمقاولین الذین یلمسون المرضى أو بیئتھم في كل جناح
وعیادة خارجیة.
القواعد: ینظف الموظفون أیدیھم بالمعقم الكحولي أو بالماء والصابون في اللحظات الخمس: قبل لمس
المریض، وقبل أي إجراء نظیف أو معقم، وبعد خطر التعرض لسوائل الجسم، وبعد لمس المریض، وبعد
لمس محیط المریض.
المتابعة: یدقق فریق مكافحة العدوى الالتزام بنظافة الیدین شھریاً في كل جناح، والھدف ھو التزام بنسبة
تسعین بالمئة. وعلى الأجنحة التي یقل التزامھا عن ثمانین بالمئة لشھرین متتالیین أن تقدم خطة إجراءات
تصحیحیة إلى لجنة مكافحة العدوى خلال أربعة عشر یوماً.
```

**These strings become the specs' expected values**, asserted through the real worker, alongside the generated fixtures already there.

---

## 6. Two small fixes (point 5)

### 6.1 A key point is cut at a boundary, never mid-content

**The defect.** `trimTo()` cuts at a sentence end only when one falls past half the cap. Otherwise it cuts at the character limit and appends "…", which can split a word. In the live proof, the English summary's point on the five moments was cut at 200 characters: "…after touching a patient, and…". The whole point measured about 245 characters, and the clause it lost was "after touching patient surroundings".

**The fix:**
- **`POINT_CAP` 200 → 300.** That fits the real point with room to spare; the prompt still asks for "one short line".
- **The cut rule, for points AND the overview (800, unchanged):**
  - at the last sentence end past half the cap;
  - else at the last space past half the cap, with "…";
  - only a single unbroken run longer than half the cap is cut hard, with "…".

  So a word is never split.

### 6.2 "1 page", not "1 pages"

The AI log's description becomes `StoredFile <id> summary · 1 page` (and `· 12 pages`, `· 1 row`, `· 24 rows`, `· 1 byte`, `· 378 bytes`).

This is a small `unitCount()` helper in `summary-answer.ts`. It is English on purpose, because the log is for operators.

---

## 7. Files changed

| File | Change |
|---|---|
| `extract/pdf-text.worker.mjs` | posts `items` per page instead of `text`; filtering of non-text items as today |
| `extract/pdf-page-text.ts` (new) | `pageText(items)`, the line rules of §2–§3, constants `WORD_GAP_EM = 0.15` |
| `extract/pdf-text-extractor.ts` | passes `pageText(message.items)` to `onPage`; the message type |
| `extract/fixtures/*.pdf` + `README.md` (new) | the six fixtures of §5 and how to regenerate them |
| `summary-answer.ts` | `POINT_CAP` 300, the boundary cut, `unitCount()` |
| `ai-file-summary.service.ts` | the description uses `unitCount()` |
| specs | §8 |
| `package.json` / `package-lock.json` | `bidi-js` at an exact version, if Q2 is answered as recommended; **the lockfile regenerated on Linux (WSL)** as ACC-193 requires |
| `SYSTEM-REFERENCE.md` §17.9 | the PDF bullet (line order) and the caps (6 × 300) |
| `CLAUDE.md` | one bullet under ACC-193's decisions (visual-order lines are reordered; every other line is as before) |

---

## 8. Tests, and the mutation checks

### `pdf-page-text.spec.ts` (new) — hand-built item lists
- A visual-order Arabic line becomes logical, with spaces from space items.
- The same line with every space item removed gives the same text: the gap rule.
- A gap of 0.1 em is not a space; one of 0.2 em is.
- `%` + `95` after Arabic gives `95%`; `IPC-07`, `12/10/2026` and `١٤٤٧` stay in order.
- A tanween-only item attaches to its base letter.
- An English line, and an Arabic line in logical order, are byte-identical to today's join.
- An English line quoting a visual-order Arabic phrase keeps a left-to-right base.
- The base direction falls back to the page's majority on a tie.

### `pdf-arabic-order.spec.ts` (new) — the real fixtures, through the real worker and `readFileText()`
- Each Chrome fixture equals its §5 "new" text.
- Each Word and English fixture equals today's text, computed in the spec by today's join.

### Existing specs
- `pdf-text-extractor.spec.ts` and `file-text.spec.ts` pass with their expected strings unedited.
- The parity test of §4.1 covers the generated `pdf-fixture.ts` PDFs.

### `summary-answer.spec.ts`
- A 245-character point is kept whole.
- A 320-character point is cut at a word boundary, with "…".
- A point with a sentence end past half the cap is cut there.
- No cut point ends inside a word.

### `ai-file-summary.service.spec.ts`
- The description says `· 1 page` for one page and `· 2 pages` for two.

### Mutations — each must turn a named test red, and is then reverted
1. Reverse a right-to-left item with a plain string reversal instead of the bidi call → `١٤٤٧` comes out `٧٤٤١`.
2. Replace the bidi reorder with "reverse the line, re-reverse left-to-right items" → `95%` comes out `%95`.
3. Drop the "runs rightwards" check → the Word fixtures stop matching today.
4. `WORD_GAP_EM` set to 0.5 → the gap test, and the no-space-items case, fail.
5. `WORD_GAP_EM` set to 0 → spaces appear inside words.
6. Drop the mark attachment → "یوماً" loses its tanween's place.
7. `POINT_CAP` back to 200 → the 245-character point test fails.
8. `unitCount()` always plural → the "1 page" test fails.

### Checks before stopping
- Backend lint (changed files);
- `tsc --noEmit`;
- the full Jest suite;
- the tenant-isolation pattern;
- `npm run test:db`;
- every discovered `check:*` script, reported by name.

There is no frontend change, so the frontend suite is not part of this ticket's gate. `/ready-to-pr` runs it anyway.

---

## 9. The live re-test after merge (point 6)

1. **Deploy:** `/api/v1/health` 200 on the merge commit, Vercel green, and no worker or bidi error in the Railway log.
2. **Upload and summarise:** on al-nakheel, signed in page-side, upload the SAME `hand-hygiene-policy-ar.pdf` used on 13 Oct to a test task and summarise it in Arabic.
3. **Report:**
   - the **input token count from the AI log, compared with 13 Oct's 1,331**. Expectation, not a promise: well under 1,000, since the text the model reads drops from 1,136 to 717 characters, and the fixed overhead (system prompt and framing) is about 370 tokens;
   - credits used (15), one text-free log row, one audit row with no text;
   - the **Arabic overview quoted** in full.
4. **Quote the description line**, which now reads "· 1 page".
5. **Clean up** as Ahmad directs: delete the test file. The credits the proof used stay used: a live proof never hand-writes a credit counter (ACC-236).

---

## 10. Done in this prompt: the recycle bin

Signed in page-side on the live site as Hessa (al-nakheel, Organization Administrator). The four ACC-193 test files deleted at clean-up were purged through `POST /tenant/recycle-bin/purge` → **200, `purged: 4`**:
- `hand-hygiene-policy-ar.pdf`
- `scanned-audit-form.pdf`
- `ward-6a-notes.txt`
- `hand-hygiene-q3.csv`

The database (read-only check) shows all four with `purgedAt` 13:21:16 UTC. **`AiFileSummary` rows: 0 in al-nakheel, 0 in every organisation.** al-nakheel's credits were not touched (2,000 allocated, 0 used). Signed out (`/auth/me` → 401).

**The fifth ACC-193 test file**, `hand-hygiene-policy-en.pdf` (deleted during the proof itself), was purged afterwards on Ahmad's instruction, the same way: **200, `purged: 1`**, then signed out. No ACC-193 test file remains in the bin. The bin's three older files (`WhatsApp Image …jpeg`, `MOHE.pdf`, `Student.docx`) are not ours and were not touched.

---

## 11. Questions for Ahmad — answered 13 Oct: Q1, Q2 and Q3 as recommended

**Q1 — Chrome's Persian letter forms.** Chrome's PDFs map the yeh and heh glyphs to Persian presentation forms: U+FBFE yeh initial, ×42 in the live file, and U+FBAD / U+06BE heh. NFKC turns these into **ی** (U+06CC) and **ھ** (U+06BE), so the model reads "سیاسة" rather than "سياسة". The glyphs are drawn identically; only the codepoint differs. The model understood it on 13 Oct.
- **Recommended: fold them to Arabic, in REORDERED lines only.** U+FBFE / U+FBFF → ي, and U+FBAC / U+FBAD / U+06BE → ه, before NFKC.
  - The text then matches what was typed, and tokenises as ordinary Arabic.
  - The cost is that genuine Persian or Urdu in a Chrome-made PDF loses those two distinctions, which is rare for this market and still readable.
  - Word, English and every untouched line stay exactly as today.
- **Or:** leave them as NFKC gives them.

**Q2 — Which bidi implementation.**
- **Recommended: `bidi-js` 1.1.0**, pinned exactly.
  - MIT, a complete UAX #9 implementation validated against Unicode's own conformance tests, pure JavaScript.
  - Its one declared dependency, `require-from-string` (MIT), is installed but never loaded: its built files contain no `require()`, checked.
  - The lockfile is regenerated on Linux (WSL), as ACC-193 requires.
- **Or:** hand-write the subset we need (no embeddings or isolates, one paragraph: W1–W7, N1–N2, I1–I2, L2), about 150 lines plus its own tests. That means no dependency, but we would own the correctness of rules Unicode already tests, for the cases our fixtures do not cover.

**Q3 — The key-point cap.** **Recommended: 300** (§6.1). Or keep 200 and rely on the boundary cut alone; the 13 Oct point would then still lose its last clause, cleanly.

---

## 12. Progress

- [x] Ahmad approves the plan (Q1–Q3, as recommended; 13 Oct)
- [x] Follow-up ticket for Word's ligature, tanween and punctuation quirks: **ACC-225** (lane B, Medium, Bug), not built here
- [x] `bidi-js` 1.1.0 added, exact; lockfile regenerated with npm in WSL (one new entry; `require-from-string` was already in the tree)
- [x] Fixtures committed with their README (`extract/fixtures/`)
- [x] Worker posts items; `pdf-page-text.ts`; extractor wired
- [x] Persian-form fold (Q1)
- [x] `POINT_CAP` 300, boundary cut, `unitCount()`
- [x] Specs (§8); mutations seen red, then reverted (§13)
- [x] Lint (added lines), typecheck, Jest, isolation, `test:db`, `check:*` — all green (§13)
- [x] Post-build: the built extractor reads every fixture through the worker shipped in `dist/` (§13)
- [x] SYSTEM-REFERENCE §17.9 and CLAUDE.md
- [x] Stopped before pushing; Ahmad ran `/ready-to-pr` (13 Oct): both typechecks and `ng build` clean, backend 3,329 and frontend 1,596 tests, isolation 187, all 14 `check:*` scans exit 0
- [ ] After merge: the live re-test (§9)

---

## 13. Built — results, and where it differs from the plan

**Results (13 Oct, on `fix/ACC-224-arabic-pdf-order`):**
- **Typecheck:** clean.
- **Jest:** 156 suites, 3,329 tests, all passing.
- **Tenant isolation pattern:** 187 passing.
- **`test:db`:** 4 suites, 24 tests, against the local throwaway Postgres.
- **Every discovered `check:*` script** exits 0: 2 backend, 12 frontend.
- **Lint:** no problems on any line this branch added (8 files), prettier off. CI does not lint, and the repo is not prettier-clean.
- **Post-build:** `nest build`, then the BUILT extractor read all six fixtures and both 13 Oct live files through `dist/…/pdf-text.worker.mjs`. Only that worker shipped (no fixture worker), `bidi-js` resolves from `dist/`, and no worker was left running.

**Mutations, each red and naming its test, then reverted:**
1. plain reversal of an rtl item;
2. "reverse the line, re-reverse Latin runs";
3. no "runs rightwards" check;
4. `WORD_GAP_EM` 0.5;
5. `WORD_GAP_EM` 0;
6. no mark attachment;
7. `POINT_CAP` 200;
8. `unitCount()` always plural;
9. no Persian fold (added).

**Differences from the plan:**
- **A surrogate-pair repair was written and then REMOVED.** Mutating it changed nothing: `bidi-js` keeps a pair together when it reverses a run (checked directly). The emoji spec stays, as a guard across upgrades.
- **The "today" reference is a test worker**, `legacy-join.fixture.mjs`. It holds the pre-ACC-224 join verbatim and sends each page as ONE stored item, so the parity test compares the new raw text plus one space against it. It is not shipped (`*.fixture.mjs`).
- **The known limit of §3 is pinned by a test** ("ICU-2 ward في"), so a change to it is seen.
- **The cut also ends a sentence at "? "**, and drops a trailing comma (`,` `،` `;` `؛` `:`) before "…".
- **A first full Jest run failed on resources, not code**: a Jest worker out of memory, `ENOBUFS`, and a segfault in `better-auth.config.spec.ts`. The segfault came from an `npm ci --ignore-scripts` used to install `bidi-js` locally, which skipped native install scripts. A normal `npm ci` fixed it, and the whole gate was re-run clean; the numbers above are from that run.
- **The model's text for the live Arabic file** is 716 characters (with `[page 1]`); §5 counted 717 before the fold.
