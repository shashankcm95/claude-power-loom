---
kb_id: java-libraries/document-generation
version: 1
tags:
  - java-libraries
  - document-generation
  - pdf
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-poi, pdf, libraries-2 (jasper), apache-velocity"
  - "iText Core 9.1.0 release notes (kb.itextpdf.com) + POI Cell API 5.x docs (poi.apache.org)"
related:
  - java-libraries/commons-io-lang
status: active
---

## Summary

**Concept**: document + report generation — Apache POI (MS Office: Word/Excel/PowerPoint, pure-Java), PDF libraries (PDFBox/iText/Flying Saucer+Thymeleaf/pdf2dom), and report engines (JasperReports, Handlebars, Velocity, Rome feeds).
**Key APIs**: POI `XWPFDocument`/`Workbook`/`Sheet`/`Cell`/`CellType`/`FormulaEvaluator`; PDFBox `PDDocument`/`PDFTextStripper`/`PDFRenderer`; iText 5 `Document`/`PdfWriter`/`PdfPTable`; Flying Saucer `ITextRenderer`; JasperReports `.jrxml`→`fillReport`.
**Gotcha**: POI `getCellTypeEnum()` removed in 5.x (use `getCellType()`) — the 4.1.1 `ExcelPOIHelper` won't compile; iText 5 is EOL + AGPL/commercial (licensing landmine); formula read branches on cached (`getCachedFormulaResultType`) vs live (`evaluateFormulaCell`); SXSSF streaming is the prod answer for large sheets (absent from base).
**2026-currency**: POI 5.5.1 (`getCellType()`, SXSSF); PDFBox 3.0.7; iText Core 9.x (HTML→PDF is pdfHTML, replacing removed iText-5 xmlworker).
**Sources**: Baeldung `apache-poi`/`pdf`/`libraries-2`/`apache-velocity` modules.

## Quick Reference

**Apache POI (MS Office, pure-Java):**

```java
// Excel SS interfaces + XSSF concretes
Workbook wb = new XSSFWorkbook();  Sheet s = wb.createSheet();  Row r = s.createRow(0);
Cell c = r.createCell(0);  // CellStyle / DataFormatter / FormulaEvaluator
// formula read — branch on CellType.FORMULA:
cell.getCachedFormulaResultType();          // last cached
evaluator.evaluateFormulaCell(cell);        // live recompute
```
- Word **XWPF** (`XWPFDocument`/`Paragraph`/`Run`); PowerPoint **XSLF** (slides/layouts/placeholders).
- Merge `CellRangeAddress`; insert `shiftRows`.
- **SXSSF (streaming)** is the prod answer for large sheets (POI 5.x).

**PDF (multiple competing libs):**

| Library | Role |
|---|---|
| **Apache PDFBox** | `PDDocument`, `PDFTextStripper`, `PDFRenderer.renderImageWithDPI` |
| **iText 5** | `Document`/`PdfWriter`/`PdfPTable`/`PdfPCell`; `PdfReader` text extraction; `XMLWorkerHelper` HTML→PDF |
| **pdf2dom** | PDF → HTML |
| **Flying Saucer + Thymeleaf** | templated HTML → PDF via `ITextRenderer` (OpenPDF `com.lowagie.text` fork) |

PDF↔Base64 via `java.util.Base64` (direct/streaming-`wrap`) or Commons Codec.

**Reports / templating:** **JasperReports** (compile `.jrxml` → `fillReport` → export); **Spring Yarg/Haulmont** (DOCX/XLSX templates + JSON); **Handlebars.java** (logic-less, `compileInline`/partials/helpers); **Apache Velocity** (VTL, `VelocityViewServlet`); **Rome** (RSS/Atom, `SyndFeed`).

**Top gotchas:**

- POI `getCellTypeEnum()` **removed in 5.x** — use `getCellType()`; the base's POI 4.1.1 `ExcelPOIHelper` won't compile on 5.x.
- iText 5 is **EOL + AGPL/commercial** (licensing landmine); iText 7/8/9 has a different API.
- PDF examples write to a `src/output/` that doesn't exist (FileNotFoundException) — a path-fragility trap.

