---
kb_id: serialization/json-querying
version: 1
tags:
  - serialization
  - json
  - jsonpath
  - json-pointer
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: json-path"
  - "Baeldung tutorials (eugenp/tutorials) module: json"
  - "JSON Schema draft 2020-12 / validator comparison (creekservice.org/articles/2023/11/14/json-validator-comparison.html)"
related:
  - serialization/json-other-libraries
  - serialization/xml-parsing-jaxp
status: active
---

## Summary

**Concept**: Querying JSON without full deserialization — JSONPath (Jayway) for path-expression extraction and JSON Pointer (RFC 6901, JSON-P) for single-node addressing/CRUD.
**Key APIs**: JSONPath `JsonPath.read(json, "$...")` / stateful `JsonPath.parse(json).read(path)`, predicates (`Filter`+`Criteria`, `Predicate`, inline `[?(@.price > 20)]`), `$.length()`, `Option.AS_PATH_LIST`, typed `read(path, Long.class)`; JSON Pointer `Json.createPointer("/path")`.
**Gotcha**: JsonPath inline filters mix relative `@` and absolute `$` — getting it wrong silently returns empty; array results are `net.minidev.json.JSONArray`, not a `List`; JSON Pointer paths must escape per RFC 6901 (`~0`=`~`, `~1`=`/`).
**2026-currency**: Jayway JsonPath stays current and widely used (also in Spring MockMvc `jsonPath(...)`); JSON Pointer is the `jakarta.json` namespace under Jakarta EE.
**Sources**: Baeldung `json-path` / `json` modules.

## Quick Reference

**JSONPath (Jayway)**:

```java
String name = JsonPath.read(json, "$.store.book[0].title");
// stateful (compile once, read many):
DocumentContext ctx = JsonPath.parse(json);
List<String> titles = ctx.read("$.store.book[*].title");
// predicates — three ways:
Filter f = Filter.filter(Criteria.where("price").gt(20));
List<?> r1 = JsonPath.read(json, "$.store.book[?]", f);
List<?> r2 = JsonPath.read(json, "$.store.book[?(@.price > 20)]");  // inline
// counting / typed / path-list:
int n = JsonPath.read(json, "$..book.length()");
Long id = JsonPath.read(json, "$.id", Long.class);
List<String> paths = JsonPath.using(conf.addOptions(Option.AS_PATH_LIST)).parse(json).read("$..author");
```

- Notation: bracket `['x']` or dot `.x`; wildcard `[*]`; descendant `$..`; operators `in`/`==`/`&&`.

**JSON Pointer (RFC 6901, JSON-P)**:

```java
JsonPointer ptr = Json.createPointer("/users/0/name");
JsonValue v = ptr.getValue(jsonStructure);   // get/add/replace/remove CRUD
```

**Top gotchas**:

- Inline filters mix relative `@` (current node) and absolute `$` (root) — wrong one **silently returns empty**.
- JSONPath array results are `net.minidev.json.JSONArray`, not `java.util.List`.
- JSON Pointer paths must escape per RFC 6901: `~0` = `~`, `~1` = `/`.

**Current (mid-2026)**: Jayway JsonPath is still current, stable, and widely used — also embedded in Spring `MockMvc` (`jsonPath(...)`). JSON Pointer lives under the `jakarta.json` namespace now (Jakarta EE 9+). Not covered by the corpus: JSON Patch / JSON Merge Patch.

## Full content

JSON querying extracts or addresses values without binding the whole document to a POJO.

### JSONPath (Jayway)

`JsonPath.read(json, "$...")` is the one-shot read; the stateful `JsonPath.parse(json).read(path)` compiles the document once for repeated reads. Path syntax supports bracket/dot notation, wildcards `[*]`, descendant axis `$..`, operators (`in`/`==`/`&&`), counting (`$.length()`), typed reads (`read(path, Long.class)`), and `Option.AS_PATH_LIST` to return matched paths rather than values. Predicates come three ways: a `Filter` + `Criteria` object, a custom `Predicate`, or an inline `[?(@.price > 20)]`. Arrays come back as `net.minidev.json.JSONArray` (not `List`). The same `jsonPath(...)` matcher is embedded in Spring `MockMvc`. Evidence: `json-path/.../introduction/{JsonPathUnitTest,OperationIntegrationTest,ServiceIntegrationTest}.java`.

### JSON Pointer (RFC 6901)

JSON-P's `Json.createPointer("/path")` addresses a single node in a `JsonStructure` for get/add/replace/remove CRUD. Path tokens must escape per RFC 6901: `~0` denotes a literal `~` and `~1` denotes a literal `/`. Evidence: `json/.../jsonpointer/JsonPointerCrud.java` (see also `serialization/json-other-libraries` for the JSON-P standard).

### 2026 currency

- **Jayway JsonPath remains current and widely used** — stable API, also embedded in Spring `MockMvc`. (carries forward unchanged from the base.)
- **JSON Pointer (JSON-P) moved to the `jakarta.json` namespace** (`javax.json.*` → `jakarta.json.*`, Jakarta EE 9+). ([Jakarta JSON Binding 3.0 spec — jakarta.ee](https://jakarta.ee/specifications/jsonb/3.0/))
- **Not covered (gaps)**: JSON Patch / JSON Merge Patch (mutation diff formats). JSON Schema querying/validation context has moved to draft 2020-12 (see `serialization/json-other-libraries`). ([JSON validator comparison — Creek Service](https://www.creekservice.org/articles/2023/11/14/json-validator-comparison.html))
