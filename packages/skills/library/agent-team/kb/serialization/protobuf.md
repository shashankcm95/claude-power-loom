---
kb_id: serialization/protobuf
version: 1
tags:
  - serialization
  - protobuf
  - binary
  - schema-first
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: protobuffer"
  - "Protobuf Version Support (protobuf.dev/support/version-support/)"
  - "Protobuf news 2025-01-23 — Editions (protobuf.dev/news/2025-01-23/)"
related:
  - serialization/jackson-tree-streaming
  - serialization/jackson-databinding
status: active
---

## Summary

**Concept**: Protocol Buffers — schema-first binary serialization: a `.proto` schema compiles to immutable Java classes with a builder, round-tripped over binary streams.
**Key APIs**: `.proto` `message` with `required`/`optional`/`repeated` + explicit field tags (`= 1`); generated `Person.newBuilder().setX(..).addNumbers(..).build()`; `message.writeTo(OutputStream)`, `newBuilder().mergeFrom(InputStream).build()`; indexed repeated accessors `getPeople(0)`.
**Gotcha**: proto2 `required` cannot be safely removed later without breaking wire compatibility; the checked-in generated class can drift from the `.proto` (treat it as a build artifact).
**2026-currency**: protobuf-java current 4.35.x (3.25.x maintenance, EOL Mar 2027); Protobuf Editions (2023/2024) supersede the proto2-vs-proto3 syntax split with per-feature opt-in; protobuf-java 4.30.0+ dropped Java 8.
**Sources**: Baeldung `protobuffer`; protobuf.dev version-support + Editions news.

## Quick Reference

**proto2 schema**:

```proto
syntax = "proto2";
package tutorial;
option java_package = "com.baeldung.protobuf";
option java_outer_classname = "AddressBookProtos";

message Person {
  required string name = 1;          // explicit field tag
  required int32  id   = 2;
  repeated string numbers = 3;       // collection
}
```

**Codegen + builder round-trip**:

```java
Person p = Person.newBuilder()
    .setId(id).setName(n).addNumbers("...").build();   // immutable; builder mutates
addressBook.writeTo(outputStream);                     // serialize to binary
AddressBook ab = AddressBook.newBuilder()
    .mergeFrom(inputStream).build();                   // deserialize
Person first = ab.getPeople(0);                        // indexed repeated accessor
```

**Top gotchas**:

- proto2 `required` **cannot be safely removed later** without breaking wire compatibility.
- The checked-in generated class can drift from the `.proto` — treat it as a build artifact (regenerate, don't hand-edit).
- The corpus is a minimal proto2 serialization intro only — **no proto3, no gRPC, no schema evolution**.

**Current (mid-2026)**: protobuf-java is at **4.35.x** active (3.25.x maintenance, EOL Mar 31, 2027). **Protobuf Editions** (Edition 2023, Edition 2024) supersede the proto2-vs-proto3 *syntax* split with one evolving edition + per-feature opt-in, making field-presence an explicit feature rather than a syntax property. The Java runtime uses major **4.x** aligned to the unified release (release 35.x = runtime 4.35.x); **protobuf-java 4.30.0+ dropped Java 8 compatibility**. proto3 + gRPC remains the dominant idiom.

## Full content

Protocol Buffers is a schema-first binary format: you define messages in a `.proto`, compile to language classes, and round-trip compact binary. The corpus covers a minimal proto2 serialization intro.

### Schema and codegen

A proto2 `.proto` declares a `package`, `option java_package`/`java_outer_classname`, and a `message` with `required`/`optional`/`repeated` fields each carrying an explicit field tag (`= 1`); nested `repeated` fields model collections. The compiler generates an immutable Java class hierarchy plus a builder. Evidence: schema `protobuffer/.../resources/addressbook.proto`, generated `protobuffer/.../protobuf/AddressBookProtos.java`.

### Builder pattern and stream round-trip

Generated messages are immutable; you construct them via the builder (`Person.newBuilder().setX(..).addNumbers(..).build()`). Persist with `message.writeTo(OutputStream)` and load with `newBuilder().mergeFrom(InputStream).build()`. Repeated fields use indexed accessors (`getPeople(0)`). Evidence: `protobuffer/.../protobuf/ProtobufUnitTest.java`.

### Wire-compatibility caveat

proto2's `required` is a wire-compatibility trap: once shipped, removing or relaxing a `required` field breaks readers. The checked-in generated class is a build artifact that can drift from the `.proto` — regenerate rather than hand-edit. The corpus does not cover proto3, gRPC, or schema evolution.

### 2026 currency

- **Versions (mid-2026)**: protobuf-java **4.35.x** active; **3.25.x** maintenance (EOL Mar 31, 2027). The Java runtime major is **4.x**, aligned to the unified release minor (Protobuf release 35.x = Java runtime 4.35.x). ([Protobuf Version Support — protobuf.dev](https://protobuf.dev/support/version-support/))
- **Protobuf Editions (2024+)** supersede the proto2-vs-proto3 *syntax* split with a single evolving edition + per-feature opt-in (**Edition 2023**, Aug 13, 2024; **Edition 2024**, May 23, 2025) — directly relevant to the "proto2 `required` can't be safely removed" pitfall, since Editions make field-presence behavior an explicit feature, not a syntax property. Docs note "no concrete plans" to drop proto2/proto3 syntax. ([Protobuf news 2025-01-23 — protobuf.dev](https://protobuf.dev/news/2025-01-23/))
- **protobuf-java 4.30.0+ dropped Java 8 compatibility.** ([protobuf-java 4.30.0 Java-8 incompatibility — GitHub issue #20580](https://github.com/protocolbuffers/protobuf/issues/20580))
- **Jackson binary dataformats** (`jackson-dataformats-binary`: CBOR, Smile, Avro, Ion, Protobuf) expose the same streaming/databind/tree API over binary formats — filling the base's "Avro/CBOR/MessagePack not covered" gap from inside the Jackson API. ([FasterXML/jackson-dataformats-binary — GitHub](https://github.com/FasterXML/jackson-dataformats-binary))
- **Still gaps in 2026**: proto3 + gRPC end-to-end, schema registries (Confluent/Avro), protobuf schema evolution, and other binary formats (Thrift, MessagePack, Cap'n Proto, FlatBuffers, Kryo). proto3 + gRPC remains the dominant idiom, now alongside Editions. (carries forward from the base.)
