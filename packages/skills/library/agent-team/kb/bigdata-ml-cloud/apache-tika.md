---
kb_id: bigdata-ml-cloud/apache-tika
version: 1
tags:
  - bigdata-ml-cloud
  - apache-tika
  - content-extraction
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-tika"
  - "tika CHANGES.txt (github.com/apache/tika/blob/main/CHANGES.txt)"
related:
  - bigdata-ml-cloud/apache-lucene
status: active
---

## Summary

**Concept**: Apache Tika does content/media-type *detection* and text+metadata *extraction* from arbitrary documents — detection is content-based (not extension-based), then it auto-dispatches to the right parser.
**Key APIs**: detection via `DefaultDetector().detect(stream, metadata)` → `MediaType` or facade `new Tika().detect(stream)` → MIME string; extraction via `AutoDetectParser` + `BodyContentHandler` (a SAX `ContentHandler`) + `ParseContext`, or facade `tika.parseToString`.
**Gotcha**: callers must `stream.close()` themselves (Tika won't); detection is content-sniffing, so a mislabeled extension is correctly ignored.
**2026-currency**: Tika 2.0 (2021) split the monolithic `tika-parsers`; 3.x continued — HTML parsing moved TagSoup→JSoup, Xerces2 removed, a gRPC server added, `tika-core` stays parser-free. Corpus's 1.17 is two majors behind.
**Sources**: Baeldung `apache-tika` module; Tika CHANGES.txt.

## Quick Reference

**Two operations, two API tiers** (low-level vs facade):

**Detection** (content-based MIME identification):
- Low-level: `MediaType type = new DefaultDetector().detect(stream, metadata)`
- Facade: `String mime = new Tika().detect(stream)`
- Key property: detection inspects content/magic bytes, **not** the file extension.

**Extraction** (text + metadata):
- Low-level: `AutoDetectParser` + `BodyContentHandler` (a SAX `ContentHandler`) + `ParseContext` + `Metadata`; call `parser.parse(stream, handler, metadata, context)`
- Facade: `String text = new Tika().parseToString(stream)`

**The auto-detect flow**: `AutoDetectParser` first detects the format, then dispatches to the matching concrete parser (PDF, DOCX, HTML, image, etc.) — one entry point covers all supported types.

**Top gotchas**:
- Tika does not close the input stream — the caller must `stream.close()` itself.
- A wrong/spoofed file extension does not fool detection (content-sniffing).

**Current (mid-2026)**: The modular split is real. **Tika 2.0.0 (July 2021)** broke up the monolithic `tika-parsers`, and **3.0** continued it: HTML parsing migrated TagSoup→JSoup, Xerces2 was removed, a gRPC server was added, and `tika-core` stays parser-free. The corpus's Tika 1.17 (monolithic `tika-parsers`) is two majors behind — depend on the modular parser packages on 2.x/3.x.

## Full content

Apache Tika is a content-detection-and-extraction library: given an arbitrary document (or byte stream), it identifies the media type and pulls out plain text plus metadata. The Baeldung `apache-tika` module demonstrates both capabilities at two API tiers — a low-level explicit form and a high-level facade — which is itself the teaching point (the facade is convenience over the same machinery).

**Detection** answers "what is this?" The low-level path uses `new DefaultDetector().detect(stream, metadata)` returning a `MediaType`; the facade collapses it to `new Tika().detect(stream)` returning a MIME string. The load-bearing property is that detection is **content-based, not extension-based** — Tika sniffs magic bytes and structure, so a `.txt` file that is really a PDF is correctly identified as PDF.

**Extraction** answers "what does it say?" The low-level path wires an `AutoDetectParser` to a `BodyContentHandler` (which is a SAX `ContentHandler`) with a `ParseContext` and `Metadata`, calling `parse(...)`; the facade is `tika.parseToString(stream)`. The `AutoDetectParser` is the elegant core: it first detects the format and then dispatches to the appropriate concrete parser, so a single code path handles PDFs, Office documents, HTML, images, and more.

The chief gotcha is resource lifecycle — Tika does not own or close the input stream, so callers must close it themselves to avoid handle leaks. This pairs naturally with Lucene (sibling doc): Tika extracts text from documents, which then becomes the analyzed content Lucene indexes.

### 2026 currency

The modular split called out in the base is real and ongoing. **Tika 2.0.0 (July 2021)** split the monolithic `tika-parsers` into modular packages, and **3.0** continued the work: HTML parsing migrated from TagSoup to **JSoup**, **Xerces2 was removed**, a **gRPC server** was added, and `tika-core` remains parser-free ([tika CHANGES.txt (apache/tika)](https://github.com/apache/tika/blob/main/CHANGES.txt) · [Apache Tika (Wikipedia)](https://en.wikipedia.org/wiki/Apache_Tika)). The corpus's Tika 1.17 (with the monolithic `tika-parsers` dependency) is two majors behind — modern integrations depend on the specific modular parser packages they need rather than the old umbrella artifact. The detector/parser facade *concepts* are unchanged; only the dependency coordinates moved.
