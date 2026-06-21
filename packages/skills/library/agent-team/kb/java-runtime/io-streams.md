---
kb_id: java-runtime/io-streams
version: 1
tags:
  - java-runtime
  - io
  - serialization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-io, core-java-io-2, core-java-io-3, core-java-io-4, core-java-io-apis, core-java-io-conversions, core-java-io-conversions-2"
  - "JEP 421: Deprecate Finalization for Removal (openjdk.org/jeps/421); java.io.ObjectInputFilter (JDK 9+)"
related:
  - java-runtime/nio-files-channels
  - java-runtime/java-crypto-security
status: active
---

## Summary

**Concept**: Classic `java.io` byte/char streams, the `File` class, the conversion cookbook, and the two big security surfaces — Zip-Slip and deserialization RCE.
**Key APIs**: `BufferedReader`/`BufferedWriter`/`PrintWriter`, `InputStream`/`OutputStream` + `InputStreamReader`/`OutputStreamWriter`, `Scanner`, `DataInputStream`/`RandomAccessFile`, `File`, `ZipInputStream`/`ZipOutputStream`, `ObjectInputStream`.
**Gotcha**: `Reader`/`Writer` are char-oriented, `InputStream`/`OutputStream` byte-oriented — always bridge with an explicit `Charset`; must `flush()`/`close()` or buffered output is lost; deserializing untrusted data is RCE.
**2026-currency**: `Files.readString`/`writeString` + `InputStream.transferTo` (JDK 9/11) and `ObjectInputFilter` (JDK 9+) are the modern conveniences/mitigations.
**Sources**: Baeldung `core-java-io*` + `core-java-io-conversions*` modules.

## Quick Reference

**Byte vs char boundary**: `Reader`/`Writer` are char-oriented, `InputStream`/`OutputStream` are byte-oriented. Bridge with `InputStreamReader`/`OutputStreamWriter` + an explicit `Charset` — `FileReader`/`FileWriter`/`new String(bytes)`/`getBytes()` without a charset use the platform default (a portability hazard).

**Reading**: `BufferedReader`/`FileReader`, classloader `getResourceAsStream`, `Scanner`, `StreamTokenizer`, `DataInputStream`, `RandomAccessFile`. **Writing**: `BufferedWriter`, `PrintWriter`, `FileOutputStream`, `DataOutputStream.writeUTF`, `RandomAccessFile` (positional `seek`+`writeInt`). Append via constructor flags. **Must `flush()`/`close()`** or buffered output is lost.

