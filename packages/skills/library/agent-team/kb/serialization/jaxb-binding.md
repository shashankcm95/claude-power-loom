---
kb_id: serialization/jaxb-binding
version: 1
tags:
  - serialization
  - xml
  - jaxb
  - jakarta
  - data-binding
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jaxb"
  - "Baeldung tutorials (eugenp/tutorials) module: xml"
  - "Jakarta XML Binding 4.0 spec (jakarta.ee/specifications/xml-binding/4.0/)"
  - "JAXB Modules removed in Java 11 (omnifish.ee/developers/jakartaee/removed-in-java-11/xml-bind-modules/)"
related:
  - serialization/xml-serializers
  - serialization/xml-parsing-jaxp
  - serialization/xml-xxe-security
status: active
---

## Summary

**Concept**: JAXB — annotation-driven object ⇄ XML binding (the JSR/Jakarta standard), plus xjc schema-first codegen.
**Key APIs**: `@XmlRootElement`/`@XmlType(propOrder)`/`@XmlElement`/`@XmlAttribute`/`@XmlTransient`/`@XmlAccessorType`; `JAXBContext.newInstance` → `createMarshaller()`/`createUnmarshaller()`, `JAXB_FORMATTED_OUTPUT`; custom `XmlAdapter<Value,Bound>` + `@XmlJavaTypeAdapter`; **xjc** (XSD → generated package).
**Gotcha**: JAXB was removed from the JDK in Java 11 (JEP 320) — won't compile/run on a current JDK without an explicit dependency; needs `@XmlType(propOrder)` for deterministic element order; `SimpleDateFormat` adapters must be `ThreadLocal`.
**2026-currency**: successor is Jakarta XML Binding 4.0 under `jakarta.xml.bind.*`; runtime moved `com.sun.xml.bind` → `org.glassfish.jaxb:jaxb-runtime`; requires Java SE 11+.
**Sources**: Baeldung `jaxb` / `xml`; Jakarta XML Binding 4.0 spec; OmniFish JEP-320 note.

## Quick Reference

**Round-trip lifecycle**:

```java
JAXBContext ctx = JAXBContext.newInstance(Book.class);
Marshaller m = ctx.createMarshaller();
m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, true);
m.marshal(book, file);
Book b = (Book) ctx.createUnmarshaller().unmarshal(reader);
```

**POJO annotations**:

```java
@XmlRootElement(name = "book")
@XmlType(propOrder = {"id", "name"})   // REQUIRED for stable element order
class Book {
    @XmlAttribute private int id;
    @XmlElement(name = "title") private String name;
    @XmlTransient private String secret;
}
```

**Custom binding** (non-natively-bindable types — `Date`, `LocalDateTime`):

```java
class DateAdapter extends XmlAdapter<String, Date> { ... }   // thread-safe via ThreadLocal
@XmlJavaTypeAdapter(DateAdapter.class) private Date published;
```

- Three date strategies: default `XMLGregorianCalendar`; `XmlAdapter<String,Date>`; Java-8 `XmlAdapter<String,LocalDateTime>`.

**Codegen (xjc)**: XSD → `gen/` package with `@XmlSchema` package-info + `ObjectFactory`.

**Top gotchas**:

- **JAXB removed from the JDK in Java 11 (JEP 320)** — add `jakarta.xml.bind-api` + `jaxb-runtime` explicitly.
- `@XmlType(propOrder)` is **required** for deterministic element order.
- `SimpleDateFormat`-based adapters are not thread-safe → wrap in `ThreadLocal`; date tests force `TimeZone.setDefault(UTC)` for reproducibility.

**Current (mid-2026)**: Successor is **Jakarta XML Binding 4.0** (Jakarta EE 10) under `jakarta.xml.bind.*`: API `jakarta.xml.bind:jakarta.xml.bind-api:4.0.x`, runtime `org.glassfish.jaxb:jaxb-runtime` 4.0.x (package `org.glassfish.jaxb.runtime`), Java SE 11+.

## Full content

JAXB binds annotated POJOs to/from XML through a `JAXBContext` that produces a `Marshaller` and `Unmarshaller`. Evidence: `jaxb/.../Book.java`, `jaxb/.../test/JaxbIntegrationTest.java`.

### Annotations and lifecycle

`@XmlRootElement(name)` marks the root; `@XmlType(propOrder={...})` fixes element order (without it order is unspecified); `@XmlElement(name=)`/`@XmlAttribute` bind members; `@XmlTransient` excludes; `@XmlAccessorType` sets the default access. The lifecycle is `JAXBContext.newInstance(Cls)` → `createMarshaller()` (set `JAXB_FORMATTED_OUTPUT`) → `marshal(obj, target)`, and `createUnmarshaller().unmarshal(source)` for the reverse.

### Custom binding and dates

Types JAXB can't bind natively (Date, LocalDateTime) use `XmlAdapter<Value,Bound>` + `@XmlJavaTypeAdapter`. The corpus shows three date strategies: the default `XMLGregorianCalendar`, an `XmlAdapter<String,Date>` (made thread-safe via `ThreadLocal` because `SimpleDateFormat` is not thread-safe), and a Java-8 `XmlAdapter<String,LocalDateTime>`. Evidence: `jaxb/.../DateAdapter.java`, `jaxb/.../dateunmarshalling/*`.

### Schema-first codegen (xjc)

`xjc` generates a Java package from an XSD — `@XmlSchema` package-info plus an `ObjectFactory`. Evidence: `jaxb/.../gen/UserResponse.java`, `jaxb/src/main/resources/user.xsd`. The corpus does not cover advanced customization binding (`.xjb`) depth.

### 2026 currency

- **JAXB was removed from the JDK in Java 11 (JEP 320)** — `javax.xml.bind.*` is not on a current JDK and must be added as an explicit dependency. ([JAXB Modules removed in Java 11 — OmniFish](https://omnifish.ee/developers/jakartaee/removed-in-java-11/xml-bind-modules/))
- **Successor = Jakarta XML Binding 4.0** (Jakarta EE 10) under `jakarta.xml.bind.*`: API artifact `jakarta.xml.bind:jakarta.xml.bind-api:4.0.x`; runtime moved from `com.sun.xml.bind` to `org.glassfish.jaxb:jaxb-runtime` (package `org.glassfish.jaxb.runtime`); requires Java SE 11+. ([Jakarta XML Binding 4.0 spec — jakarta.ee](https://jakarta.ee/specifications/xml-binding/4.0/), [Eclipse Implementation of JAXB 4.0.0 — projects.eclipse.org](https://projects.eclipse.org/projects/ee4j.jaxb-impl/releases/4.0.0/plan))
- **`XMLGregorianCalendar` → `java.time` adapters** is the forward-looking date path; `SimpleDateFormat` → `DateTimeFormatter`. (carries forward from the base.)
- The mainstream object↔XML choice today is **jackson-dataformat-xml** (`XmlMapper`) over JAXB for many projects — see `serialization/xml-serializers`.
