---
kb_id: java-libraries/commons-io-lang
version: 1
tags:
  - java-libraries
  - apache-commons
  - io
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: libraries-apache-commons (lang3/math3/text/dbutils/chain/beanutils), libraries-apache-commons-io (io/csv), libraries-io (sftp), guava-modules/guava-io"
  - "NVD CVE-2025-48976 (Apache Commons FileUpload multipart-header DoS)"
related:
  - java-libraries/commons-collections
  - java-libraries/document-generation
status: active
---

## Summary

**Concept**: Apache Commons file/IO/string/utility families plus Guava IO and SFTP clients — Commons IO (`FileUtils`/filters/tee/monitor), Commons CSV, Commons Lang3/Math3/Text, Guava IO sinks/sources, and the three SFTP libraries (JSch/SSHJ/VFS2).
**Key APIs**: Commons IO `FileUtils.copyFileToDirectory`/`readFileToString`, `FilenameUtils`, file filters (`WildcardFileFilter`/`SuffixFileFilter`+`IOCase`), `TeeInputStream`, `FileAlterationMonitor`; CSV `CSVFormat.withFirstRecordAsHeader()`/`CSVPrinter`; Lang3 `StringUtils`/`HashCodeBuilder`/`FastDateFormat`; Guava `Files.asCharSink`/`ByteSource`.
**Gotcha**: Commons `ArrayUtils.add/remove` return new arrays but `reverse/shift/swap` mutate in place; Guava `Files.toString`/`write(CharSequence)` deprecated in Guava 29; SFTP host-key verification spectrum (`known_hosts` vs `PromiscuousVerifier` = MITM-vulnerable); recursive delete shown 5 ways.
**2026-currency**: original `com.jcraft` JSch dead → `com.github.mwiede:jsch` fork; CVE-2025-48976 (Commons FileUpload DoS) fixed in 1.6/2.0.0-M4; much of Commons IO superseded by `java.nio.file.Files`.
**Sources**: Baeldung `libraries-apache-commons*`/`libraries-io`/`guava-io` modules.

## Quick Reference

**Apache Commons IO:**

```java
FileUtils.copyFileToDirectory(src, dir);
String s = FileUtils.readFileToString(file, StandardCharsets.UTF_8);
// filters: NameFileFilter / WildcardFileFilter / SuffixFileFilter / AndFileFilter + IOCase
// TeeInputStream / TeeOutputStream; FileAlterationMonitor (polling — vs event-driven JDK WatchService)
```

**Commons CSV:**

```java
CSVParser p = CSVFormat.DEFAULT.withFirstRecordAsHeader().parse(reader);
record.get("colName");   // CSVPrinter to write (CRLF default)
```

**Commons Lang3 / Math3 / Text:**

- Lang3 — `ArrayUtils`/`StringUtils`/`BooleanUtils`/`SystemUtils`; builders `HashCodeBuilder`/`EqualsBuilder`/`ToStringBuilder`; `FastDateFormat` (thread-safe `SimpleDateFormat`).
- Math3 — `DescriptiveStatistics`, linear algebra, `Frequency`.
- Text — `StringSubstitutor` (was `StrSubstitutor`), `WordUtils`, Myers `StringsComparator`/`EditScript`.
- Also: **DbUtils** (`QueryRunner` + `ResultSetHandler`), **Chain** (CoR — `execute` returns false to *continue*), **BeanUtils** (`PropertyUtils`/`copyProperties`).

**Guava IO:** `Files.asCharSink`/`asCharSource` (the `Files.write(CharSequence)`/`toString` forms are **deprecated in Guava 29**), `ByteSource.slice`, `CharStreams`/`ByteStreams`, `Resources.getResource`, `CountingOutputStream`, `LittleEndianDataInput/OutputStream`.

**SFTP three ways (+ host-key verification spectrum):**

| Library | Entry point | Host-key |
|---|---|---|
| JSch (`com.jcraft` → `com.github.mwiede` fork) | low-level `ChannelSftp` | `known_hosts` |
| SSHJ | `SSHClient.newSFTPClient` | `PromiscuousVerifier` = **MITM-vulnerable** |
| Commons VFS2 | `resolveFile("sftp://user:pass@host/..")` | creds-in-URL anti-pattern |

**Recursive delete (5 ways):** `Files.walk().sorted(reverseOrder)...delete`, `Files.walkFileTree`+`SimpleFileVisitor`, recursive `File.listFiles`, Commons IO `FileUtils.deleteDirectory`, Spring `FileSystemUtils.deleteRecursively`.

**Top gotchas:**

- Commons `ArrayUtils.add/remove` return **new** arrays; `reverse/shift/swap` **mutate in place** (mixed contract). `StringUtils.appendIfMissing` returns unchanged if already present.
- SSHJ `PromiscuousVerifier` and creds-in-URL are MITM/secret-leak anti-patterns (test-only).

