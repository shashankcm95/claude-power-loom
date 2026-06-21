---
kb_id: serialization/jackson-annotations
version: 1
tags:
  - serialization
  - jackson
  - json
  - annotations
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-simple"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-annotations"
  - "Jackson Release 2.18 wiki (github.com/FasterXML/jackson/wiki/Jackson-Release-2.18)"
related:
  - serialization/jackson-databinding
  - serialization/jackson-tree-streaming
  - serialization/jackson-custom-serializers
  - serialization/jackson-polymorphism-dates
status: active
---

## Summary

**Concept**: The Jackson annotation catalog — the largest concept cluster: declarative control over naming, inclusion, structure, and binding of POJO ⇄ JSON.
**Key APIs**: `@JsonProperty`/`@JsonAlias`/`@JsonNaming`, `@JsonIgnore`/`@JsonIgnoreProperties(ignoreUnknown=true)`/`@JsonInclude`, `@JsonGetter`/`@JsonValue`/`@JsonAnyGetter`, `@JsonCreator`/`@JsonAnySetter`, `@JsonFormat`/`@JsonUnwrapped`/`@JsonView`; MixIns via `mapper.addMixIn(Target.class, MixIn.class)`.
**Gotcha**: `@JsonRootName` is inert unless `SerializationFeature.WRAP_ROOT_VALUE` is enabled; `@JsonPropertyDescription` is only observable via schema generation, not normal serialization.
**2026-currency**: catalog is pattern-stable across Jackson 2.x and 3.0; `jackson-annotations` keeps the `com.fasterxml.jackson.annotation` namespace even in 3.0 so the same annotations work with both.
**Sources**: Baeldung `jackson-simple` (37-test tour) + `jackson-annotations`; Jackson 2.18 release wiki.

## Quick Reference

**Grouped by phase**:

- **Serialization**: `@JsonAnyGetter` (Map → flat top-level props), `@JsonGetter`, `@JsonPropertyOrder`, `@JsonRawValue` (embed raw unescaped JSON), `@JsonValue` (one method represents the whole object — the enum idiom), `@JsonRootName` (+ `WRAP_ROOT_VALUE`), `@JsonSerialize`.
- **Deserialization**: `@JsonCreator` (constructor/factory for mismatched names), `@JacksonInject` (+ `InjectableValues.Std`), `@JsonAnySetter` (catch-all → Map), `@JsonSetter`, `@JsonDeserialize`.
- **Inclusion / ignore**: `@JsonIgnore`, `@JsonIgnoreProperties(ignoreUnknown=true)`, `@JsonIgnoreType`, `@JsonInclude(NON_NULL/NON_DEFAULT/NON_EMPTY)`, `@JsonAutoDetect(fieldVisibility=ANY)`.
- **Naming / aliasing**: `@JsonProperty` (rename), `@JsonAlias` (accept multiple input names on read), `@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy)`.
- **Structure**: `@JsonFormat` (date/enum shape+pattern+locale), `@JsonUnwrapped` (flatten nested), `@JsonView`, `@JsonFilter`, `@JsonAppend`, `@JsonIdentityReference(alwaysAsId=true)`, `@JsonPropertyDescription`, `@JsonPOJOBuilder`.
- **Meta**: compose via `@JacksonAnnotationsInside`; disable all via `MapperFeature.USE_ANNOTATIONS`; **MixIn** (`mapper.addMixIn(Target.class, MixIn.class)`) to annotate classes you cannot modify.

**Immutable / builder deserialization**: `@JsonCreator(mode=PROPERTIES)` + `@JsonProperty` constructor, or `@JsonDeserialize(builder=)` + `@JsonPOJOBuilder(buildMethodName, withPrefix)`.

**Multiple input names → one field**: `@JsonAlias` (read-side).

**Top gotchas**:

