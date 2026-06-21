---
kb_id: serialization/xml-serializers
version: 1
tags:
  - serialization
  - xml
  - xstream
  - jackson-xml
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: xstream"
  - "Baeldung tutorials (eugenp/tutorials) module: xml"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-conversions"
  - "XStream Security Aspects (x-stream.github.io/security.html)"
related:
  - serialization/jaxb-binding
  - serialization/xml-parsing-jaxp
  - serialization/xml-xxe-security
  - serialization/jackson-databinding
status: active
---

## Summary

**Concept**: Object ⇄ XML serializers beyond JAXB — jackson-dataformat-xml (`XmlMapper`, the modern mainstream), XStream (zero-config reflection), and JiBX (external binding file).
**Key APIs**: `XmlMapper` (full `ObjectMapper` API) + `@JacksonXmlRootElement`; XStream `new XStream().toXML/fromXML`, `alias`/`aliasField`/`@XStreamAlias`, `omitField`/`@XStreamOmitField`, `@XStreamImplicit`, custom `Converter`/`SingleValueConverter`, JSON drivers; JiBX `customer-binding.xml` + `maven-jibx-plugin`.
**Gotcha**: XStream `fromXML` on untrusted input is RCE-by-default (must add a default-deny allowlist); `@XStreamImplicit` changes the wire shape; `JsonHierarchicalStreamDriver` is write-only; JiBX won't run without the `maven-jibx-plugin` build step.
**2026-currency**: jackson-dataformat-xml is the safe mainstream choice; XStream patched to 1.4.21 (many shops migrated off entirely); JiBX abandoned (~2019 EOL).
**Sources**: Baeldung `xstream`/`xml`/`jackson-conversions`; XStream Security Aspects.

## Quick Reference

**jackson-dataformat-xml (the modern mainstream)**:

```java
XmlMapper xm = new XmlMapper();         // full ObjectMapper API over XML
String xml = xm.writeValueAsString(pojo);
Pojo p = xm.readValue(xml, Pojo.class);
@JacksonXmlRootElement(localName = "person") class Person { ... }
```

**XStream (zero-config reflection)**:

```java
XStream xs = new XStream();
String xml = xs.toXML(anyPojo);          // any POJO, no annotations needed
Object o = xs.fromXML(xml);              // UNSAFE on untrusted input — see below
xs.alias("person", Person.class);        // or @XStreamAlias("person")
xs.aliasField("name", Person.class, "fullName");
xs.omitField(Person.class, "secret");    // or @XStreamOmitField
// @XStreamImplicit hoists a list, dropping the wrapper element
// JSON: JettisonMappedXmlDriver (both ways) or JsonHierarchicalStreamDriver (write-only)
```

**JiBX**: binding defined in external `customer-binding.xml` (not annotations); `extends`/`map-as` inheritance; requires the `maven-jibx-plugin` to compile bindings to bytecode at build time.

**Top gotchas**:

- **XStream `fromXML` on untrusted input is critical-severity RCE by default** — must install a default-deny allowlist (see `serialization/xml-xxe-security`).
- `@XStreamImplicit` changes the wire shape (drops the collection wrapper).
- `JsonHierarchicalStreamDriver` is **write-only** (read throws `UnsupportedOperationException`).
- XStream reflection serializes private fields, leaking internal state.
- JiBX won't run without the `maven-jibx-plugin` build step (bindings are XML compiled to bytecode).

**Current (mid-2026)**: **jackson-dataformat-xml is the safe mainstream object↔XML choice** today (over XStream/JiBX). XStream is security-patched to **1.4.21**; many shops migrated off it entirely. JiBX is abandoned (~2019 EOL; pulls EOL commons-lang v2).

## Full content

Three serializers compete with JAXB for object↔XML, at very different safety and maintenance profiles.

### jackson-dataformat-xml

`XmlMapper` exposes the full `ObjectMapper` API over XML — the same annotations, tree model, and streaming carry over (plus `@JacksonXmlRootElement`). It is the modern mainstream XML binder and the recommended default in 2026. Evidence: `jackson-conversions/.../xml/XMLSerializeDeserializeUnitTest.java`. Note the XML→JSON type-loss caveat (tree path drops scalar types) lives in `serialization/jackson-tree-streaming`.

### XStream

XStream is a zero-config reflection serializer: `new XStream().toXML/fromXML` round-trips any POJO with no annotations. It supports aliasing (`alias`/`aliasField` or `@XStreamAlias`), field omission (`omitField`/`@XStreamOmitField`), list hoisting (`@XStreamImplicit`, which changes the wire shape by dropping the wrapper), custom `Converter`/`SingleValueConverter`, and JSON via `JettisonMappedXmlDriver` (both directions) or `JsonHierarchicalStreamDriver` (write-only — read throws `UnsupportedOperationException`). Its convenience is also its danger: `fromXML` on untrusted input is RCE-by-default and reflection leaks private fields. Evidence: `xstream/.../utility/XStreamSimpleXmlIntegrationTest.java`, `xstream/.../utility/{MyDateConverter,MySingleValueConverter}.java`, `xstream/.../test/{XStreamJettisonIntegrationTest,XStreamJsonHierarchicalIntegrationTest}.java`. The RCE-and-hardening demo lives in `serialization/xml-xxe-security`.

### JiBX

JiBX defines its mapping in an external `customer-binding.xml` (not annotations), supports mapping inheritance (`extends`/`map-as`) and optional structures, and requires the `maven-jibx-plugin` to compile bindings into bytecode at build time. Evidence: `xml/.../jibx/*`, `xml/src/main/resources/customer-binding.xml`. It is abandoned.

### 2026 currency

- **jackson-dataformat-xml is the safe mainstream object↔XML choice** today (over XStream/JiBX). (carries forward unchanged from the base.)
- **XStream default `new XStream()` deserializing untrusted input is critical-severity RCE.** The ~Jul 2021 snapshot predates the Aug-2021 CVE wave (CVE-2021-39139..39154, fixed 1.4.18); the allowlist pattern is *more* mandatory now. Current security-patched release is **1.4.21** (CVE-2024-47072, `BinaryStreamDriver` DoS, fixed 1.4.21). Many shops migrated off XStream entirely. ([XStream Security Aspects — x-stream.github.io](https://x-stream.github.io/security.html), [XStream GHSA-hfq9-hggm-c56q](https://github.com/x-stream/xstream/security/advisories/GHSA-hfq9-hggm-c56q))
- **JiBX is abandoned (~2019 EOL)** and pulls EOL commons-lang v2 — do not seed for new work. (carries forward from the base.)
- The Jettison driver (XStream JSON) had its own post-snapshot DoS CVEs — pin/patch if reused. (carries forward from the base.)
