---
kb_id: serialization/json-other-libraries
version: 1
tags:
  - serialization
  - json
  - json-b
  - schema-validation
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: json"
  - "Baeldung tutorials (eugenp/tutorials) module: json-2"
  - "Jakarta JSON Binding 3.0 spec (jakarta.ee/specifications/jsonb/3.0/)"
  - "JSON validator comparison (creekservice.org/articles/2023/11/14/json-validator-comparison.html)"
related:
  - serialization/gson
  - serialization/json-querying
  - serialization/jackson-databinding
status: active
---

## Summary

**Concept**: The "other JSON libraries" survey — org.json, the JSR standards (JSON-P / JSON-B), FastJson, Jsoniter, Moshi, JSON-LD, JSON Schema validation, data-size optimization, and codegen.
**Key APIs**: org.json `JSONObject`/`JSONArray`/`JSONTokener`/`CDL`; JSON-B `JsonbBuilder.create()` + `@JsonbProperty`/`@JsonbTransient`/`JsonbAdapter`; everit `SchemaLoader.load` → `schema.validate(subject)`; FastJson `JSON.toJSONString`/`parseObject`; Moshi `Moshi.Builder().build().adapter(Type)`; `jsonschema2pojo` `SchemaMapper`.
**Gotcha**: FastJson 1.2.x autotype is a critical RCE liability (do not seed at this version); everit covers draft-04 only; FastJson `NameFilter` registers on a global singleton (leaks across tests).
**2026-currency**: `javax.json.*` → `jakarta.json.*` (JSON-P/JSON-B), Yasson 1.0.1 → 3.x; FastJson 1.x → FastJson 2; everit → erosb/json-sKema or networknt (draft 2020-12); Jsoniter abandoned, Moshi de-emphasized in Java.
**Sources**: Baeldung `json` / `json-2`; Jakarta JSON Binding 3.0 spec; Creek Service validator comparison.

## Quick Reference

**org.json (JSON-Java)**: `JSONObject`/`JSONArray`/`JSONTokener`/`CDL` (CSV ⇄ array). `optString` returns `""` vs `getString` throwing. Legacy/low-perf but ubiquitous.

**JSON-P (JSR-374, now `jakarta.json`)**: `Json.createPointer("/path")` for RFC-6901 JSON Pointer CRUD on a `JsonStructure` (see `serialization/json-querying`).

**JSON-B (JSR-367, now `jakarta.json.bind`, impl Yasson)**:

```java
Jsonb jsonb = JsonbBuilder.create();        // or with JsonbConfig
String json = jsonb.toJson(obj);
Foo foo = jsonb.fromJson(json, Foo.class);
// annotations: @JsonbProperty, @JsonbTransient, @JsonbDateFormat; custom JsonbAdapter
```

**JSON Schema validation (everit)**: `SchemaLoader.load(rawSchema)` → `schema.validate(subject)` throws `ValidationException` (draft-04).

**FastJson (Alibaba)**: `JSON.toJSONString`/`parseObject`; `ContextValueFilter`/`NameFilter` via global `SerializeConfig`. **Security caveat — see below.**

**Codegen**: `jsonschema2pojo` (`SchemaMapper` over a `JCodeModel`) generates POJOs from a JSON schema.

**Top gotchas**:

- **FastJson 1.2.21 is a security liability** — multiple critical autotype RCE CVEs; do not seed as a recommended library at this version.
- everit covers **draft-04 only** — two-plus drafts behind modern (2020-12).
- FastJson `NameFilter` registers on `SerializeConfig.getGlobalInstance()` — leaks config across tests unless reset.
- Jsoniter bind API does fuzzy coercion (`"1"` → `int 1`), masking malformed input.
- Many demo tests `System.out.println` without assertions (Moshi rename/transient, JSON-LD) — illustrative, not verifying.

**Current (mid-2026)**: JSON-P/JSON-B moved to the `jakarta.json` / `jakarta.json.bind` namespaces (Jakarta JSON Binding 3.0, Yasson 3.x). FastJson 1.x is deprecated; use FastJson 2. everit (draft-07 ceiling, maintenance mode) → erosb/json-sKema or `com.networknt:json-schema-validator` (draft 2020-12). Jsoniter is abandoned; Moshi is de-emphasized in Java (Jackson/Gson favored).

## Full content

This is the survey cluster: the JSON libraries beyond the deep Jackson/Gson coverage.

### Standards: org.json, JSON-P, JSON-B

