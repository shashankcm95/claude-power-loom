---
kb_id: serialization/jackson-polymorphism-dates
version: 1
tags:
  - serialization
  - jackson
  - json
  - polymorphism
  - date-time
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-conversions"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-annotations"
  - "CVE-2017-7525 polymorphic-deserialization remediation (ibm.com/docs/en/odm)"
  - "Jackson 3.0.0 GA released (cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a)"
related:
  - serialization/jackson-databinding
  - serialization/jackson-annotations
  - serialization/jackson-custom-serializers
  - serialization/xml-xxe-security
  - serialization/gson
status: active
---

## Summary

**Concept**: Jackson polymorphic (de)serialization of inheritance hierarchies + the most-repeated config theme, date/time handling — and the security-critical default-typing CVE class.
**Key APIs**: `@JsonTypeInfo(use=Id.NAME, include=As.PROPERTY, property="type")` + `@JsonSubTypes`/`@Type` + `@JsonTypeName`; custom `@JsonTypeIdResolver extends TypeIdResolverBase`; dates via `JavaTimeModule`/`findAndRegisterModules()`, `disable(WRITE_DATES_AS_TIMESTAMPS)`, `@JsonFormat(pattern=)`, `WRITE_DATES_WITH_ZONE_ID`.
**Gotcha**: `enableDefaultTyping()` is a polymorphic-deserialization gadget-RCE surface (CVE-2017-7525 + ~30 follow-ons) — replace with `activateDefaultTyping(PolymorphicTypeValidator)` + an explicit allowlist; `ZonedDateTime` silently drops its zone unless two flags are set.
**2026-currency**: default-typing risk remains live; `activateDefaultTyping(PTV)` is the mandatory mitigation; Jackson 3.0 serializes dates ISO-8601 by default; sealed classes are a type-safe alternative to `@JsonSubTypes`.
**Sources**: Baeldung `jackson-conversions`/`jackson-annotations`; IBM ODM CVE remediation; Jackson 3.0 GA.

## Quick Reference

**Polymorphism (the canonical pattern)**:

```java
@JsonTypeInfo(use = Id.NAME, include = As.PROPERTY, property = "type")
@JsonSubTypes({ @JsonSubTypes.Type(value = Car.class, name = "car") })
abstract class Vehicle { ... }
```

- Custom type-id mapping: `@JsonTypeInfo(use=Id.CUSTOM)` + `@JsonTypeIdResolver(MyResolver.class)` where `MyResolver extends TypeIdResolverBase`.

**Dates (the config cheat-sheet)**:

```java
// ISO-8601 (instead of default epoch-millis):
mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
mapper.setDateFormat(new StdDateFormat().withColonInTimeZone(true));
// java.time (JSR-310):
mapper.registerModule(new JavaTimeModule());   // or mapper.findAndRegisterModules();
// ZonedDateTime zone preservation (BOTH required):
mapper.enable(SerializationFeature.WRITE_DATES_WITH_ZONE_ID);
mapper.disable(DeserializationFeature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE);
// per-field pattern:
@JsonFormat(shape = STRING, pattern = "yyyy-MM-dd")
```

**Top gotchas**:

- **`enableDefaultTyping()` is a CVE-class RCE surface** (gadget-chain polymorphic deserialization) — deprecated; use `activateDefaultTyping(PolymorphicTypeValidator)` with an explicit allowlist.
- Default Date output is surprising: Jackson emits epoch-millis (`3600000`); locale/consumer-fragile.
- `ZonedDateTime` silently drops its zone unless both `WRITE_DATES_WITH_ZONE_ID` enabled AND `ADJUST_DATES_TO_CONTEXT_TIME_ZONE` disabled.
- Legacy `JodaModule` → use `JavaTimeModule` (JSR-310); `SimpleDateFormat` is not thread-safe (wrap in `ThreadLocal`).

**Current (mid-2026)**: Default-typing RCE remains live and correctly characterized; `activateDefaultTyping(PolymorphicTypeValidator)` is the required mitigation — it matters more now, not less. Jackson 3.0 serializes dates as ISO-8601 by default (resolving the epoch-millis surprise). Sealed class hierarchies (Java 17) are a type-safe alternative to `@JsonSubTypes`.

