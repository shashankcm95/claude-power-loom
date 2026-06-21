---
kb_id: java-libraries/logging
version: 1
tags:
  - java-libraries
  - logging
  - slf4j
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: logging-modules/{log-mdc,log4j,log4j2,logback,flogger}"
  - "Apache Log4j Security page (logging.apache.org/security.html)"
related:
  - java-libraries/resilience-concurrency
status: active
---

## Summary

**Concept**: the Java logging stack — SLF4J facade over Logback / Log4j 2 / Log4j 1.x backends; contextual logging via MDC/NDC; Google Flogger (fluent). Includes the Log4Shell security floor and the MDC-leaks-across-pooled-threads pitfall.
**Key APIs**: SLF4J `Logger` + `{}` parameterized messages; Logback `AppenderBase`/custom `PatternLayout`/`SMTPAppender`; Log4j2 `@Plugin` SPI/`StrLookup`/lazy `Supplier` logging; `MDC.put`/`%X{key}`/`ThreadContext`; Flogger `FluentLogger.forEnclosingClass()`.
**Gotcha**: pass a `Throwable` as the LAST arg (no `{}`); MDC leaks across pooled threads unless cleared in `ThreadPoolExecutor.afterExecute`; Log4j2 lazy logging needs `Supplier` (`() -> expensive()`); Flogger lazy args must pass the OBJECT, never `obj.toString()`/concatenation.
**2026-currency**: Log4Shell (CVE-2021-44228) fixed in Log4j2 2.15.0 (floor; current 2.26.0); Logback CVE-2021-42550 fixed in 1.2.9; the modern MDC fix is Scoped Values (JDK 25).
**Sources**: Baeldung `logging-modules/*` modules.

## Quick Reference

**The stack (facade + backends):**

```java
// SLF4J facade — swap backend by swapping the dependency
private static final Logger log = LoggerFactory.getLogger(Foo.class);
log.info("user {} did {}", userId, action);   // {} parameterized — no string concat
log.error("failed", throwable);                // Throwable is the LAST arg, NO {}
```
Backends: **Logback** (SLF4J-native), **Log4j 2**, **Log4j 1.x** (EOL).

**Logback extension points:** custom appender `extends AppenderBase<ILoggingEvent>` (override `append`, `addError` for validation, bean setters for XML); custom `PatternLayout` (override `doLayout`) for PII masking (regex group → `*`); `SMTPAppender` (HTML layout, STARTTLS, `CyclicBufferTracker`); JSON via `logstash-logback-encoder`.

**Log4j 2 internals:** appenders/layouts/filters (three pluggable axes); **lazy logging** `logger.trace("{}", () -> expensive())` (Supplier evaluated only if level enabled); the `@Plugin` SPI — custom appender (`@PluginFactory`/`@PluginBuilderFactory`), custom lookup (`StrLookup`, the `${kafka:..}` mechanism — *same family as the Log4Shell JndiLookup*), custom pattern converter (`@ConverterKeys`); `JsonLayout`/`XMLLayout`; async appenders.

**Contextual logging (MDC / NDC):**

```java
MDC.put("requestId", id);   // per-thread map; %X{requestId} in pattern; Log4j2: ThreadContext.put
// NDC = per-thread STACK (%x, Log4j-1.x predecessor), push/pop in try/finally
```
**MDC leaks across pooled threads** unless cleared — fix: a `ThreadPoolExecutor` overriding `afterExecute` to call `MDC.clear()` + `ThreadContext.clearAll()`.

**Flogger (Google fluent):** `FluentLogger.forEnclosingClass()`, `atInfo().log("fmt %s", arg)`, `.withCause`/`.every(n)`/`.atMostEvery`; `LazyArgs.lazy(() -> ..)` — **pass the object, never `obj.toString()`/concatenation** (defeats deferral).

**Current (mid-2026):** Log4Shell (CVE-2021-44228) floor is Log4j2 **2.15.0** (current line **2.26.0**); Logback CVE-2021-42550 fixed in **1.2.9** (current 1.5.x); Log4j 1.x is unfixable — migrate. The modern MDC fix under virtual threads is **Scoped Values** (JDK 25), not `afterExecute` clearing.

## Full content