`org.json` (JSON-Java) is the low-level, ubiquitous-but-slow grandfather: `JSONObject`/`JSONArray`/`JSONTokener`/`CDL` (CSV ⇄ array). Note `optString` returns `""` where `getString` throws. JSON-P (JSR-374) is the standardized parsing/streaming API; its `Json.createPointer` is the RFC-6901 JSON Pointer entry (see `serialization/json-querying`). JSON-B (JSR-367, reference impl Yasson) is the standardized Java EE binding analog of Jackson/Gson: `JsonbBuilder.create()`, `toJson`/`fromJson`, `JsonbConfig`, annotations `@JsonbProperty`/`@JsonbTransient`/`@JsonbDateFormat`, custom `JsonbAdapter`. Evidence: `json/.../jsonb/JsonbUnitTest.java`, `json/.../jsonpointer/JsonPointerCrud.java`, `json/.../jsonjava/*.java`.

### JSON Schema validation

The corpus uses everit: `SchemaLoader.load` → `schema.validate(subject)` throwing `ValidationException` (draft-04). Evidence: `json/.../schema/JSONSchemaUnitTest.java`.

### FastJson, Jsoniter, Moshi, JSON-LD

FastJson (Alibaba): `JSON.toJSONString`/`parseObject`, filters via a global `SerializeConfig` — fast but a security liability at 1.2.x. Jsoniter offers three styles (bind with fuzzy coercion, lazy `Any`, iterator pull) but is **abandoned**. Moshi (Square): `Moshi.Builder().build().adapter(Type)`, `@Json(name=)`, `@ToJson`/`@FromJson` — de-emphasized in Java. JSON-LD (linked data) emits `@context`/`@type`/`@id` via jackson-jsonld annotations or a Hydra `BeanSerializerModifier` — niche. Evidence: `json-2/.../{jsoniter,moshi,jsonld}/*`.

### Data-size optimization and codegen

`json-2` benchmarks size reductions: `Include.NON_NULL`, short field names, slim DTOs, a positional-array custom serializer (drop keys), and GZIP — measured as byte length and % vs default. Codegen: `jsonschema2pojo` (`SchemaMapper` over a `JCodeModel`) generates POJOs from a JSON schema. Evidence: `json-2/.../jsonoptimization/JsonOptimizationUnitTest.java`, `json-2/.../jsontojavaclass/JsonToJavaClassConversion.java`.

### 2026 currency

- **`javax.json.*` → `jakarta.json.*`; `javax.json.bind.*` → `jakarta.json.bind.*`.** The successor is **Jakarta JSON Binding 3.0** (Jakarta EE 10) with **Yasson 3.x** as the reference implementation; API `jakarta.json.bind:jakarta.json.bind-api:3.0.x`. ([Jakarta JSON Binding 3.0 spec — jakarta.ee](https://jakarta.ee/specifications/jsonb/3.0/), [Jakarta JSON Binding 3.0.0 release plan — projects.eclipse.org](https://projects.eclipse.org/projects/ee4j.jsonb/releases/3.0.0/plan))
- **FastJson 1.2.x is deprecated; FastJson 2 (2.0.x) is the supported successor** — a security-and-performance rewrite whose autotype is off by default with no built-in whitelist, addressing the structural cause of the 1.x CVE stream (CVE-2022-25845 autotype-bypass RCE, CVSS 8.1, ≤ 1.2.80; fixed 1.2.83 / `safeMode`). ([alibaba/fastjson — GitHub](https://github.com/alibaba/fastjson), [JFrog CVE-2022-25845 analysis](https://jfrog.com/blog/cve-2022-25845-analyzing-the-fastjson-auto-type-bypass-rce-vulnerability/))
- **everit JSON Schema is in maintenance mode (draft-07 ceiling).** Its own author built the successor **erosb/json-sKema** for modern drafts; **com.networknt:json-schema-validator** is the other live option — both support draft 2019-09 and **2020-12**, the drafts OpenAPI 3.1 aligns to. ([JSON validator comparison — Creek Service](https://www.creekservice.org/articles/2023/11/14/json-validator-comparison.html), [everit-org/json-schema — GitHub](https://github.com/everit-org/json-schema))
- **Abandoned / de-emphasized**: Jsoniter 0.9.23 (abandoned), Moshi 1.9.2 (Java favors Jackson/Gson), jackson-jsonld + hydra-jsonld (niche; canonical JSON-LD is `com.github.jsonld-java`), `jsonschema2pojo`/`com.sun.codemodel` (codegen displaced by runtime binding). (carries forward from the base.)
