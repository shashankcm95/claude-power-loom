---
skill: postgres-engineering
status: active
domain: backend-dev
canonical_source: https://www.postgresql.org/docs/current/
forged_via: 'Phase-0-pdf-tutorial-shakedown-2026-05-21 (closes kb:hets/stack-skill-map gap — postgres-engineering referenced as recommended across SSR/Node/JVM/Data stacks but absent from kb-resolver list --tag postgres)'
related_kb: [backend-dev/node-runtime-basics, backend-dev/express-essentials]
tags: [postgres, database, indexing, pooling, pgvector, migrations, observability]
---

# Postgres Engineering

Operational engineering skill for working with PostgreSQL in production-shaped systems. Targets `13-node-backend` + `11-data-engineer` personas; useful for any persona touching schema design, query performance, or migrations.

## When to use this skill

Trigger when:
- Designing or revising a Postgres schema (DDL, indexes, constraints, JSONB usage)
- Diagnosing slow queries, lock contention, connection-pool exhaustion, or bloat
- Adding vector search (pgvector — embeddings + ANN)
- Planning a migration that touches a non-trivial table (≥10K rows in dev / ≥1M in prod)
- Choosing or sizing a connection pool (PgBouncer, application-level)

**Skip** when the work is generic SQL (`data:sql-queries` covers that), DB-vendor-agnostic ORM modeling (use the ORM's docs), or read-only ad-hoc analytics (use `data:explore-data`).

## Core competencies

### Indexing — pick by access pattern, not by default

| Type | Wins when | Loses when |
|---|---|---|
| **B-tree** (default) | Equality, range, ORDER BY, prefix LIKE | Large arrays, JSONB containment, trigram search |
| **GIN** | JSONB `@>` containment, full-text (`tsvector`), array `@>`, `pg_trgm` `LIKE '%pat%'` | Write-heavy tables (high update cost), single-row lookups |
| **Partial** (`WHERE …`) | Sparse predicate is hot (`WHERE status='pending'`); index size matters | Predicate isn't actually in the WHERE clause of queries — planner won't use it |
| **Covering** (`INCLUDE (col, …)`) | Read-heavy + you want index-only scans (no heap visit) | Writes (every covered col update bloats the index) |
| **BRIN** | Multi-GB append-only tables with physically-correlated data (timestamps) | Random insert patterns; small tables (no benefit) |
| **Hash** | Equality-only, fixed-size keys, PG10+ WAL-logged | Anywhere B-tree works (almost everywhere); range queries |

Heuristics:
- **`EXPLAIN (ANALYZE, BUFFERS)`** before adding any index — if the existing plan reads <1000 rows, an index is probably not the win
- **Index-only scans** require all referenced columns in the index (`INCLUDE` for non-key cols) AND a recent VACUUM (visibility map must be current)
- **GIN write cost** — bulk inserts can be 10-50× slower; consider `fastupdate=on` (pending list) for write-heavy
- **Partial-index gotcha** — the planner only uses it if the query's predicate logically implies the index's. `WHERE status='pending'` works; `WHERE status IN ('pending','processing')` does not

### Connection pooling — almost always required

- **PgBouncer transaction mode** is the default for web apps. Connects scale per-app-pod; PgBouncer multiplexes onto a small backend pool.
  - **Breaks**: `SET LOCAL`, session-scoped temp tables, advisory locks across transactions, server-side prepared statements unless using `pgbouncer.pool_mode=transaction` with `default_prepared_statements=1` (PG14+) or driver-level prep cache disable.
- **Session mode** — fully compatible but pool size must equal max concurrent sessions; defeats the purpose for high-traffic web.
- **Statement mode** — highest reuse, breaks ALL transactions; only for autocommit workloads.
- **Sizing formula**: `pool_size ≈ (cores × 2) + effective_spindles`. For RDS/Cloud SQL, hard-cap at ~75% of `max_connections / num_pgbouncer_instances` to leave room for admin sessions.
- **Application-level pool** (`pg-pool`, HikariCP, asyncpg): fine when `num_app_instances × pool_size ≤ max_connections − admin_overhead`. Past that, you need PgBouncer.

### pgvector — embedding storage + ANN

- **Operator classes**: `vector_l2_ops` (Euclidean), `vector_cosine_ops` (cosine), `vector_ip_ops` (inner product). Pick to match your embedding model's training objective — OpenAI / Anthropic embeddings are cosine-normalized, so `vector_cosine_ops` or `vector_l2_ops` on normalized vectors both work.
- **Index choice**:

| | HNSW | IVFFlat |
|---|---|---|
| Build time | Slow | Fast |
| Query latency | Very low | Low (depends on `probes`) |
| Memory | High | Moderate |
| Recall | High (tunable via `ef_search`) | Moderate (tunable via `probes`) |
| Dynamic insert | Good (incremental) | Requires re-train for new clusters |

Default to **HNSW** for prototypes (better recall, no re-training). Switch to **IVFFlat** only if build time becomes the bottleneck or memory is constrained.

- **`SET hnsw.ef_search = 100`** (default 40) at session start to trade latency for recall.
- **Dimensionality**: pgvector supports up to 16,000 dims (HNSW: 2,000); match your embedding model exactly — mismatched dims throw at insert.
- **Hybrid search**: combine `<=>` (cosine distance) with B-tree predicates via `WHERE category = 'x' AND embedding <=> $1 < 0.3` — the planner uses both indexes if both selective.

### Migrations — zero-downtime patterns

The hidden cost of DDL is locks, not disk. Default lock for most ALTER is `ACCESS EXCLUSIVE` — kills all reads + writes on the target table until done.

| Operation | Lock | Online? | Notes |
|---|---|---|---|
| `ADD COLUMN` (no default) | `ACCESS EXCLUSIVE`, brief | Yes | Metadata-only; fast |
| `ADD COLUMN … DEFAULT v` | `ACCESS EXCLUSIVE`, table-rewrite | Yes (PG11+) | PG11+ stores default in catalog; PG10 rewrites every row |
| `ADD COLUMN … NOT NULL` | `ACCESS EXCLUSIVE`, full scan | Risky | Use the safe pattern: `ADD COLUMN nullable` → backfill → `SET NOT NULL` after `ADD CONSTRAINT … NOT VALID; VALIDATE CONSTRAINT` |
| `CREATE INDEX` | `SHARE` (blocks writes) | No | Always use `CONCURRENTLY` in production |
| `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | Yes | Can fail mid-build → leaves `INVALID` index; check `pg_index.indisvalid` |
| `DROP INDEX` | `ACCESS EXCLUSIVE` | No | Use `DROP INDEX CONCURRENTLY` (PG12+) |
| `ALTER TYPE` (most cases) | `ACCESS EXCLUSIVE`, table-rewrite | No | Multi-step: new col → backfill → swap |
| `RENAME COLUMN` / `RENAME TABLE` | `ACCESS EXCLUSIVE`, brief | Yes (catalog-only) | But breaks running queries — use a view as compat shim |

**Always wrap risky migrations** in `SET lock_timeout = '2s'; SET statement_timeout = '5min';` to fail fast instead of stacking blockers behind a multi-hour scan.

**`CREATE INDEX CONCURRENTLY` failure recovery** — if it leaves `indisvalid = false`, `REINDEX INDEX CONCURRENTLY` to rebuild, or `DROP INDEX` + retry.

### Hand-written SQL migrations + Drizzle migrator (cross-dialect; SQLite-anchored)

**Scope note**: this section is Drizzle-specific and applies to SQLite + Postgres consumers alike. Empirical surface was SQLite (`better-sqlite3`), but the migrator constraint is dialect-independent.

When you ship hand-written `drizzle/migrations/NNNN_*.sql` files (no `drizzle-kit generate` available at codegen time — e.g. agent-spawned scaffolding before `pnpm install` runs), the `drizzle-orm` migrator throws at boot:

```
ENOENT: no such file or directory, open '.../drizzle/migrations/meta/_journal.json'
```

The migrator expects a `meta/_journal.json` index file alongside the SQL — the file `drizzle-kit generate` would have produced. Hand-written SQL skips that step.

**Two options**:

1. **Hand-write the journal** (recommended for production):

   ```json
   {
     "version": "7",
     "dialect": "sqlite",
     "entries": [
       { "idx": 0, "version": "7", "when": 1716567000000, "tag": "0000_initial", "breakpoints": true }
     ]
   }
   ```

   Place at `drizzle/migrations/meta/_journal.json`. `dialect` is `"sqlite"` / `"postgresql"` / `"mysql"` per project. `when` is unix milliseconds. `tag` matches the SQL filename minus the `.sql` extension. After this, `pnpm db:migrate` works normally and tracks applied migrations via the internal `__drizzle_migrations` (Postgres) / `__drizzle_migrations` table (SQLite) — idempotent.

2. **Bypass the migrator** with raw exec (acceptable for MVP / single-shot bootstrap; NOT for production):

   ```ts
   import Database from 'better-sqlite3';
   import fs from 'node:fs';
   const db = new Database('./data/app.db');
   db.exec(fs.readFileSync('./drizzle/migrations/0000_initial.sql', 'utf8'));
   ```

   Trade-off: no idempotency, no migration tracking — re-running the script errors with "table exists". Acceptable for prototype bootstrap with manual cleanup discipline. The Postgres equivalent uses `pg` / `postgres.js` with `await sql.unsafe(rawSql)`.

**Recommended**: option 1 for any scaffolding that will outlive the prototype phase; option 2 only for one-shot bootstrap with explicit "drop + recreate" cleanup before second use.

**Empirical origin**: DRIFT-test3-015; surfaced during test3 Phase-5 UAT — `pnpm db:migrate` failed at boot with the ENOENT, took ~1h to root-cause to the missing `_journal.json`. Persona that hand-wrote the SQL (no pnpm available at codegen time) didn't ship the journal alongside.

### Observability — what to enable on day 1

- **`pg_stat_statements`** — top queries by `total_time`, `mean_time`, `calls`. Required for any production. Pre-load via `shared_preload_libraries = 'pg_stat_statements'` (needs restart).
- **`auto_explain`** — auto-logs plans for queries > `auto_explain.log_min_duration` (try `1s`). Surfaces seq-scan regressions before they page someone.
- **`pg_stat_activity`** — current sessions; `WHERE state = 'active' AND query_start < now() - interval '30s'` finds runaway queries. Join `pg_locks` on `pid` to find blockers.
- **Bloat**: `pgstattuple` extension (sampled) or query `pg_class.reltuples / pg_relation_size` ratios. Autovacuum tuning per-table via `ALTER TABLE … SET (autovacuum_vacuum_scale_factor = 0.05)` for high-write tables.
- **Slow-query workflow**: `pg_stat_statements` finds the offender → `EXPLAIN (ANALYZE, BUFFERS)` on representative inputs → check `Rows Removed by Filter` (need an index?) or `Heap Fetches` (need a covering index / VACUUM?) → add index → re-measure.

## Common pitfalls

1. **`SELECT *` + index-only scan** → not possible; planner needs heap. Project the columns or use `INCLUDE`.
2. **`WHERE col::text = 'x'`** → defeats index on `col`. Drop the cast or build a functional index.
3. **`LIMIT 1` with `ORDER BY indexed_col DESC` but a small OFFSET** → planner sometimes picks seq-scan if it thinks the index path is more expensive. `ANALYZE` after bulk loads.
4. **`OR` across multiple indexed columns** — planner often can't combine; use `UNION ALL` of two indexed queries.
5. **JSONB without GIN** + queries with `@>` → seq-scan every time. Either add GIN or extract the hot key to its own column.
6. **`CASCADE` on foreign keys with no index on the child** → DELETE on parent does a seq-scan on child. Index FK columns.

## Related KB

- `kb:backend-dev/node-runtime-basics` — when paired with `node-backend-development`
- `kb:backend-dev/express-essentials` — route-handler patterns that talk to Postgres
- `kb:hets/stack-skill-map` — stack entries that pull this skill (SSR, Node, JVM, Data ETL)

## What this skill is NOT

- Not a SQL tutorial (use `data:sql-queries`)
- Not ORM-specific — covers Postgres itself; ORM choice (Drizzle / Prisma / TypeORM / SQLAlchemy / Hibernate) is upstream of the patterns here
- Not a replacement for `EXPLAIN ANALYZE` — every recommendation here should be verified against your actual workload