The Java logging architecture is a facade-plus-backend design. **SLF4J** is the facade: code depends on `org.slf4j.Logger` with `{}`-parameterized messages, and the runtime backend is chosen by which implementation JAR is on the classpath. **Logback** is the SLF4J-native backend; **Log4j 2** is the alternative; **Log4j 1.x** is EOL. The cross-cutting idiom is the parameterized message — `log.info("user {} did {}", id, action)` avoids string concatenation when the level is disabled — and the exception convention: a `Throwable` is passed as the *last* argument with no matching `{}`.

Each backend exposes extension points. **Logback** custom appenders extend `AppenderBase<ILoggingEvent>` (overriding `append`, using `addError` for config validation, and bean setters for XML config); a custom `PatternLayout` overriding `doLayout` is the canonical PII-masking technique (regex-match a group, replace with `*`); the `SMTPAppender` batches via a `CyclicBufferTracker` and supports STARTTLS. **Log4j 2** has three pluggable axes (appenders/layouts/filters), a programmatic `ConfigurationBuilder`, lazy logging via `Supplier` (`logger.trace("{}", () -> expensive())`, evaluated only if the level is enabled), and the `@Plugin` SPI for custom appenders (`@PluginFactory`), lookups (`StrLookup` — the `${kafka:..}` mechanism, the *same family as the Log4Shell JndiLookup*), and pattern converters (`@ConverterKeys`).

**Contextual logging** uses MDC and NDC. MDC is a per-thread key/value map (`MDC.put`/`clear`, rendered with `%X{key}`; Log4j2's equivalent is `ThreadContext.put`); NDC is the older per-thread *stack* (`%x`, push/pop in try/finally). The load-bearing pitfall: because MDC is thread-local, it **leaks across pooled threads** — a thread returned to a pool retains the previous task's context. The shown fix is a `ThreadPoolExecutor` overriding `afterExecute` to clear all backends (`MDC.clear()` + `ThreadContext.clearAll()`). **Flogger** (Google's fluent logger) uses `FluentLogger.forEnclosingClass()` with `atInfo().log(...)` and fluent modifiers (`.withCause`, `.every(n)`, `.atMostEvery`); its lazy-arg discipline mirrors Log4j2 — pass the *object* (or `LazyArgs.lazy(() -> ..)`), never `obj.toString()` or concatenation, which defeats the deferral.

### 2026 currency

- **Log4Shell (CVE-2021-44228)** — the base's pins (Log4j2 2.7 / 2.11.0) predate the Dec-2021 disclosure and are **vulnerable**. The fix landed in **2.15.0** (Java 8), with backports 2.12.2 (Java 7) and 2.3.1 (Java 6); the pragmatic mid-2026 floor is far past these (current line **2.26.0**, 2 May 2026). The custom-`StrLookup` SPI shown (`KafkaLookup`, `${kafka:..}`) is the same JndiLookup family the exploit abused. [Apache Log4j Security page](https://logging.apache.org/security.html), [Log4j 2.x release notes](https://logging.apache.org/log4j/2.x/release-notes.html)
- **CVE-2021-42550 (Logback JNDI in config)** — base ships Logback 1.2.3 (vulnerable); fixed in **1.2.9** (hardening JNDI lookups to the `java:` namespace). Current major is **1.5.x** (Java 11+, SLF4J 2.x). [GHSA-668q-qrv7-99fm](https://github.com/advisories/GHSA-668q-qrv7-99fm), [Logback news (qos.ch)](https://logback.qos.ch/news.html)
- **Log4j 1.x (1.2.17)** is unfixable (EOL since 2015, own CVEs) — migrate to Log4j2 or SLF4J+Logback. [Apache Logging Security page](https://logging.apache.org/security.html)
- **Scoped Values (JEP 506, finalized Java 25)** are the immutable-context replacement for `ThreadLocal` under virtual threads — the modern fix for the MDC-leak pitfall, replacing `afterExecute` clearing. [Java 25 LTS and IntelliJ IDEA (JetBrains)](https://blog.jetbrains.com/idea/2025/09/java-25-lts-and-intellij-idea/)
- The SLF4J facade + binding model and the `@Plugin` SPI carry forward unchanged — just bump the backend version.