## Full content

### Polymorphism

Inheritance round-trips need a type discriminator on the wire. The canonical Jackson pattern is `@JsonTypeInfo(use=Id.NAME, include=As.PROPERTY, property="type")` paired with `@JsonSubTypes({@Type(value=Car.class, name="car")})`. For dynamic id mapping, `@JsonTypeInfo(use=Id.CUSTOM)` + `@JsonTypeIdResolver(MyResolver.class extends TypeIdResolverBase)`. Evidence: `jackson/.../inheritance/TypeInfoInclusionUnitTest.java`, `jackson-simple/.../annotation/Zoo.java`, `jackson-annotations/.../advancedannotations/TypeIdResolverStructure.java`.

### Date/time — the most-repeated config theme

Defaults are surprising: Jackson emits epoch-millis. ISO-8601 output requires `disable(WRITE_DATES_AS_TIMESTAMPS)` + a `StdDateFormat`. JSR-310 (`java.time`) support comes from `JavaTimeModule` (or `findAndRegisterModules()`, which auto-registers it) — preferred over the legacy `JodaModule`. `@JsonFormat(pattern=)` controls per-field rendering. `ZonedDateTime`'s zone is lost unless `WRITE_DATES_WITH_ZONE_ID` is enabled AND `ADJUST_DATES_TO_CONTEXT_TIME_ZONE` is disabled. Evidence: `jackson-conversions/.../date/JacksonDateUnitTest.java`, `jackson-custom-conversions/.../deserialization/CustomDeserializationUnitTest.java`. `SimpleDateFormat`-based adapters (JAXB/XStream) must be `ThreadLocal` (not thread-safe).

### The default-typing security surface

Global default typing (`enableDefaultTyping()`) lets a malicious payload name an arbitrary class to instantiate, enabling gadget-chain RCE. This is the structural cause of CVE-2017-7525 and ~30 follow-ons. The real fix is `activateDefaultTyping(PolymorphicTypeValidator)` with an explicit allowlist — never a denylist (blocklists are bypassable). See `serialization/xml-xxe-security` for the sibling insecure-deserialization surfaces (XStream, FastJson).

### 2026 currency

- **`ObjectMapper.enableDefaultTyping()` remains deprecated for CVE-class polymorphic-deserialization gadget risk.** The real mitigation is `activateDefaultTyping(PolymorphicTypeValidator)` with an explicit allowlist; blocklist fixes (2.9.10.x) are insufficient. CVE-2017-7525 + ~30 follow-ons (e.g. CVE-2020-10673). ([IBM ODM remediation](https://www.ibm.com/docs/en/odm/9.0.0?topic=remediation-polymorphic-deserialization-jackson-databind-in-xom), [CVE-2020-10673 — SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2020-10673/))
- **Jackson 3.0 serializes dates as ISO-8601 by default** (no longer epoch-millis), resolving the base's "default Date output is surprising" pitfall for 3.x. ([MIGRATING_TO_JACKSON_3.md — GitHub](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md))
- **Sealed-class polymorphism**: sealed hierarchies (JEP 409, Java 17) are now a type-safe alternative to `@JsonSubTypes`; Jackson 2.12+/3.0 support Records + sealed types. ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
- **JDK deserialization filtering** — JEP 415 Context-Specific Deserialization Filters (Java 17) builds on JEP 290 (Java 9) per-stream + JVM-wide filters, adding a JVM-wide filter factory invoked per `ObjectInputStream` — the modern answer to Java-native `readObject` gadget-chain RCE. ([JEP 415 — openjdk.org](https://openjdk.org/jeps/415), [Context-Specific Deserialization Filters — Baeldung](https://www.baeldung.com/java-context-specific-deserialization-filters))
- `JavaTimeModule` (JSR-310) is the forward-looking date path; the legacy `JodaModule` is superseded. (carries forward unchanged from the base.)
