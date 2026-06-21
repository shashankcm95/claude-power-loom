---
kb_id: testing/assertion-libraries
version: 1
tags:
  - testing
  - assertj
  - hamcrest
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: assertion-libraries (assertj/truth), hamcrest, testing-assertions, libraries-testing"
  - "AssertJ releases — github.com/assertj/assertj (https://github.com/assertj/assertj/releases)"
  - "Hamcrest v3.0 release — github.com/hamcrest/JavaHamcrest (https://github.com/hamcrest/JavaHamcrest/releases/tag/v3.0)"
related:
  - testing/junit5-jupiter
  - testing/json-xml-assertions
  - testing/spring-testcontext
status: active
---

## Summary

**Concept**: The assertion layer — **AssertJ** (the 2026 default fluent style, `assertThat(actual).isX()`), **Hamcrest** (matcher style, `assertThat(actual, matcher)`), and Google **Truth** (Google's fluent variant, heavily outdated in this corpus).
**Key APIs**: AssertJ `assertThat`, `usingRecursiveComparison()`, `assertThatThrownBy`, `catchThrowable`, `Condition<T>` + `allOf/anyOf`, custom `AbstractAssert`; Hamcrest `MatcherAssert.assertThat(actual, matcher)`, `is`/`equalTo`/`hasItem`/`containsInAnyOrder`/`closeTo`, custom `TypeSafeMatcher<T>`.
**Gotcha**: AssertJ `hasSameElementsAs` *ignores* duplicates (cardinality-blind); `org.junit.Assert.assertThat` is deprecated; identical ≠ similar in equality semantics.
**2026-currency**: AssertJ 3.27.7 / 4.0.0-M1; Hamcrest single `org.hamcrest:hamcrest:3.0` jar (2024-08-01); CVE-2026-24400 AssertJ XXE fixed in 3.27.7; Truth 1.x removed `SubjectFactory`/`.named()`.
**Sources**: Baeldung `assertion-libraries`/`hamcrest`/`testing-assertions`; AssertJ + Hamcrest releases; CVE-2026-24400.

## Quick Reference

**AssertJ (fluent, the default)**:
```java
assertThat(actual).isEqualTo(expected).isNotNull();
assertThat(list).contains(x).hasSize(3).hasSameElementsAs(other);
assertThatThrownBy(() -> svc.call()).isInstanceOf(IllegalArgumentException.class);
```
Type-specific entry points (object/collection/map/file/stream/exception); recursive field compare `usingRecursiveComparison()` (modern; replaces `isEqualToComparingFieldByFieldRecursively`); soft offset `withPrecision`; description `.as(...)`. Java 8: `Optional`, `Predicate.accepts/rejects`, `flatExtracting`, `satisfies`, `matches`. Reusable `Condition<T>` + `allOf/anyOf/not`. Exceptions: `assertThatThrownBy`, `assertThatExceptionOfType(...).isThrownBy(...)`, `catchThrowable`. Custom: extend `AbstractAssert`.

**Hamcrest (matcher)**:
```java
assertThat(actual, is(equalTo(expected)));
assertThat(list, containsInAnyOrder(1, 2, 3));
assertThat(num, closeTo(3.14, 0.01));
```
Catalog: core (`is`, `equalTo`, `instanceOf`, `not`, `hasItem(s)`, `allOf/anyOf/both().and()/everyItem`, `sameInstance`), text (`matchesPattern`, `stringContainsInOrder`, `*IgnoringCase`), number (`closeTo`, `comparesEqualTo`, `greaterThan`/`lessThan`), beans (`hasProperty`, `samePropertyValuesAs`), file (`io.FileMatchers`: `anExistingFile`, `aReadableFile`). Custom: extend `TypeSafeMatcher<T>` (`matchesSafely` + `describeTo` + static factory).

**Order-agnostic list equality** (cross-library): JDK `containsAll`+size (fooled by duplicates), Hamcrest `containsInAnyOrder`, Apache Commons `CollectionUtils.isEqualCollection` (cardinality-aware — the only correct one), AssertJ `hasSameElementsAs` (ignores duplicates).

**Top gotchas**:
- AssertJ `hasSameElementsAs` and JDK `containsAll`+size are duplicate-blind; only `CollectionUtils.isEqualCollection` is cardinality-correct.
- `org.junit.Assert.assertThat` is deprecated — use `MatcherAssert.assertThat` (Hamcrest) or AssertJ.
- Hamcrest `@Factory`, `isEmptyString()`, `IsIn.isIn` deprecated/removed in 2.x+.

**Current (mid-2026)**: AssertJ 3.27.7 (2026-01-24) + 4.0.0-M1 milestone; Hamcrest collapsed to a single `org.hamcrest:hamcrest:3.0` jar (2024-08-01) — the deprecated `java-hamcrest`/`hamcrest-all` coordinates are wrong. **Security**: AssertJ < 3.27.7 has an XXE CVE (see below).

## Full content

The corpus is a teaching catalogue that frequently juxtaposes 3-5 assertion libraries on the *same* assertion to contrast them. Two styles dominate.

### AssertJ — fluent, the 2026 default

`assertThat(actual)` returns a type-specific assertion object whose methods chain. The fluency makes IDE auto-complete the discovery mechanism, and failure messages are rich by default. `usingRecursiveComparison()` deep-compares objects field-by-field (the modern replacement for the verbose `isEqualToComparingFieldByFieldRecursively`). Exception assertions (`assertThatThrownBy`, `catchThrowable`) capture and assert on thrown exceptions. Reusable `Condition<T>` objects compose with `allOf`/`anyOf`; custom domain assertions extend `AbstractAssert`. A Guava module adds `Multimap`/`Range`/`Table` support.

### Hamcrest — matcher-based

Hamcrest inverts the structure: `assertThat(actual, matcher)`, where the matcher is a composable predicate from a large catalog. Its strength is the matcher algebra (`allOf`, `anyOf`, `both().and()`, `everyItem`) and reuse across JUnit, Mockito (`argThat`), and REST-Assured. Custom matchers extend `TypeSafeMatcher<T>`, implementing `matchesSafely` plus `describeTo` for the failure message.

### Google Truth and equality semantics

Truth is Google's fluent variant (`assertWithMessage`, custom `Subject`s) — present but heavily outdated in this corpus. A recurring teaching point across libraries is **cardinality**: order-agnostic list equality is correct only with `CollectionUtils.isEqualCollection`; `containsAll`+size and AssertJ `hasSameElementsAs` are fooled by duplicates (the corpus leaves an illustrative failing example in).

### 2026 currency

- **Hamcrest 2.x → 3.0** (2024-08-01): a single `org.hamcrest:hamcrest:3.0` jar (Java 8 bytecode; Java 7 stays on 2.2). The "use 2.x" advice is superseded; the deprecated `java-hamcrest`/`hamcrest-all` coordinates remain wrong. [Hamcrest v3.0 release (GitHub)](https://github.com/hamcrest/JavaHamcrest/releases/tag/v3.0)
- **AssertJ** current is assertj-core 3.27.7 (2026-01-24) with a 4.0.0-M1 milestone. [AssertJ releases](https://github.com/assertj/assertj/releases)
- **CVE-2026-24400 — AssertJ XXE** in `XmlStringPrettyFormatter.toXmlDocument(String)`, reached via `assertThat(...).isXmlEqualTo(...)`: `DocumentBuilderFactory` is initialized without disabling DTDs/external entities → arbitrary local-file read (`file://`), SSRF, and "Billion Laughs" DoS on untrusted XML. Affects 1.4.0 through 3.27.6; **fixed in assertj-core 3.27.7**. Remediation: prefer XMLUnit for XML comparison (see [testing/json-xml-assertions](json-xml-assertions.md)), else upgrade to 3.27.7, else avoid `isXmlEqualTo` on untrusted input. [CVE-2026-24400 (SentinelOne DB)](https://www.sentinelone.com/vulnerability-database/cve-2026-24400/) · [Snyk SNYK-RHEL8-ASSERTJCORE-15128233](https://security.snyk.io/vuln/SNYK-RHEL8-ASSERTJCORE-15128233) · [AssertJ 3.27.7 release](https://github.com/assertj/assertj/releases/tag/assertj-build-3.27.7)
- **Google Truth 0.32 → 1.x**: `SubjectFactory`/`FailureStrategy`/`.named(...)` removed (now `Subject.Factory` + `FailureMetadata`); `Truth8` folded into `Truth`. Custom-subject code won't compile against 1.x.
- Fluent assertions (AssertJ) and `assertThat(actual, matcher)` (Hamcrest on 2.2/3.0) remain the current default idioms.
