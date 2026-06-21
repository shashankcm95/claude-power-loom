---
kb_id: jvm-languages/groovy-sql-jdbc
version: 1
tags:
  - jvm-languages
  - groovy
  - jdbc
  - security
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-groovy"
  - "groovy.sql.Sql API (latest) (https://docs.groovy-lang.org/latest/html/api/groovy/sql/Sql.html)"
related:
  - jvm-languages/groovy-language-core
  - jvm-languages/groovy-metaprogramming
status: active
---

## Summary

**Concept**: Groovy database access via `groovy.sql.Sql` — auto-closing lifecycle, the injection-safe GString-parameter idiom, and the transaction-rollback contract.
**Key APIs**: `Sql.newInstance` / `withInstance{}`; `execute` / `executeInsert` (keys) / `executeUpdate` (rows) / `eachRow{GroovyResultSet}` / `rows(q, offset, max)`; params positional `?`, named `:name`, or GString `${name}`; `withTransaction{}` vs `cacheConnection{}`.
**Gotcha**: a GString `${name}` in an SQL string becomes a **prepared-statement parameter** (injection-safe), NOT string interpolation; `cacheConnection{}` does NOT roll back on exception — only `withTransaction{}` does.
**2026-currency**: API unchanged through Groovy 5.0 (`groovy-sql` is now a split module under `org.apache.groovy`); injection-safety confirmed in current API docs.
**Sources**: `core-groovy` module; `groovy.sql.Sql` latest API docs.

## Quick Reference

**Lifecycle** — `newInstance` (manual close) or `withInstance{}` (auto-close):

```groovy
Sql.withInstance(url, user, pass, driver) { sql ->
    // sql auto-closed at block exit
}
```

**CRUD operations**:

```groovy
sql.execute("CREATE TABLE ...")
def keys = sql.executeInsert("INSERT INTO author (name) VALUES (${name})")  // returns generated keys
def rows = sql.executeUpdate("UPDATE ...")                                   // returns affected-row count
sql.eachRow("SELECT * FROM author") { row -> row.name }                     // GroovyResultSet
sql.rows("SELECT * FROM author", offset, max)                               // paged
```

**Parameter binding** — three styles, all parameterized:

- Positional: `sql.execute("... = ?", [value])`
- Named: `sql.execute("... = :name", [name: value])`
- **GString**: `sql.execute("... VALUES (${name})")` — the `${name}` is **converted to a prepared-statement placeholder under the covers**, NOT inlined into the SQL text. This is the injection-safe idiom and it relies on the lazy-GString mechanism (see `jvm-languages/groovy-language-core`).

**Transactions** (the rollback contract):

| Block | Rolls back on exception? |
|---|---|
| `withTransaction{}` | YES |
| `cacheConnection{}` | NO (data persists) |

Easy to assume both are transactional — only `withTransaction{}` is.

**Current (mid-2026)**: `groovy.sql.Sql` is unchanged through Groovy 5.0.6; it now ships as the `groovy-sql` split module under the `org.apache.groovy` groupId. The injection-safe GString behaviour is documented verbatim in the latest API docs.

## Full content

`groovy.sql.Sql` is Groovy's thin, idiomatic JDBC facade.

**Lifecycle** is managed either manually (`Sql.newInstance(...)` + explicit `close()`) or with the auto-closing `withInstance{}` block. Evidence: `groovy/sql/SqlTest.groovy`.

**Operations** map cleanly to JDBC intent: `execute` for DDL/arbitrary statements; `executeInsert` returns generated keys; `executeUpdate` returns the affected-row count; `eachRow{}` yields a `GroovyResultSet` per row; `rows(query, offset, max)` supports paging.

**Parameter binding** is the security-critical part. Beyond positional `?` and named `:name` parameters, Groovy lets you embed a GString directly in the SQL string: `"... VALUES (${name})"`. Crucially, this does NOT interpolate `name` into the SQL text — Groovy converts the `${name}` expression into a JDBC `PreparedStatement` placeholder and binds the value as a parameter. The result is injection-safe by construction, while reading like ordinary string interpolation. Evidence: `groovy/sql/SqlTest.groovy:124-140`.

**Transactions** carry a non-obvious contract: `withTransaction{}` rolls the transaction back if the block throws, whereas `cacheConnection{}` does NOT — it merely reuses the connection and leaves any partial writes committed. Assuming `cacheConnection{}` is transactional is a real data-integrity bug. Evidence: `groovy/sql/SqlTest.groovy:143-209`.

### 2026 currency

- **The `groovy.sql.Sql` API is unchanged through Groovy 5.0.6** (2026-05-04, current stable). It now ships as the `groovy-sql` split module under the `org.apache.groovy` groupId (the `org.codehaus.groovy` groupId was retired in Groovy 4). [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
- **The injection-safe GString idiom is confirmed in the current API docs.** Under "Avoiding SQL injection," the docs state the GString variants "will be converted to the placeholder variants under the covers" — i.e. parameterized `PreparedStatement` values, never inlined into the SQL text. This security idiom is unchanged in Groovy 4/5. [groovy.sql.Sql API (latest)](https://docs.groovy-lang.org/latest/html/api/groovy/sql/Sql.html)
- **EOL exposure**: running on Groovy 2.5 (support ended 2026-04-30) means no security fixes; move to 4.0/5.0 on a supported LTS JDK. [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
