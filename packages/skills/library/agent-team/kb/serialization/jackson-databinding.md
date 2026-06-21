---
kb_id: serialization/jackson-databinding
version: 1
tags:
  - serialization
  - jackson
  - json
  - data-binding
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-simple"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-conversions"
  - "Jackson 3.0.0 GA released (cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a)"
related:
  - serialization/jackson-annotations
  - serialization/jackson-tree-streaming
  - serialization/jackson-custom-serializers
  - serialization/jackson-polymorphism-dates
  - serialization/gson
  - serialization/json-other-libraries
  - serialization/xml-serializers
  - serialization/protobuf
status: active
---

## Summary

**Concept**: `ObjectMapper` POJO data binding — the default Jackson path: reflection + annotations map a Java object to/from JSON.
**Key APIs**: `writeValueAsString` / `writeValue(File/OutputStream,..)`, `readValue(src, Cls)`, `readerFor(Cls)`, `TypeReference<List<T>>`, `getTypeFactory().constructCollectionType(...)`.
**Gotcha**: `readValue(json, List.class)` yields `LinkedHashMap` elements → `ClassCastException` — the #1 recurring serialization trap; use `TypeReference` or an array target.
**2026-currency**: Jackson 2.x (2.21/2.18 LTS, current 2.22.0) still dominant; Jackson 3.0 GA (Oct 2025) makes `ObjectMapper` immutable (builder-only) under `tools.jackson` namespace, Java 17 floor.
**Sources**: Baeldung `jackson-simple` / `jackson-conversions`; cowtowncoder Jackson 3.0 GA.

## Quick Reference

**Three reading targets** — the same `ObjectMapper` reads into POJO, tree, or typed collection:

```java
ObjectMapper mapper = new ObjectMapper();
String json = mapper.writeValueAsString(obj);          // serialize
MyDto dto  = mapper.readValue(json, MyDto.class);       // -> POJO
JsonNode node = mapper.readTree(json);                  // -> tree (see jackson-tree-streaming)
List<MyDto> list = mapper.readValue(json,
        new TypeReference<List<MyDto>>(){});            // -> typed collection (CORRECT way)
```

**Write variants**: `writeValueAsString(obj)`, `writeValue(file, obj)`, `writeValue(outputStream, obj)`, `writeValue(url, obj)`.
**Read variants**: `readValue(src, Cls)`, `readerFor(Cls).readValue(src)`, `readTree(src)`.

**Feature toggles** (configure the mapper):

- `configure(...)`, `enable/disable(SerializationFeature.X)`
- `setSerializationInclusion(Include.NON_NULL)`
- `setVisibility(PropertyAccessor.FIELD, Visibility.ANY)`
- `setDateFormat(...)`, `registerModule(...)`, `findAndRegisterModules()`

**Top gotchas**:

- **Raw-collection trap (the #1 pitfall)**: `readValue(jsonArray, List.class)` / `readValue(json, ArrayList.class)` produces `LinkedHashMap` elements → `ClassCastException` on access. Fix: `TypeReference<List<X>>`, `getTypeFactory().constructCollectionType(List.class, X.class)`, or target `X[].class`.
- Only public fields / fields-with-getters serialize by default; setter-only POJOs deserialize but do not serialize.
- Extra unknown JSON fields throw `UnrecognizedPropertyException` unless `disable(FAIL_ON_UNKNOWN_PROPERTIES)` (see jackson-custom-serializers exception catalog).

**Current (mid-2026)**: Treat **Jackson 2.x (2.18 / 2.21 LTS) as the dominant production line**, Jackson 3.0 as the forward path. In Jackson 3.0 `ObjectMapper` is **immutable** — configure only at construction via `JsonMapper.builder()...build()` (`rebuild()` for a reconfigured copy); `FAIL_ON_UNKNOWN_PROPERTIES` defaults **disabled** and dates serialize **ISO-8601** by default.

## Full content

Data binding is the default and highest-convenience Jackson processing model: a POJO maps to/from JSON via reflection plus annotations, with no per-field code. The core type is `ObjectMapper`; `writeValueAsString`/`writeValue` serialize, `readValue`/`readTree`/`readerFor` deserialize (evidence: `jackson-simple/.../objectmapper/JavaReadWriteJsonExampleUnitTest.java`).

### The three reading targets

Jackson's read methods funnel JSON into one of three shapes:

1. **POJO** — `readValue(src, MyDto.class)`, the binding path.
2. **Tree** — `readTree(src)` returns a `JsonNode` for CRUD-style navigation (see `serialization/jackson-tree-streaming`).
3. **Typed collection** — `readValue(json, new TypeReference<List<MyDto>>(){})` or `getTypeFactory().constructCollectionType(List.class, MyDto.class)` (evidence: `jackson-conversions/.../tocollection/JacksonCollectionDeserializationUnitTest.java`).

### Configuration surface

`ObjectMapper` is configured with `configure(...)`, `enable/disable(SerializationFeature.X)`, `setSerializationInclusion(Include.NON_NULL)`, `setVisibility(PropertyAccessor.FIELD, Visibility.ANY)`, `setDateFormat(...)`, and module registration (`registerModule(...)`, `findAndRegisterModules()`). Evidence: `jackson-simple/.../objectmapper/SerializationDeserializationFeatureUnitTest.java`.

### The raw-collection deserialization trap

The single most-repeated pitfall across the corpus (it appears in `gson`, `jackson-conversions`, and `jackson-conversions-2`): deserializing a JSON array into a raw `List.class` / `ArrayList.class` produces `LinkedHashMap` (Jackson) or `LinkedTreeMap` (Gson) elements, not your DTO — accessing them as the DTO throws `ClassCastException`. The fix is to carry the element type via `TypeReference<List<X>>`, `constructCollectionType`, or an array target `X[].class`. This is rooted in Java generics erasure (the super-type-token idiom).

### Field visibility

By default only public fields and fields with getters serialize; a getter enables write, a setter enables read but not write. Override with `setVisibility(PropertyAccessor.FIELD, Visibility.ANY)` or `@JsonAutoDetect(fieldVisibility=ANY)`. "Setter-only POJOs deserialize but do not serialize" is a frequent surprise.

### 2026 currency

- **Jackson 3.0 GA (Oct 3, 2025)** — first Jackson major in over a decade. New Maven group id + package namespace **`tools.jackson`** (was `com.fasterxml.jackson`), so 2.x and 3.x coexist on one classpath (exception: `jackson-annotations` stays under `com.fasterxml.jackson.annotation`). **Minimum Java 17.** **`ObjectMapper` is now immutable** — configured only at construction via builders (`JsonMapper.builder()...build()`, `rebuild()` for a copy). Flipped defaults that bite migrators: `FAIL_ON_UNKNOWN_PROPERTIES` defaults disabled, dates serialize ISO-8601 (no longer epoch-millis) — `WRITE_DATES_AS_TIMESTAMPS` is disabled in 3.0 (it was enabled in 2.x). (`USE_STD_BEAN_NAMING` was *removed* in 3.0, not flipped — 3.0 behavior matches 2.x-with-the-feature-enabled, so it does not bite migrators.) ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a), [MIGRATING_TO_JACKSON_3.md — GitHub](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md))
- **Current versions (mid-2026)**: Jackson 2.x at **2.22.0** (May 31, 2026); LTS **2.21** (Jan 18, 2026) and **2.18** (Sep 26, 2024). Treat 2.x as the still-dominant production line. ([Jackson Releases wiki — GitHub](https://github.com/FasterXML/jackson/wiki/Jackson-Releases))
- **`StreamReadConstraints` (2.15+, 2023)** — default-on bounds on nesting depth, number length, and string length; a must-configure parser-level DoS defense for untrusted input (the fix behind CVE-2025-52999). ([HeroDevs CVE-2025-52999](https://www.herodevs.com/blog-posts/cve-2025-52999-denial-of-service-via-stack-overflow-in-jackson-core))
- The raw-collection / `TypeReference` pitfall is timeless — pattern-stable across 2.x and 3.0.