**Current (mid-2026):** original `com.jcraft` JSch is dead → **`com.github.mwiede:jsch`** (Apache-2.0, 2.28.x line). **CVE-2025-48976** (Commons FileUpload multipart-header DoS) fixed in **1.6 / 2.0.0-M4**. Much of Commons IO is superseded by `java.nio.file.Files`/`Path` (filters/comparators/tee/monitor still win).

## Full content

This atom collects the Apache Commons file/IO/string utility families, Guava's IO surface, and the SFTP clients. **Apache Commons IO** wraps file operations (`FileUtils.copyFileToDirectory`, `readFileToString(file, charset)`), filename manipulation (`FilenameUtils`), a rich file-filter algebra (`NameFileFilter`/`WildcardFileFilter`/`SuffixFileFilter`/`AndFileFilter` with `IOCase` case sensitivity), tee streams (`TeeInputStream`/`TeeOutputStream`), and a polling directory watcher (`FileAlterationMonitor` — contrasted with the event-driven JDK `WatchService`). **Commons CSV** parses and writes CSV (`CSVFormat.withFirstRecordAsHeader()`, `CSVRecord.get`, `CSVPrinter`, with CRLF line endings by default).

**Commons Lang3** is the general-utility grab-bag: `ArrayUtils`, `StringUtils`, `BooleanUtils`, `SystemUtils`, the builder helpers (`HashCodeBuilder`/`EqualsBuilder`/`ToStringBuilder`), and `FastDateFormat` (a thread-safe `SimpleDateFormat`). A subtle correctness lesson lives in `ArrayUtils`: `add`/`remove` return *new* arrays (arrays being fixed-size), while `reverse`/`shift`/`swap` mutate in place — a mixed mutate-vs-return contract. **Commons Math3** adds `DescriptiveStatistics`, linear algebra, and `Frequency`; **Commons Text** adds `StringSubstitutor` (the renamed `StrSubstitutor`), `WordUtils`, and a Myers diff (`StringsComparator`/`EditScript`). The family also includes **DbUtils** (JDBC boilerplate via `QueryRunner` + `ResultSetHandler`s), **Chain** (Chain-of-Responsibility, where `execute` returning `false` *continues* the chain), and **BeanUtils** (`PropertyUtils`, `BeanUtils.copyProperties`).

**Guava IO** offers a sink/source abstraction (`Files.asCharSink`/`asCharSource`, `ByteSource.slice`) plus stream helpers (`CharStreams`/`ByteStreams`), classpath resource access (`Resources.getResource`), and specialized streams (`CountingOutputStream`, `LittleEndianDataInput/OutputStream`); the older `Files.toString`/`write(CharSequence)` convenience forms were deprecated in Guava 29 in favor of the JDK's `Files.readString`/`writeString` (Java 11). The **SFTP** trio teaches three styles — JSch (low-level `ChannelSftp`), SSHJ (`SSHClient.newSFTPClient`), and Commons VFS2 (`resolveFile("sftp://...")`) — and a host-key-verification spectrum running from secure (`known_hosts`) to MITM-vulnerable (`PromiscuousVerifier`, or credentials embedded in the VFS URL). Recursive directory deletion is shown five ways, from `Files.walk().sorted(reverseOrder)` to Spring's `FileSystemUtils.deleteRecursively`.

### 2026 currency

- The original **`com.jcraft` JSch is dead → `com.github.mwiede:jsch`** (Apache-2.0, actively maintained, on the 2.28.x line). [mwiede/jsch on Maven Central](https://mvnrepository.com/artifact/com.github.mwiede/jsch)
- **CVE-2025-48976 (Apache Commons FileUpload multipart-header DoS, CWE-770)** — net-new since the base; fixed in **1.6** (1.0–1.5 affected) and **2.0.0-M4** (M1–M3 affected). Relevant transitively to older servlet stacks. [NVD CVE-2025-48976](https://nvd.nist.gov/vuln/detail/CVE-2025-48976)
- Much of Commons IO `FileUtils`/`FilenameUtils` is superseded by `java.nio.file.Files`/`Path`, but Commons IO still wins for filters/comparators/tee/monitor. Commons `FastDateFormat`/`SimpleDateFormat` → `java.time.DateTimeFormatter`; Commons `StrSubstitutor` → `StringSubstitutor`. Guava `Files.toString`/`write(CharSequence)` (deprecated Guava 29) → `java.nio.file.Files.readString/writeString` (Java 11).
- The SSHJ `PromiscuousVerifier` / credentials-in-URL patterns remain test-only MITM/secret-leak anti-patterns.
