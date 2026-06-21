---
kb_id: testing/json-xml-assertions
version: 1
tags:
  - testing
  - jsonassert
  - xmlunit
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: libraries-testing (jsonassert/modelassert), xmlunit-2"
  - "CVE-2026-24400 AssertJ XXE — SentinelOne DB (https://www.sentinelone.com/vulnerability-database/cve-2026-24400/)"
related:
  - testing/assertion-libraries
  - testing/rest-api-testing
status: active
---

## Summary

**Concept**: Structural comparison of JSON and XML documents — semantic (order/whitespace-tolerant) equality rather than byte-string compare. **JSONassert** + **ModelAssert** for JSON; **XMLUnit 2.x** for XML with an identical-vs-similar distinction.
**Key APIs**: JSONassert `JSONAssert.assertEquals(expected, actual, LENIENT/STRICT)`, `CustomComparator`, `RegularExpressionValueMatcher`; ModelAssert `.at("/topics/1")` (JSON Pointer), where-clauses, `.toArgumentMatcher()`; XMLUnit `DiffBuilder.compare(c).withTest(t).checkForSimilar()`, `JAXPXPathEngine`, `Validator.forLanguage(...)`, `CompareMatcher.isIdenticalTo/isSimilarTo`.
**Gotcha**: XMLUnit `isSimilarTo` fails on reordered elements unless you supply `withNodeMatcher(new DefaultNodeMatcher(ElementSelectors.byName))`; identical ≠ similar.
**2026-currency**: XMLUnit 2.x API surface still valid (JAXP `javax.xml.*` is NOT part of the Jakarta migration); prefer XMLUnit over AssertJ `isXmlEqualTo` (CVE-2026-24400 XXE).
**Sources**: Baeldung `libraries-testing` (jsonassert/modelassert), `xmlunit-2`; CVE-2026-24400.

## Quick Reference

**JSONassert** (semantic JSON compare):
```java
JSONAssert.assertEquals(expected, actual, JSONCompareMode.LENIENT);  // or STRICT
JSONAssert.assertEquals(expected, actual,
    new CustomComparator(JSONCompareMode.LENIENT,
        new Customization("id", new RegularExpressionValueMatcher<>("\\d+"))));
```
`LENIENT` (extends-allowed, order-agnostic) vs `STRICT` (exact); `CustomComparator`, `RegularExpressionValueMatcher`, `ArraySizeComparator`.

**ModelAssert** (JSON Pointer navigation + relaxation):
- Navigate with `.at("/topics/1")` (JSON Pointer).
- Where-clauses relax: keys/array-in-any-order, ignore paths, regex by path/subtree.
- Emits Hamcrest & Mockito matchers via `.toArgumentMatcher()` — bridges into other libraries.

**XMLUnit 2.x** (XML compare/validate/XPath):
```java
Diff diff = DiffBuilder.compare(control).withTest(test)
    .checkForSimilar()
    .withNodeMatcher(new DefaultNodeMatcher(ElementSelectors.byName))  // order-tolerant
    .build();
```
- **Identical vs similar**: identical = same nodes same order; similar = semantically equivalent (reordered children OK with the right node matcher).
- XSD validation: `Validator.forLanguage(...)`; XPath: `JAXPXPathEngine.selectNodes`, `HasXPathMatcher`.
- Custom `DifferenceEvaluator` to downgrade specific differences; `Input` builder (file/stream/string); `CompareMatcher.isIdenticalTo/isSimilarTo`.

**Top gotchas**:
- XMLUnit `isSimilarTo` fails on reordered elements unless `withNodeMatcher(new DefaultNodeMatcher(ElementSelectors.byName))` is supplied.
- Identical ≠ similar — pick the right one for the assertion you mean.
- Prefer XMLUnit over AssertJ `isXmlEqualTo` on untrusted XML (XXE — see below).

**Current (mid-2026)**: XMLUnit 2.x API surface stays valid; the JAXP `javax.xml.*` packages it builds on were NOT part of the Jakarta EE migration, so they remain `javax.*`.

## Full content

Comparing structured documents (JSON/XML) by string equality is brittle — whitespace, key order, and array order all vary without semantic meaning. These libraries compare *structure*.

### JSON: JSONassert and ModelAssert

**JSONassert** does semantic comparison with two modes: `LENIENT` (the actual may have extra fields, arrays order-agnostic) and `STRICT` (exact match). For fields whose value is non-deterministic (ids, timestamps), a `CustomComparator` with a `RegularExpressionValueMatcher` matches by pattern instead of literal value. **ModelAssert** takes a path-oriented approach: navigate to a node with a JSON Pointer (`.at("/topics/1")`), then assert, with where-clauses to relax matching (ignore paths, arrays in any order, regex by subtree). Its `.toArgumentMatcher()` bridge emits Hamcrest/Mockito matchers, so a JSON assertion can be reused as a mock argument matcher.

### XML: XMLUnit 2.x

XMLUnit's central concept is the **identical vs similar** distinction. `DiffBuilder.compare(control).withTest(test)` builds a `Diff`; `.checkForSimilar()` accepts semantic equivalence (e.g., reordered child elements) where `.checkForIdentical()` requires exact node order. Order tolerance requires an explicit node matcher — `withNodeMatcher(new DefaultNodeMatcher(ElementSelectors.byName))` — otherwise reordered elements fail even under `isSimilarTo`. Beyond comparison, XMLUnit does XSD validation (`Validator.forLanguage`), XPath queries (`JAXPXPathEngine`, `HasXPathMatcher`), and custom `DifferenceEvaluator`s that downgrade specific differences (e.g., ignore one attribute).

### 2026 currency

- **XMLUnit 2.x API surface is still valid.** The JAXP `javax.xml.*` packages it sits on were NOT part of the Jakarta EE namespace migration, so they stay `javax.*` (unlike Servlet/JPA/Mail).
- **Prefer XMLUnit over AssertJ `isXmlEqualTo` on untrusted XML.** CVE-2026-24400 is an XXE in AssertJ's `XmlStringPrettyFormatter` (reached via `isXmlEqualTo`), enabling local-file read / SSRF / Billion-Laughs DoS — XMLUnit is the recommended remediation path for XML comparison. [CVE-2026-24400 (SentinelOne DB)](https://www.sentinelone.com/vulnerability-database/cve-2026-24400/)
- JSONassert/ModelAssert remain valid at the API level; for live HTTP API JSON-body assertions, REST-Assured's GPath body matchers and JSON Schema validation are the integrated path (see [testing/rest-api-testing](rest-api-testing.md)).
