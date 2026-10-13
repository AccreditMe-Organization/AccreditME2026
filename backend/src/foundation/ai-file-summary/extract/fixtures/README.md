# PDF text fixtures (ACC-224)

These are real PDFs from real generators. The specs assert the text the model receives from each one (`pdf-arabic-order.spec.ts`), so do not regenerate them casually. A new Chrome or Word version may lay text out differently, and every expected string would then need re-reading by a person, not just re-pasting.

| File | Made by | What it pins |
|---|---|---|
| `chrome-ar.pdf` | Chrome 153, headless print | Arabic stored in VISUAL order, one glyph per item: reordered |
| `chrome-mixed.pdf` | Chrome 153 | a code, a year, a percentage and a Latin phrase inside Arabic lines |
| `chrome-hard.pdf` | Chrome 153 | a date, Arabic-Indic digits, a decimal, a code in brackets, a wrapped paragraph, and an English line quoting Arabic |
| `chrome-en.pdf` | Chrome 153 | English: exactly as before ACC-224 |
| `word-ar.pdf` | Word 16 (Microsoft 365), Export as PDF | Arabic stored in LOGICAL order: exactly as before ACC-224 |
| `word-mixed.pdf` | Word 16 | the mixed lines, in logical order: exactly as before ACC-224 |

Word's own text-layer quirks are kept on purpose, because ACC-224 leaves logical-order files untouched. They are `األقسام` for "الأقسام", a dropped tanween, and a space before the full stop, and they are ACC-225's.

There is no LibreOffice on the machine that made these, so Word is the logical-order generator.

## Chrome

Each HTML file below was printed with:

```
chrome.exe --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=<out>.pdf file:///<path>/<name>.html
```

`chrome-ar.pdf` (from `ar.html`):

```html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ar</title>
<style>body{font-family:Arial,sans-serif;font-size:13pt;margin:2cm;line-height:1.7}</style></head><body>
<p>سياسة نظافة اليدين (وثيقة اختبار)</p>
<p>تحدد هذه السياسة قواعد نظافة اليدين في جميع الأقسام السريرية للحد من العدوى.</p>
<p>يدقق فريق مكافحة العدوى الالتزام شهرياً في كل جناح.</p>
</body></html>
```

`chrome-mixed.pdf` (from `mixed.html`):

```html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>mixed</title>
<style>body{font-family:Arial,sans-serif;font-size:13pt;margin:2cm;line-height:1.7}</style></head><body>
<p>تطبق السياسة IPC-07 منذ عام 2026، والهدف التزام بنسبة 95% في كل جناح.</p>
<p>راجع دليل Hand Hygiene Audit قبل 14 يوماً من التدقيق.</p>
</body></html>
```

`chrome-hard.pdf` (from `hard.html`):

```html
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>hard</title>
<style>body{font-family:Arial,sans-serif;font-size:13pt;margin:2cm;line-height:1.7}p.en{direction:ltr;text-align:left}</style></head><body>
<p>صدرت في 12/10/2026 برقم ١٤٤٧ ورمزها (IPC) والنسخة 3.5 من الدليل.</p>
<p>يتواصل التدقيق في جناح 4B ومنطقة ICU-2 كل أسبوع، ويرفع التقرير إلى لجنة مكافحة العدوى قبل نهاية الشهر، وتبقى النسخ في سجل الجودة لمدة 10 سنوات على الأقل.</p>
<p class="en">The ward is called الجناح الشرقي and its code is E-4.</p>
</body></html>
```

`chrome-en.pdf` (from `en.html`):

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>en</title>
<style>body{font-family:Arial,sans-serif;font-size:12pt;margin:2cm;line-height:1.6}</style></head><body>
<p>Hand Hygiene Policy IPC-07 (test document)</p>
<p>Staff clean their hands at the five moments. The target is 95% compliance in 2026.</p>
<p>Wards below 80% for two months submit a corrective action plan within 14 days.</p>
</body></html>
```

## Word

PowerShell, Word's COM automation. `$D` is the output folder.

```powershell
$sets = @{
  'word-ar' = @('سياسة نظافة اليدين (وثيقة اختبار)','تحدد هذه السياسة قواعد نظافة اليدين في جميع الأقسام السريرية للحد من العدوى.','يدقق فريق مكافحة العدوى الالتزام شهرياً في كل جناح.');
  'word-mixed' = @('تطبق السياسة IPC-07 منذ عام 2026، والهدف التزام بنسبة 95% في كل جناح.','راجع دليل Hand Hygiene Audit قبل 14 يوماً من التدقيق.')
}
$w = New-Object -ComObject Word.Application
$w.Visible = $false
try {
  foreach ($name in $sets.Keys) {
    $doc = $w.Documents.Add()
    $first = $true
    foreach ($line in $sets[$name]) {
      if (-not $first) { $doc.Content.InsertParagraphAfter() }
      $doc.Content.InsertAfter($line)
      $first = $false
    }
    $doc.Content.Font.Name = 'Arial'
    $doc.Content.Font.NameBi = 'Arial'
    $doc.Content.Font.SizeBi = 13
    $doc.Content.ParagraphFormat.ReadingOrder = 0   # right to left
    $doc.Content.ParagraphFormat.Alignment = 2      # right
    $doc.Content.LanguageID = 1025                  # Arabic (Saudi Arabia)
    $doc.ExportAsFixedFormat("$D\$name.pdf", 17)    # PDF
    $doc.Close([ref]0)
  }
} finally { $w.Quit() }
```
