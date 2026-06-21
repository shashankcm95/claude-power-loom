---
kb_id: bigdata-ml-cloud/apache-lucene
version: 1
tags:
  - bigdata-ml-cloud
  - apache-lucene
  - full-text-search
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: lucene"
  - "System Requirements — Lucene 10.0.0 (lucene.apache.org/core/10_0_0/SYSTEM_REQUIREMENTS.html)"
related:
  - bigdata-ml-cloud/apache-tika
status: active
---

## Summary

**Concept**: Apache Lucene is the JVM full-text search library — an index/search lifecycle over `Document`s of typed `Field`s, with a rich query language and a pluggable analyzer pipeline (tokenizer + token filters).
**Key APIs**: `IndexWriter`+`IndexWriterConfig`, `Document`/`TextField`/`StringField`/`SortedDocValuesField`, `RAMDirectory` vs `FSDirectory.open(Path)`, `IndexSearcher`; `QueryParser`/`TermQuery`/`PrefixQuery`/`BooleanQuery`/`PhraseQuery`/`FuzzyQuery`/`WildcardQuery`; `StandardAnalyzer`, `CustomAnalyzer.builder()`, `PerFieldAnalyzerWrapper`.
**Gotcha**: re-creating + closing `IndexWriter` on every `indexDocument` call (it's meant to be long-lived/batched); `searchIndex` catches `IOException`/`ParseException` and returns `null` → caller NPEs.
**2026-currency**: Lucene 10.0.0 (Oct 2024) requires JDK 21+; `RAMDirectory` removed in 9.0 (`StandardFilter` already gone since 8.0), analyzer signatures changed — corpus's 7.4.0 won't compile on 8+.
**Sources**: Baeldung `lucene` module; Lucene 10.0.0 system requirements.

## Quick Reference

**Index/search lifecycle**:
- Build: `IndexWriter` + `IndexWriterConfig(analyzer)` write `Document`s composed of typed `Field`s.
- Search: open an `IndexReader` → `IndexSearcher` → run a `Query` → `TopDocs`/`ScoreDoc`.

**Field types**:
| Field | Behavior |
|---|---|
| `TextField` | analyzed + tokenized, searchable |
| `StringField` | verbatim, not tokenized (exact-match keys) |
| `SortedDocValuesField` | enables sorting |

**Directory**: in-memory `RAMDirectory` vs on-disk `FSDirectory.open(Path)`.

**Query types**:
- `QueryParser` (string syntax), `TermQuery` (single term), `PrefixQuery`, `WildcardQuery`
- `BooleanQuery` (`Builder` + `BooleanClause.Occur.MUST`)
- `PhraseQuery` (with slop), `FuzzyQuery` (edit-distance typo tolerance)
- Sort via `Sort` + `SortField`

**Analyzers** (tokenizer + chained token filters → `TokenStream`):
- Built-ins: `StandardAnalyzer`, `StopAnalyzer`, `SimpleAnalyzer`, `WhitespaceAnalyzer`, `KeywordAnalyzer`, `EnglishAnalyzer` (stemming)
- Custom: `CustomAnalyzer.builder().withTokenizer("standard").addTokenFilter("lowercase")...` (SPI names) OR subclass `Analyzer.createComponents`
- Per-field: `PerFieldAnalyzerWrapper`
- Token introspection: `CharTermAttribute` + `reset()`/`incrementToken()`

**Top gotchas**:
- The example re-creates and closes `IndexWriter` on *every* `indexDocument` call — the writer is meant to be long-lived and batched.
- `searchIndex`/`searchFiles` swallow `IOException`/`ParseException` and return `null` → callers NPE.

**Current (mid-2026)**: **Lucene 10.0.0 (Oct 14, 2024)** — first major in ~3 years — **requires JDK 21+**. The Java-21 floor let Lucene drop the old direct-byte-buffer directory (so `RAMDirectory` is removed, in 9.0), use `posix_madvise`, and lean on hardware-accelerated vector instructions. `StandardFilter` was removed earlier, in 8.0.0 (deprecated in 7.5.0); analyzer signatures changed — corpus's Lucene 7.4.0 (well behind) won't compile on 8+. Lucene 11 is slated to raise its minimum to Java 25.

## Full content

Apache Lucene is the JVM's foundational full-text search library; the Baeldung `lucene` module is the most code-complete single module in the domain, covering every query type, sort, delete, all analyzer variants, custom and per-field analysis, both FS and in-memory directories, with integration tests.

The core lifecycle has two halves. **Indexing**: an `IndexWriter` configured by an `IndexWriterConfig(analyzer)` writes `Document`s, each composed of typed `Field`s. The field type encodes the search semantics — `TextField` is analyzed and tokenized (the searchable case), `StringField` is stored verbatim and not tokenized (exact-match keys), and `SortedDocValuesField` enables sorting. The index lives either in memory (`RAMDirectory`) or on disk (`FSDirectory.open(Path)`).

**Searching**: open a reader and an `IndexSearcher`, then run a `Query`. Lucene's query vocabulary is broad: `QueryParser` for string syntax, `TermQuery` for a single term, `PrefixQuery`/`WildcardQuery` for partial matches, `BooleanQuery` (built with a `Builder` and `BooleanClause.Occur.MUST`/`SHOULD`/`MUST_NOT`), `PhraseQuery` with positional slop, and `FuzzyQuery` for edit-distance typo tolerance. Results can be ordered with `Sort` + `SortField`.

The **analyzer** is where Lucene's real depth lives: an analyzer is a tokenizer plus a chain of token filters producing a `TokenStream`. The built-ins span `StandardAnalyzer`, `StopAnalyzer`, `SimpleAnalyzer`, `WhitespaceAnalyzer`, `KeywordAnalyzer`, and `EnglishAnalyzer` (with stemming). Custom analyzers are built either declaratively via `CustomAnalyzer.builder()` (using SPI tokenizer/filter names) or by subclassing `Analyzer.createComponents`; `PerFieldAnalyzerWrapper` applies different analyzers per field. Tokens can be introspected directly through `CharTermAttribute` and the `reset()`/`incrementToken()` protocol.

Two resource-and-error gotchas recur: the demo re-creates and closes the `IndexWriter` on every single document write (defeating its long-lived, batched design), and the search helpers swallow `IOException`/`ParseException` to return `null`, setting up NPEs in callers.

### 2026 currency

**Lucene is at 10.x.** **Lucene 10.0.0 released Oct 14, 2024** — the first major in roughly three years — and **requires JDK 21+** ([System Requirements — Lucene 10.0.0 (lucene.apache.org)](https://lucene.apache.org/core/10_0_0/SYSTEM_REQUIREMENTS.html)). The Java-21 floor enabled Lucene to drop the old direct-byte-buffer directory, use `posix_madvise`, and exploit hardware-accelerated vector instructions, which confirms the base's "`RAMDirectory` removed / analyzer signatures changed" direction ([Lucene 9.0.0 migration guide](https://lucene.apache.org/core/9_0_0/MIGRATE.html)). The corpus's Lucene 7.4.0 is well behind and will not compile on later majors: `StandardFilter` was removed in 8.0.0 (deprecated in 7.5.0) ([Lucene 8.0.0 changelog, LUCENE-8356](https://lucene.apache.org/core/8_0_0/changes/Changes.html)), and `RAMDirectory` was removed in 9.0. Forward signal: **Lucene 11 is slated to raise its minimum to Java 25** ([Bump Lucene 11.0.0 minimum to Java 25 (apache/lucene#14229)](https://github.com/apache/lucene/issues/14229)). Note the corpus only covers classic lexical search — modern vector search / embeddings / semantic search is out of scope here.