- `@JsonRootName` is **inert** unless `SerializationFeature.WRAP_ROOT_VALUE` is enabled.
- `@JsonPropertyDescription` is observable **only through schema generation**, not normal serialization.
- MixIn API churned across Jackson 2.7.x (commented-out `@Ignore` markers in the corpus attest).
- Naming-strategy rename: `PropertyNamingStrategy.SnakeCaseStrategy` → `PropertyNamingStrategies.SnakeCaseStrategy` (Jackson 2.12).

**Current (mid-2026)**: The catalog is pattern-stable. In Jackson 3.0 the annotations module deliberately stays under `com.fasterxml.jackson.annotation` so a single annotation set works for both 2.x and 3.x. `PropertyNamingStrategies` (plural) is the current 2.x idiom.

## Full content

The annotation catalog is the single largest concept cluster in the Jackson surface — the corpus tours it with a 37-test sweep in `jackson-simple`. Annotations give declarative, per-field/per-class control without writing custom (de)serializers (evidence: `jackson-simple/.../annotation/JacksonAnnotationUnitTest.java`, `.../annotation/{Zoo,ExtendableBean,BeanWithCustomAnnotation}.java`; `jackson-annotations/.../advancedannotations/AdvancedAnnotationsUnitTest.java`).

### Naming and aliasing

`@JsonProperty("name")` renames a field on the wire. `@JsonAlias({"a","b"})` accepts multiple input names on read (mapping to one field). `@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)` applies a class-wide naming convention.

### Inclusion / ignore

`@JsonIgnore` drops a field; `@JsonIgnoreProperties(ignoreUnknown=true)` tolerates extra JSON fields on read; `@JsonInclude(Include.NON_NULL/NON_DEFAULT/NON_EMPTY)` conditions output. `@JsonAutoDetect(fieldVisibility=ANY)` exposes private fields.

### Structure and binding

`@JsonFormat(shape=, pattern=, locale=)` controls date/enum rendering; `@JsonUnwrapped` flattens a nested object into the parent; `@JsonView` partitions fields into named views (see jackson-databinding). For immutable types, bind via `@JsonCreator(mode=PROPERTIES)` on a constructor with `@JsonProperty` params, or `@JsonDeserialize(builder=...)` + `@JsonPOJOBuilder(buildMethodName, withPrefix)` (evidence: `jackson-conversions/.../immutable/ImmutableObjectDeserializationUnitTest.java`).

### Catch-all and dynamic shapes

`@JsonAnyGetter` flattens a `Map` into top-level properties on write; `@JsonAnySetter` captures unknown fields into a `Map` on read — one of three ways to capture unknown shape (the others: an embedded `JsonNode` field, or a `Map<String,Object>` field). Evidence: `jackson-conversions-2/.../dynamicobject/DynamicObjectDeserializationUnitTest.java`.

### MixIns — annotating classes you cannot modify

`mapper.addMixIn(Target.class, MixInClass.class)` applies a MixIn class's annotations to a target you cannot edit (third-party types). All annotations can be disabled wholesale via `MapperFeature.USE_ANNOTATIONS`. Compose multiple annotations into one meta-annotation with `@JacksonAnnotationsInside`.

### 2026 currency

- The annotation catalog is **pattern-stable** across Jackson 2.x and 3.0 — only namespace, `ObjectMapper` immutability, and flipped defaults changed at 3.0. ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
- **`jackson-annotations` keeps `com.fasterxml.jackson.annotation`** even in Jackson 3.0 (the rest of Jackson moved to `tools.jackson`), so the same annotations work with both majors on one classpath. ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
- **Naming-strategy rename stands**: `PropertyNamingStrategy.SnakeCaseStrategy` → `PropertyNamingStrategies.SnakeCaseStrategy` (Jackson 2.12) is the current 2.x idiom. ([Jackson Release 2.18 wiki — GitHub](https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.18))
- **Record + sealed-class binding**: Jackson 2.12+ supports Java Record deserialization natively, and 3.0 leans on Records via its Java 17 floor; sealed hierarchies are now a type-safe alternative to `@JsonSubTypes` polymorphism. ([JDK 25 — openjdk.org](https://openjdk.org/projects/jdk/25/), [Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
