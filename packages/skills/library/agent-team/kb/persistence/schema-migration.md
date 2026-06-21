---
kb_id: persistence/schema-migration
version: 1
tags:
  - persistence
  - schema-migration
  - flyway
  - liquibase
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: flyway"
  - "Baeldung tutorials (eugenp/tutorials) module: liquibase"
  - "Flyway vs Liquibase 2026 — bytebase.com (https://www.bytebase.com/blog/flyway-vs-liquibase/)"
related:
  - persistence/jdbc-fundamentals
  - persistence/spring-data-repositories
status: active
---

## Summary

**Concept**: Versioned, repeatable database schema migration — Flyway (SQL-file versioned migrations) and Liquibase (XML/YAML/JSON changelogs with explicit rollback).
**Key APIs**: Flyway `V<ver>__<desc>.sql` on `db/migration`, callbacks (`beforeMigrate.sql`/`afterMigrateError__repair.sql`), `FlywayMigrationStrategy`, `flyway.info().all()`/`MigrationState`, `flyway repair`; Liquibase `<changeSet>`/`<createTable>`/`<rollback>`, `liquibase-maven-plugin`.
**Gotcha**: Flyway `repair` fixes the `flyway_schema_history` table after a failed migration; a no-op `FlywayMigrationStrategy` bean suppresses Boot auto-migration.
**2026-currency**: Flyway dropped the Teams tier (May 2025) — only Community (free) + Enterprise (paid); core MySQL/Oracle migrations remain free. Liquibase 5.0 (Java 17 minimum).
**Sources**: Baeldung `flyway`/`flyway-repair`/`flyway-cdi-extension`, `liquibase`; Bytebase Flyway-vs-Liquibase 2026.

## Quick Reference

**Flyway** (SQL-first, versioned):
- Migrations: `V<ver>__<desc>.sql` on classpath `db/migration` (the naming is durable and unchanged).
- Callbacks: SQL-file event-named (`beforeMigrate.sql`, `afterMigrateError__repair.sql`) or a Java `Callback`.
- Boot auto-migrates on startup; suppress with a no-op `FlywayMigrationStrategy` bean, then call `flyway.migrate()` manually.
- Inspect: `flyway.info().all()` → `MigrationInfo`/`MigrationState` (`PENDING`/`SUCCESS`).
- Repair: `flyway repair` (fix `flyway_schema_history` after a failed migration); a common auto-repair callback is `afterMigrateError__repair.sql` = `DELETE FROM flyway_schema_history WHERE success=false;`.
- CDI portable extension (`flyway-cdi-extension`) bootstraps Flyway in the container lifecycle.

**Liquibase** (changelog-first, explicit rollback):
- XML/YAML/JSON changelog: `<changeSet>`/`<createTable>`/`<rollback>`.
- Rollback taxonomy: single/multi-statement, multiple tags, by-reference `changeSetId`, empty `<rollback/>`.
- Driven by `liquibase-maven-plugin`.

**Top gotchas**:
- `flyway repair` is the recovery path after a partially-applied/failed migration — it does not re-run the migration, it fixes the history table.
- Flyway undo is a paid (Enterprise) feature, often emulated with a reverse migration.
- A no-op `FlywayMigrationStrategy` bean is required to take manual control of *when* migration runs.

**Current (mid-2026)**: Flyway now offers only Community (free) and Enterprise (paid) — the Teams tier was discontinued for new customers (May 2025). Community still supports MySQL/PostgreSQL/Oracle/SQL Server core migrations; Enterprise adds undo/dry-run/SQL*Plus. Liquibase 5.0 (2025-09) requires Java 17 minimum. The `V<ver>__<desc>.sql` naming convention is unchanged.

## Full content

Schema migration tools version the database alongside the application, applying ordered, idempotent changes and tracking what has run. The corpus covers Flyway across three modules (`flyway`, `flyway-repair`, `flyway-cdi-extension`) and Liquibase in one.

### Flyway

Flyway applies versioned SQL files named `V<ver>__<desc>.sql` from `db/migration`, recording each in a `flyway_schema_history` table. Spring Boot auto-migrates on startup; to take manual control you supply a no-op `FlywayMigrationStrategy` bean and call `flyway.migrate()` yourself. Callbacks hook lifecycle events either as event-named SQL files (`beforeMigrate.sql`, `afterMigrateError__repair.sql`) or a Java `Callback`. `flyway.info().all()` exposes each migration's `MigrationState`. When a migration fails partway, `flyway repair` fixes the history table (a common auto-repair callback deletes failed rows). The CDI portable extension bootstraps Flyway in a Jakarta EE container.

### Liquibase

Liquibase describes changes in a database-agnostic changelog (XML/YAML/JSON) with explicit `<changeSet>` and `<rollback>` blocks. Its rollback taxonomy is richer than Flyway's: single/multi-statement rollbacks, by-tag, by-reference `changeSetId`, and empty `<rollback/>` for irreversible changes. It is driven by the `liquibase-maven-plugin`.

### Choosing between them

Flyway favors SQL-first simplicity; Liquibase favors database-portability and first-class rollback. Both track history and integrate with Boot. The `V<ver>__<desc>.sql` naming and changelog conventions are durable.

### 2026 currency

- **Flyway editions, corrected.** As of May 2025 Flyway offers only Community (free) and Enterprise (paid); the Teams tier was discontinued for new customers. Community still supports MySQL/PostgreSQL/Oracle/SQL Server *core* migrations — Enterprise adds undo/dry-run/SQL*Plus. (The 2021 base's "MySQL/Oracle moved to paid" was an over-broad reading: core migrations remain free.) The 2021 `BaseFlywayCallback` was removed in Flyway 6 — use `Callback`. [Flyway vs Liquibase 2026 — bytebase.com](https://www.bytebase.com/blog/flyway-vs-liquibase/)
- **Liquibase 5.0** (2025-09) requires a Java 17 minimum. [Flyway vs Liquibase 2026 — bytebase.com](https://www.bytebase.com/blog/flyway-vs-liquibase/)
- **The migration conventions carry forward unchanged** — `V<ver>__<desc>.sql` naming, changelog structure, and the history-table model are durable; what moved is the edition/licensing model and the minimum Java baseline.
