---
kb_id: persistence/jdbc-fundamentals
version: 1
tags:
  - persistence
  - jdbc
  - tier-0
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-persistence"
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-persistence-2"
  - "Connector/J 9.5.0 release notes — dev.mysql.com (https://dev.mysql.com/doc/relnotes/connector-j/en/news-9-5-0.html)"
related:
  - persistence/connection-pooling
  - persistence/transactions
  - persistence/spring-data-repositories
  - persistence/alternative-orms
  - persistence/schema-migration
status: active
---

## Summary

**Concept**: The raw `java.sql` access path — `DriverManager` → `Connection` → `Statement`/`PreparedStatement`/`CallableStatement` → `ResultSet` — the lowest abstraction tier under every ORM and SQL-mapper.
**Key APIs**: `DriverManager.getConnection`, `prepareStatement`, `setX`/`getX`, `executeQuery`/`executeUpdate`/`executeBatch`, `Statement.RETURN_GENERATED_KEYS` + `getGeneratedKeys()`, `ResultSet` (scrollable/updatable), `RowSet` family, `DatabaseMetaData`.
**Gotcha**: String-concatenated SQL is injection-prone (the deliberate anti-pattern); always parameterize via `PreparedStatement`.
**2026-currency**: Driver SPI auto-registration since JDBC 4 (no `Class.forName`); legacy MySQL coordinate `mysql:mysql-connector-java` + `com.mysql.jdbc.Driver` is stale → `com.mysql:mysql-connector-j` + `com.mysql.cj.jdbc.Driver` (9.5.0).
**Sources**: Baeldung `core-java-persistence`(-2), `java-cockroachdb`; MySQL Connector/J release notes.

## Quick Reference

**Canonical flow**:

```java
try (Connection conn = DriverManager.getConnection(url, user, pwd);
     PreparedStatement ps = conn.prepareStatement("SELECT * FROM person WHERE id = ?")) {
    ps.setLong(1, id);
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) { rs.getString("name"); }
    }
}
```

**Statement family**: `Statement` (static SQL), `PreparedStatement` (parameterized — use this), `CallableStatement` (stored procs, `registerOutParameter`/`ParameterMode`).

**Generated keys**: `conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)` (or `new String[]{"id"}`) → `getGeneratedKeys()`.

**Batch**: `ps.addBatch()` in a loop → `ps.executeBatch()`.

**`ResultSet` deep-dive**: scrollable/updatable types (`TYPE_SCROLL_SENSITIVE`, `CONCUR_UPDATABLE`), cursor navigation (`absolute`/`last`/`previous`), in-place `updateRow`/`insertRow`/`deleteRow`, holdability (`HOLD_CURSORS_OVER_COMMIT`), fetch size.

**`RowSet`** (5 types): `JdbcRowSet`, `CachedRowSet`, `WebRowSet` (XML via `writeXml`), `JoinRowSet`, `FilteredRowSet` — obtain via `RowSetProvider.newFactory()` (preferred over deprecated `com.sun.rowset.*`).

**Metadata**: `DatabaseMetaData.getTables`/`getColumns`/`getPrimaryKeys`/`getImportedKeys`; capability probes (`supportsBatchUpdates`, `supportsSavepoints`); `ResultSetMetaData`.

**NULL insert**: `ps.setNull(i, Types.INTEGER)` vs `ps.setObject(i, v, Types.INTEGER)`.

**Top gotchas**:
- String-concatenated SQL (`"... WHERE id = '" + id + "'"`) is the injection anti-pattern — always parameterize.
- `getTables(...).next()` vs `information_schema` for table-exists checks; JDBC URL formats vary per vendor (Oracle SID vs service-name, MySQL `?useSSL=…`, SQL Server `;databaseName=`).

**Current (mid-2026)**: JDBC 4 auto-registers drivers via the `ServiceLoader` SPI — `Class.forName(driver)` is legacy/unneeded. The MySQL driver coordinate and class both changed: use `com.mysql:mysql-connector-j` (9.x line, 9.5.0 GA 2025-10-22) with `com.mysql.cj.jdbc.Driver`, JDBC 4.2.