**`File` class & paths**: metadata (`getName`/`getParentFile`/`getPath`), permissions (`setWritable`/`setReadable`), `FilenameFilter`. `getPath()` (as-constructed) vs `getAbsolutePath()` (resolved vs `user.dir`, keeps `..`/`.`) vs `getCanonicalPath()` (fully normalized, can throw IOException). `mkdir()` returns false silently (parent missing / dir exists); `mkdirs()` creates intermediates. Separators: `File.separator` (within-path `/` vs `\`) vs `File.pathSeparator` (between-paths `:` vs `;`).

**Scanner deep-dive**: `next`/`nextInt`/`nextDouble` (radix + Locale), `useDelimiter` (`\\A` = whole input), `nextLine` edge cases, `hasNext` (token) vs `hasNextLine` (line). **Scanner swallows IOException** — check `scanner.ioException()`.

**Conversion cookbook**: every stream/reader/writer <-> `byte[]`/`String`/`File`, shown via JDK / Guava (`CharSource`/`ByteSource`/`CharStreams`/`ByteStreams`) / Commons-IO (`IOUtils`/`FileUtils`). InputStream->String across eras: Java 5 manual, Java 7 `Scanner("\\A")`, Java 8 `BufferedReader.lines().collect(joining)`, Java 9 `readAllBytes()`.

**Security surfaces**:
- **Zip-Slip**: validate the resolved `destFile.getCanonicalPath()` stays inside `destDir.getCanonicalPath() + File.separator` before extracting each entry.
- **Deserialization RCE**: a `Serializable` gadget whose `readObject` reflectively invokes methods can reach `Runtime.exec` during `ObjectInputStream.readObject()`. Never deserialize untrusted data.

**Current (mid-2026)**: `Files.writeString`/`readString` (JDK 11), `InputStream.transferTo` (JDK 9), `HexFormat` (JDK 17). Deserialization mitigation: `ObjectInputFilter` + `jdk.serialFilter`/`jdk.serialFilterFactory`. `finalize()` deprecated for removal (JEP 421) — use try-with-resources / `Cleaner`.

## Full content

This is the classic `java.io` surface: byte and character streams, the `File` class, the cross-library conversion cookbook, and the two notorious security surfaces. (Modern file operations and channels live in the sibling NIO atom.)

### The byte/char boundary

`Reader`/`Writer` are character-oriented; `InputStream`/`OutputStream` are byte-oriented. You bridge them with `InputStreamReader`/`OutputStreamWriter` and an explicit `Charset` — `new InputStreamReader(new ByteArrayInputStream(bytes), charset)`. Evidence: `core-java-io-conversions/.../xtoreader/JavaXToReaderUnitTest.java:64-69`. Constructing `FileReader`/`FileWriter` or calling `new String(bytes)`/`getBytes()` without a charset silently uses the platform default, a portability hazard. Reading is taught many ways (`BufferedReader`, `Scanner`, `StreamTokenizer`, `DataInputStream`, `RandomAccessFile`, classloader `getResourceAsStream`); writing likewise (`BufferedWriter`, `PrintWriter`, `DataOutputStream.writeUTF`, positional `RandomAccessFile`). Buffered output is lost unless you `flush()`/`close()` — a non-blocking socket test even hangs on `readLine` without a `flush`.

### The File class and paths

`File` exposes metadata and permissions, `FilenameFilter`, and three path views with distinct contracts: `getPath()` returns the string as constructed, `getAbsolutePath()` resolves against `user.dir` but keeps `..`/`.` segments and never throws, and `getCanonicalPath()` fully normalizes but can throw `IOException` (e.g. a `*` on Windows). `mkdir()` returns false silently when the parent is missing or the directory exists — you must check the boolean — while `mkdirs()` creates intermediates. The separator pair confuses people: `File.separator`/`separatorChar` is the within-path character (`/` vs `\`), `File.pathSeparator`/`pathSeparatorChar` is the between-paths character on a classpath (`:` vs `;`). Evidence: `core-java-io-apis`, `core-java-io-4`.

### Scanner

`Scanner` parses tokens (`next`/`nextInt`/`nextDouble` with radix + Locale), supports `useDelimiter` (`\\A` reads the whole input), and distinguishes `hasNext` (a token remains) from `hasNextLine` (a line remains). A subtle gotcha: `Scanner` swallows `IOException` internally — call `scanner.ioException()` to retrieve it.

### Conversion cookbook

The corpus shows every stream/reader/writer converted to and from `byte[]`/`String`/`File` three ways — plain JDK, Guava (`CharSource`/`ByteSource`/`CharStreams`/`ByteStreams`), and Commons-IO (`IOUtils`/`FileUtils`) — plus InputStream->String across JDK eras (Java 5 manual loop, Java 7 `Scanner("\\A")`, Java 8 `BufferedReader.lines().collect(joining)`, Java 9 `readAllBytes()`). CSV is shown naively (`split(",")`) and properly (OpenCSV `CSVReader`), JSON via `org.json` `JSONTokener` streaming. Evidence: `core-java-io-conversions-2/.../inputstreamtostring/JavaInputStreamToXUnitTest.java`.

### Security surfaces

Two attack surfaces are taught. **Zip-Slip**: when extracting a zip, a malicious entry name like `../../etc/passwd` can write outside the destination — defend by comparing the resolved canonical path of each target against the destination directory's canonical path before writing. Evidence: `core-java-io/.../unzip/UnzipFile.java`. **Deserialization RCE**: a `Serializable` gadget whose `readObject` reflectively invokes arbitrary methods can reach `Runtime.exec` during `ObjectInputStream.readObject()` — the lesson is to never deserialize untrusted data. (Note: one corpus example, `JavaCurlExamples.inputStreamToString`, has a real bug — it ignores the `read()` byte count and appends a full buffer each iteration.)

### 2026 currency

- **Conveniences the corpus predates**: `Files.writeString`/`Files.readString` (JDK 11), `InputStream.transferTo` (JDK 9), `HexFormat` (JDK 17, replacing manual hex + `DatatypeConverter`), JUnit 5 `@TempDir`. (Correct successors per JDK release history.)
- **Deserialization mitigation**: the successor to "just don't" is **`ObjectInputFilter`** (JDK 9+) plus the JVM-wide `jdk.serialFilter` / `jdk.serialFilterFactory` properties to allowlist classes; "never deserialize untrusted data" remains the rule.
- **`finalize()` deprecated for removal — JEP 421 (JDK 18)** — still on by default but disableable via `--finalization=disabled`; migrate resource cleanup to try-with-resources / `AutoCloseable` + `java.lang.ref.Cleaner`. [JEP 421: Deprecate Finalization for Removal](https://openjdk.org/jeps/421)
- **javax JAF/JAXB removed from JDK 11**: `javax.activation.MimetypesFileTypeMap` needs Jakarta Activation, and `javax.xml.bind.DatatypeConverter` needs the external `jaxb-api` or `HexFormat`.
