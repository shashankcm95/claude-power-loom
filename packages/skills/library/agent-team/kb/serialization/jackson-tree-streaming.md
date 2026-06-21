---
kb_id: serialization/jackson-tree-streaming
version: 1
tags:
  - serialization
  - jackson
  - json
  - streaming
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jackson"
  - "Baeldung tutorials (eugenp/tutorials) module: jackson-conversions-2"
  - "Jackson 3.0.0 GA released (cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a)"
related:
  - serialization/jackson-databinding
  - serialization/jackson-annotations
  - serialization/jackson-custom-serializers
  - serialization/protobuf
status: active
---

## Summary

**Concept**: Jackson's two lower-convenience / higher-control processing models — the tree model (`JsonNode` CRUD) and the streaming API (token-by-token `JsonParser`/`JsonGenerator`).
**Key APIs**: tree — `readTree`, `valueToTree`/`treeToValue`, `createObjectNode`, `put`/`putObject`/`set`/`remove`, `path()` vs `get()`, `fields()`; streaming — `JsonFactory` → `JsonGenerator` (`writeStartObject`/`writeStringField`/`writeStartArray`), `JsonParser` (`nextToken`/`getCurrentName`/`getText`/`JsonToken`).
**Gotcha**: tree navigation — `path()` is missing-node-safe (returns `MissingNode`), `get()` returns null and NPEs on chained access; XML→JSON via the tree path loses scalar types (numbers become strings).
**2026-currency**: pattern-stable across Jackson 2.x and 3.0; `StreamReadConstraints` (2.15+) caps nesting/number/string length at the parser level for DoS defense.
**Sources**: Baeldung `jackson` / `jackson-conversions-2`; cowtowncoder Jackson 3.0 GA.

## Quick Reference

**The three processing models** (descending convenience / ascending control):

1. *Data binding* — POJO ⇄ JSON (the default; see `serialization/jackson-databinding`).
2. *Tree model* — `JsonNode`/`ObjectNode` CRUD.
3. *Streaming API* — low-level token read/write without loading the whole document.

**Tree model**:

```java
JsonNode root = mapper.readTree(json);
JsonNode name = root.path("user").path("name");  // missing-node-safe
ObjectNode obj = mapper.createObjectNode();
obj.put("id", 1).putObject("nested").put("k", "v");
obj.set("arr", arrNode); obj.remove("old");
root.fields().forEachRemaining(e -> ...);        // iterate
MyDto dto = mapper.treeToValue(node, MyDto.class);
JsonNode tree = mapper.valueToTree(dto);
```

- `path()` returns a `MissingNode` (safe to chain); `get()` returns `null` (NPEs on chained access).

**Streaming write**:

```java
JsonGenerator gen = new JsonFactory().createGenerator(out);
gen.writeStartObject();
gen.writeStringField("name", "x");
gen.writeStartArray(); ... gen.writeEndArray();
gen.writeEndObject(); gen.close();
```

**Streaming read** (token pull, partial extraction):

```java
JsonParser p = new JsonFactory().createParser(src);
JsonToken t;
while ((t = p.nextToken()) != null) {
    if (JsonToken.FIELD_NAME.equals(t)) { String f = p.getCurrentName(); ... }
}
```

**Top gotchas**:

- `path()` (safe) vs `get()` (null) — mixing them up causes NPEs on missing fields.
- XML→JSON via the **tree path** (`XmlMapper.readTree`) loses scalar types — `<petals>9</petals>` becomes string `"9"`; the data-binding path keeps numbers numeric.
- Streaming requires explicit `writeEnd*`/`close()`; mismatched tokens corrupt output.

**Current (mid-2026)**: Tree model (`JsonNode`) and streaming API (`JsonParser`/`JsonGenerator`) are pattern-stable across Jackson 2.x and 3.0. The parser-level **`StreamReadConstraints`** (2.15+) now bounds nesting depth, number length, and string length by default — a must-configure for untrusted streaming input.

## Full content

Beyond data binding, Jackson offers two models for cases binding can't serve: the tree model when the shape is dynamic or you need in-memory CRUD, and the streaming API when documents are too large to materialize or you only need partial extraction.

### Tree model

`readTree` parses JSON into a `JsonNode` tree; `valueToTree`/`treeToValue` convert between POJO and tree. Mutate an `ObjectNode` via `put`/`putObject`/`set`/`remove`; navigate with `path()` (returns a missing-node-safe `MissingNode`) over `get()` (returns null); iterate fields with `JsonNode.fields()`. Evidence: `jackson/.../node/NodeOperationUnitTest.java`, `jackson/.../node/JsonNodeIterator.java`.

### Streaming API

The lowest-level model: `JsonFactory` produces a `JsonGenerator` for writing (`writeStartObject`/`writeStringField`/`writeStartArray`/`writeEndObject`) and a `JsonParser` for reading. Reading is a token pull loop — `while ((t = parser.nextToken()) != null)` switching on `getCurrentName()` / `JsonToken` — which enables partial extraction without loading the whole document. Evidence: `jackson-conversions-2/.../streaming/StreamingAPIUnitTest.java`.

### The XML→JSON type-loss caveat

Converting XML to JSON has two paths with different fidelity: the **data-binding path** (`XmlMapper.readValue` → POJO → `ObjectMapper.writeValueAsString`) keeps numeric types, but the **tree path** (`XmlMapper.readTree`) loses scalar types (numbers become strings) because XML is untyped text. Use data binding when numeric fidelity matters. Evidence: `jackson-conversions-2/.../xmlToJson/XmlToJsonUnitTest.java`.

### 2026 currency

- Tree model and streaming API are **pattern-stable** across Jackson 2.x and 3.0 — only namespace (`tools.jackson` in 3.0) and `ObjectMapper` immutability changed. ([Jackson 3.0.0 GA — cowtowncoder](https://cowtowncoder.medium.com/jackson-3-0-0-ga-released-1f669cda529a))
- **`StreamReadConstraints` (2.15+, 2023)** — configurable, default-on bounds on nesting depth, number length, and string length, applied at the streaming/parser layer; this is the DoS defense behind **CVE-2025-52999** (DoS via deeply-nested JSON → stack overflow, CVSS 8.7), fixed by introducing a default max nesting depth of 1000. A new must-configure for untrusted input the 2021 corpus has no concept of. ([HeroDevs CVE-2025-52999](https://www.herodevs.com/blog-posts/cve-2025-52999-denial-of-service-via-stack-overflow-in-jackson-core))
- **Jackson binary dataformats** (`jackson-dataformats-binary`: CBOR, Smile, Avro, Ion, Protobuf) expose the same streaming/databind/tree API over binary formats via `CBORMapper`/`SmileMapper`/`AvroMapper` (2.10+) — the tree+streaming idioms here carry over to binary. ([FasterXML/jackson-dataformats-binary — GitHub](https://github.com/FasterXML/jackson-dataformats-binary))