## Full content

JDBC is the foundation tier of Java data access: every ORM (Hibernate), SQL-mapper (MyBatis, jOOQ), and convenience layer (Jdbi, Spring `JdbcTemplate`) ultimately drives a `java.sql.Connection`. The corpus teaches the surface end-to-end across `core-java-persistence`, `core-java-persistence-2`, and `java-cockroachdb`.

### The core flow

`DriverManager.getConnection(url, user, pwd)` obtains a `Connection`; from it you create a `Statement`, `PreparedStatement`, or `CallableStatement`, call `executeUpdate`/`executeQuery`, and iterate a `ResultSet` via `next()` + `getX`. `CallableStatement.registerOutParameter` retrieves stored-procedure OUT params.

### Statement vs PreparedStatement (the security lesson)

The corpus deliberately shows the same DAO twice — `StatementPersonDao` (string-concatenated SQL, injection-prone) vs `PreparedStatementPersonDao` (parameterized). The parameterized form is the persistence-side counterpart of SQL-injection prevention: never build SQL by concatenation.

### Generated keys, batching, transactions

Auto-generated keys are retrieved via the `Statement.RETURN_GENERATED_KEYS` flag (or a column-name array) plus `getGeneratedKeys()`. Batch operations use `addBatch`/`executeBatch`. Transaction control is `setAutoCommit(false)` + `commit`/`rollback` (a duplicate-PK insert rolls back the whole tx — the CockroachDB demo).

### ResultSet and RowSet

`ResultSet` supports scrollable/updatable cursors (`TYPE_SCROLL_SENSITIVE`, `CONCUR_UPDATABLE`), in-place `updateRow`/`insertRow`/`deleteRow`, holdability, and fetch-size tuning. The disconnected `RowSet` family (`JdbcRowSet`, `CachedRowSet`, `WebRowSet`, `JoinRowSet`, `FilteredRowSet`) is created via `RowSetProvider.newFactory()`.

### Metadata and vendor portability

`DatabaseMetaData`/`ResultSetMetaData` introspect schema (`getTables`/`getColumns`/`getPrimaryKeys`/`getImportedKeys`) and probe capabilities. JDBC URL formats and NULL handling (`setNull(i, Types.INTEGER)`) differ per vendor. CockroachDB is Postgres-wire-compatible — the same JDBC code runs over `org.postgresql.Driver` on port 26257.

### Teaching bugs (do not copy)

The corpus contains real bugs left in for realism: `StatementPersonDao` SQL has a trailing comma; `TableChecker.tableExistsSQL` is missing a space (`?LIMIT`); `PersonTemplateService.findByFirstName` ignores its argument.

### 2026 currency

- **Driver auto-registration.** Since JDBC 4, drivers self-register via the `ServiceLoader` SPI — the legacy `Class.forName(driver)` call is no longer required.
- **MySQL coordinate/class moved.** The legacy `mysql:mysql-connector-java` + `com.mysql.jdbc.Driver` is stale; the current coordinate is `com.mysql:mysql-connector-j`, driver class `com.mysql.cj.jdbc.Driver`, current line 9.x (9.5.0 GA 2025-10-22, JDBC 4.2, targeting MySQL Server 8.0+). [Connector/J 9.5.0 release notes — dev.mysql.com](https://dev.mysql.com/doc/relnotes/connector-j/en/news-9-5-0.html) · [mysql-connector-j — mvnrepository](https://mvnrepository.com/artifact/com.mysql/mysql-connector-j/9.5.0)
- **`com.sun.rowset.*`** impls are not directly accessible on modern JDKs — use `RowSetProvider.newFactory()`.
- **Core JDBC concepts carry forward unchanged** — `java.sql` is among the most durable surfaces in the domain; what moved is driver coordinates and the modern wrappers built on top (Spring's `JdbcClient`, see [persistence/spring-data-repositories](spring-data-repositories.md)).
