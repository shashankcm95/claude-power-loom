---
kb_id: serialization/jackson-custom-serializers
version: 1
tags:
  - serialization
  - jackson
  - json
  - custom-serializer
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-custom-conversions"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-exceptions"
  - "Jackson 3.0.0 GA released (cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a)"
related:
  - serialization/jackson-databinding
  - serialization/jackson-annotations
  - serialization/jackson-tree-streaming
  - serialization/jackson-polymorphism-dates
status: active
---

## Summary

**Concept**: Custom Jackson (de)serializers, conditional/criteria filtering, and the exception→fix catalog — escape hatches when annotations are not enough.
**Key APIs**: `extends StdSerializer<T>` / `StdDeserializer<T>`, register via `SimpleModule.addSerializer/addDeserializer` + `registerModule`, or pin with `@JsonSerialize(using=)`/`@JsonDeserialize(using=)`; `@JsonFilter` + `SimpleBeanPropertyFilter`; `BeanSerializerModifier` (Hidable pattern).
**Gotcha**: calling your own serializer on the same value → `StackOverflowError`; call the default via a `BeanSerializerModifier`-captured default or `SerializerProvider.defaultSerializeField`, never recurse.
**2026-currency**: custom (de)serializers + `BeanSerializerModifier` + `@JsonFilter` are pattern-stable across Jackson 2.x and 3.0; Jackson 3.0 flips `FAIL_ON_UNKNOWN_PROPERTIES` to disabled and dates to ISO-8601, resolving two of the corpus's exception/pitfall entries.
**Sources**: Baeldung `jackson-custom-conversions` + `jackson-exceptions`.

## Quick Reference

**Custom serializer / deserializer**:

```java
class ItemSerializer extends StdSerializer<Item> {
    public void serialize(Item v, JsonGenerator gen, SerializerProvider p) { ... }
}
class ItemDeserializer extends StdDeserializer<Item> {
    public Item deserialize(JsonParser jp, DeserializationContext ctx) {
        JsonNode node = jp.getCodec().readTree(jp);   // pull off JsonNode / IntNode
        ...
    }
}
mapper.registerModule(new SimpleModule().addSerializer(Item.class, new ItemSerializer()));
// or pin on the type: @JsonSerialize(using=ItemSerializer.class)
```

**Conditional / criteria serialization**:

- `@JsonFilter("name")` + `SimpleBeanPropertyFilter.serializeAllExcept(...)` (or override `serializeAsField`).
- *Hidable* pattern: a `BeanSerializerModifier` swaps in a serializer overriding `isEmpty()` so `Include.NON_EMPTY` drops it.

**Calling the default serializer** (4 correct ways; the anti-way = recursion → `StackOverflowError`): capture the default via a `BeanSerializerModifier`, or `SerializerProvider.defaultSerializeField(...)`.

**Jackson exception → fix catalog**:

| Exception | Fix |
|---|---|
| `Can not construct instance of` (abstract) | `@JsonDeserialize(as=Concrete.class)` |
| `No serializer found for class` (private fields) | `setVisibility(FIELD, ANY)` / `@JsonAutoDetect(fieldVisibility=ANY)` |
| `No suitable constructor found` | default constructor or `@JsonCreator` |
| `Root name does not match expected` | `@JsonRootName("user")` |
| `Can not deserialize instance of X out of START_ARRAY` | `TypeReference<List<X>>` |
| `UnrecognizedPropertyException` | `disable(FAIL_ON_UNKNOWN_PROPERTIES)` / `@JsonIgnoreProperties(ignoreUnknown=true)` |
| `Unexpected character` (single-quoted JSON) | `JsonParser.Feature.ALLOW_SINGLE_QUOTES` |

**Current (mid-2026)**: Custom (de)serializers and `BeanSerializerModifier` are pattern-stable across Jackson 2.x and 3.0. Jackson 3.0 disables `FAIL_ON_UNKNOWN_PROPERTIES` by default (so `UnrecognizedPropertyException` no longer fires out of the box) and serializes dates as ISO-8601.

## Full content

When annotations cannot express the mapping, extend `StdSerializer<T>` / `StdDeserializer<T>`. Register via `new SimpleModule().addSerializer(...)` + `registerModule`, or pin on the type with `@JsonSerialize(using=)` / `@JsonDeserialize(using=)`. Inside a deserializer, read with `parser.getCodec().readTree(parser)` and pull off `JsonNode`/`IntNode`. Evidence: `jackson-custom-conversions/.../serialization/ItemSerializer.java`, `.../deserialization/ItemDeserializer.java`, `jackson-simple/.../objectmapper/CustomCarSerializer.java`.

### Calling the default serializer from a custom one

A frequent need is to delegate part of the work back to the default serializer (e.g., serialize most of an object normally, then add a field). Calling your own serializer on the same value recurses infinitely → `StackOverflowError`. The corpus shows four correct ways (capturing the default via a `BeanSerializerModifier`, or `SerializerProvider.defaultSerializeField`) plus the anti-pattern. Evidence: `jackson-custom-conversions/.../defaultserializercustomserializer/CallingDefaultSerializerUnitTest.java`.

### Conditional / criteria serialization

`@JsonFilter` + `SimpleBeanPropertyFilter` (`serializeAllExcept`, or override `serializeAsField`) drops fields by criteria. The *Hidable* pattern uses a `BeanSerializerModifier` to swap in a serializer whose `isEmpty()` is overridden, so `Include.NON_EMPTY` then drops it. Evidence: `jackson-custom-conversions/.../skipfields/{IgnoreFieldsWithFilterUnitTest,JacksonDynamicIgnoreUnitTest}.java`.

### The exception → fix catalog

The `jackson-exceptions` module pairs each common Jackson failure with its remedy (evidence: `jackson-exceptions/.../JacksonExceptionsUnitTest.java`) — see the Quick Reference table. The most load-bearing entries are the abstract-type and private-field cases, and the `START_ARRAY` error which is the raw-collection trap surfacing as an exception.

### 2026 currency

- Custom (de)serializers, `BeanSerializerModifier`, and `@JsonFilter` are **pattern-stable** across Jackson 2.x and 3.0 (only namespace + immutability changed). ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
- **Two exception/pitfall entries are resolved in Jackson 3.0 by default flips**: `FAIL_ON_UNKNOWN_PROPERTIES` defaults **disabled** (so `UnrecognizedPropertyException` no longer fires on extra fields) and dates serialize **ISO-8601** (resolving the "default Date output is surprising" pitfall). ([MIGRATING_TO_JACKSON_3.md — GitHub](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md))
- In Jackson 3.0 `ObjectMapper` is immutable, so module registration moves to the builder (`JsonMapper.builder().addModule(...).build()`) — the same `SimpleModule`/`StdSerializer` types, configured at construction. ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
