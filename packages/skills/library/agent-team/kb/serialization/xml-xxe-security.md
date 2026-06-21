---
kb_id: serialization/xml-xxe-security
version: 1
tags:
  - serialization
  - xml
  - security
  - xxe
  - insecure-deserialization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: xml"
  - "Baeldung tutorials (eugenp/tutorials) module: xstream"
  - "XStream Security Aspects (x-stream.github.io/security.html)"
  - "CVE-2017-7525 polymorphic-deserialization remediation (ibm.com/docs/en/odm)"
related:
  - serialization/xml-parsing-jaxp
  - serialization/xml-serializers
  - serialization/jaxb-binding
  - serialization/jackson-polymorphism-dates
status: active
---

## Summary

**Concept**: The two demonstrated XML attack surfaces and their fixes — XXE (XML External Entity) injection on parse, and insecure-deserialization RCE (XStream `fromXML`).
**Key APIs**: XXE hardening — disable `disallow-doctype-decl`, `external-general-entities`, `external-parameter-entities`, set `FEATURE_SECURE_PROCESSING`, clear `ACCESS_EXTERNAL_DTD`/`ACCESS_EXTERNAL_STYLESHEET`, StAX `IS_SUPPORTING_EXTERNAL_ENTITIES=false`/`SUPPORT_DTD=false`; XStream — `addPermission(NoTypePermission.NONE)` then re-allow + `allowTypes(...)`.
**Gotcha**: a `<!ENTITY xxe SYSTEM "file:///etc/passwd">` payload triggers `SAXParseException` once hardened; `new XStream()` deserializing untrusted input is RCE-by-default — default-deny allowlist is mandatory.
**2026-currency**: both surfaces remain live and correctly characterized; XXE config is unchanged best practice; XStream allowlist matters more now (post-2021 CVE wave); the sibling Jackson default-typing RCE fix is `activateDefaultTyping(PolymorphicTypeValidator)`.
**Sources**: Baeldung `xml`/`xstream`; XStream Security Aspects; CVE-2017-7525 remediation.

## Quick Reference

**XXE hardening (the security-correct XML read config)** — disable on the factory:

```java
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
dbf.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
dbf.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
// StAX:
xif.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
xif.setProperty(XMLInputFactory.SUPPORT_DTD, false);
```

A `<!ENTITY xxe SYSTEM "file:///etc/passwd">` payload then triggers `SAXParseException`.

**XStream hardening (default-deny allowlist)**:

```java
XStream xs = new XStream();
xs.addPermission(NoTypePermission.NONE);          // deny everything first
xs.addPermission(NullPermission.NULL);
xs.addPermission(PrimitiveTypePermission.PRIMITIVES);
xs.allowTypes(new Class[]{ Person.class });       // re-allow only what you need
```

**Sibling surfaces** (cross-doc):

- **Jackson default typing** — `enableDefaultTyping()` is a gadget-RCE surface; fix with `activateDefaultTyping(PolymorphicTypeValidator)` + allowlist (see `serialization/jackson-polymorphism-dates`).
- **FastJson 1.x autotype** — autotype-bypass RCE; migrate to FastJson 2 (see `serialization/json-other-libraries`).

**Top gotchas**:

- An allowlist (default-deny) is correct; a blocklist is bypassable.
- XStream reflection serializes private fields, leaking internal state even before RCE.
- The XStream RCE demo's `com.sun.net.httpserver.HttpServer` is an internal JDK class — never a production server.

**Current (mid-2026)**: All three demonstrated surfaces (XXE, XStream RCE, Jackson default-typing) remain live and correctly characterized. XXE config is unchanged best practice; the XStream and Jackson allowlist mitigations matter more now, not less. New since the snapshot: parser-level input-size/depth constraints (Jackson `StreamReadConstraints`) as a first-class DoS defense.

## Full content

The corpus demonstrates two XML attack surfaces with runnable payloads and fixes — a rare and valuable combination.

### XXE (XML External Entity) injection

An untrusted XML document can declare an external entity (`<!ENTITY xxe SYSTEM "file:///etc/passwd">`) that a naive parser resolves, leaking local files or enabling SSRF. The fix hardens the parser factory: disable DOCTYPE declarations and external general/parameter entities, enable `FEATURE_SECURE_PROCESSING`, and clear the `ACCESS_EXTERNAL_DTD`/`ACCESS_EXTERNAL_STYLESHEET` attributes; for StAX, set `IS_SUPPORTING_EXTERNAL_ENTITIES=false` and `SUPPORT_DTD=false`. A hardened parser throws `SAXParseException` on the payload. Evidence: `xml/.../attribute/*Transformer.java`, `xml/.../attribute/JaxpProcessorUnitTest.java`. This applies to all of JAXB and JAXP parsing (see `serialization/xml-parsing-jaxp`, `serialization/jaxb-binding`).

### Insecure-deserialization RCE (XStream)

XStream's `fromXML` instantiates whatever class the XML names. On untrusted input this is critical-severity RCE by default — a crafted payload constructs a gadget chain. The fix is a default-deny allowlist: `addPermission(NoTypePermission.NONE)` to deny everything, then re-allow nulls, primitives, and an explicit `allowTypes(new Class[]{...})`. Evidence: `xstream/.../rce/App.java` (`createHardened`), `xstream/.../rce/AppUnitTest.java`, payloads `xstream/.../resources/{attack,calculator-attack}.xml`.

### The cross-cutting lesson

All format deserializers that instantiate arbitrary types share this RCE class: XStream default, Jackson default-typing, FastJson autotype, and Java-native `readObject`. The universal mitigation is an explicit allowlist (default-deny), never a blocklist. This is the format-format face of the broader "never deserialize untrusted data" rule.

### 2026 currency

- **The three demonstrated attack surfaces (XXE, XStream RCE, Jackson default-typing) all remain live and correctly characterized.** ([XStream Security Aspects — x-stream.github.io](https://x-stream.github.io/security.html))
- **XXE-hardening config is still best practice in 2026** — nothing in the JAXP secure-processing model changed to obsolete it (sourced negatively; flagged as inference). ([XStream Security Aspects — x-stream.github.io](https://x-stream.github.io/security.html))
- **XStream allowlist (`NoTypePermission.NONE` + `allowTypes`) is more mandatory now** — the snapshot predates the Aug-2021 CVE wave (CVE-2021-39139..39154, fixed 1.4.18); current patched release 1.4.21 (CVE-2024-47072). ([XStream Security Aspects — x-stream.github.io](https://x-stream.github.io/security.html))
- **Jackson `activateDefaultTyping(PolymorphicTypeValidator)`** is the required mitigation for the default-typing CVE class (CVE-2017-7525 + ~30 follow-ons) — blocklist fixes are insufficient. ([IBM ODM remediation](https://www.ibm.com/docs/en/odm/9.0.0?topic=remediation-polymorphic-deserialization-jackson-databind-in-xom))
- **New security primitive**: Jackson `StreamReadConstraints` (2.15+) bakes input-size/depth limits into the parser — a DoS defense the 2021 corpus has no concept of (CVE-2025-52999). ([HeroDevs CVE-2025-52999](https://www.herodevs.com/blog-posts/cve-2025-52999-denial-of-service-via-stack-overflow-in-jackson-core))
- **JDK deserialization filtering** — JEP 415 Context-Specific Deserialization Filters (Java 17), building on JEP 290, is the modern answer to Java-native `readObject` gadget-chain RCE. ([JEP 415 — openjdk.org](https://openjdk.org/jeps/415), [Context-Specific Deserialization Filters — Baeldung](https://www.baeldung.com/java-context-specific-deserialization-filters))