**Current (mid-2026):** **POI 5.5.1** (Nov 2025, bundles PDFBox 3.0.6, BouncyCastle 1.83); **PDFBox 3.0.7** (6 Mar 2026, reorganized packages); **iText Core 9.x** (9.3.0) — HTML→PDF is **pdfHTML** (replacing the removed iText-5 `xmlworker`).

## Full content

Document generation splits into MS Office (POI), PDF (a crowded field of competing libraries), and report/template engines. **Apache POI** is the pure-Java MS Office toolkit. Word uses the XWPF API (`XWPFDocument`/`Paragraph`/`Run` with alignment/fonts/images); Excel uses the spreadsheet (SS) interfaces (`Workbook`/`Sheet`/`Row`/`Cell`/`CellStyle`/`CellType`/`DataFormatter`/`FormulaEvaluator`) implemented by XSSF concretes; PowerPoint uses XSLF (slides/layouts/placeholders/tables). Reading is type-dispatched on `CellType`, and formulas have two read modes — the cached last result (`getCachedFormulaResultType`) or a live recompute (`evaluateFormulaCell`). Merging uses `CellRangeAddress` and insertion uses `shiftRows`. The base's notable gap is **SXSSF**, the streaming API that is the production answer for large spreadsheets (it appears in POI 5.x).

**PDF** has no single winner. **Apache PDFBox** handles low-level document manipulation, text extraction (`PDFTextStripper`), and rendering to images (`PDFRenderer.renderImageWithDPI`). **iText 5** offers a rich document model (`Document`/`PdfWriter`/`PdfPTable`/`PdfPCell` with `BaseColor`/alignment, `Image.getInstance(...).scalePercent(..)`), text-extraction strategies via `PdfReader`, and HTML→PDF via `XMLWorkerHelper`. **pdf2dom** goes the other way (PDF→HTML), and **Flying Saucer + Thymeleaf** render templated HTML to PDF through an `ITextRenderer` (built on the OpenPDF `com.lowagie.text` fork). PDF↔Base64 is shown three ways (direct, streaming `wrap`, Commons Codec).

The report/template engines round it out: **JasperReports** compiles a `.jrxml` design, fills it with data (`fillReport`), and exports; **Spring Yarg/Haulmont** fills DOCX/XLSX templates from JSON; **Handlebars.java** is logic-less templating (`compileInline`/`compile`, partials, helpers); **Apache Velocity** is the VTL engine (with a `VelocityViewServlet` and layout/decorator via `$screen_content`); and **Rome** generates RSS/Atom feeds (`SyndFeed`). A recurring fragility across the PDF/POI examples is path handling — several write to a non-existent `src/output/` directory or build paths via `.substring()` hacks.

### 2026 currency

- **POI 4.x → 5.x breaking change**: `getCellTypeEnum()` is **gone** — use `getCellType()` (returns the `CellType` enum). The base's POI 4.1.1 `ExcelPOIHelper` won't compile on 5.x. Current **POI 5.5.1** (Nov 2025) bundles BouncyCastle 1.83 and PDFBox 3.0.6, and supports **SXSSF streaming** throughout. [POI Cell API (5.x dev docs)](https://poi.apache.org/apidocs/dev/org/apache/poi/ss/usermodel/Cell.html)
- **Apache PDFBox 2.x → 3.x** reorganized packages/API; current **3.0.7** (6 Mar 2026, requires Java 8). [PDFBox download page](https://pdfbox.apache.org/download.html)
- **iText 5 (EOL + AGPL) → iText Core 9.x** (9.3.0, 2 Sep 2025), dual-licensed AGPLv3 + commercial; HTML→PDF is now **pdfHTML**, replacing the removed iText-5 `xmlworker`. The AGPL/commercial licensing is a real landmine for closed-source use. [iText Core 9.1.0 KB](https://kb.itextpdf.com/itext/release-itext-core-9-1), [iText AGPLv3 license](https://itextpdf.com/how-buy/AGPLv3-license)
- JExcel/jxl remains dead (use POI). POI/PDFBox/JasperReports concepts carry forward; bump pins.
