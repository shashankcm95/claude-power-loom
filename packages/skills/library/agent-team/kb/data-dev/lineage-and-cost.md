---
kb_id: data-dev/lineage-and-cost
version: 1
tags:
  - data
  - lineage
  - cost
  - partitioning
  - clustering
  - warehouse
  - governance
sources_consulted:
  - "OpenLineage Documentation (LF AI & Data Foundation graduate project) — openlineage.io/docs — dataset/job/run model + facets"
  - "OpenLineage — Column Level Lineage Dataset Facet (ColumnLineageDatasetFacet) — openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/"
  - "dbt Developer Hub — Column-level lineage (dbt Explorer / Catalog) — docs.getdbt.com/docs/explore/column-level-lineage"
  - "Google Cloud — Introduction to partitioned tables (partition pruning) — docs.cloud.google.com/bigquery/docs/partitioned-tables"
  - "Google Cloud — Introduction to clustered tables (block pruning) — docs.cloud.google.com/bigquery/docs/clustered-tables"
  - "Google Cloud — BigQuery pricing (on-demand bytes-processed + BigQuery Editions; flat-rate retired 2023-07-05) — cloud.google.com/bigquery/pricing"
  - "Snowflake Documentation — Micro-partitions & Data Clustering — docs.snowflake.com/en/user-guide/tables-clustering-micropartitions"
  - "Ralph Kimball & Margy Ross, The Data Warehouse Toolkit, 3rd ed — four-step dimensional design; 'declare the grain' — kimballgroup.com four-step design process"
related:
  - data-dev/data-modeling-basics
  - data-dev/orchestration-essentials
  - architecture/crosscut/idempotency
  - architecture/discipline/trade-off-articulation
  - architecture/ai-systems/inference-cost-management
status: active
---

## Summary

**Two instincts, one discipline.** A data-engineer owes two things on every pipeline:
**Lineage-traceability** — for any output field, name the source columns + transforms that produced it (column-level), and the upstream tables that feed it (table-level). If you cannot trace it, you cannot do impact analysis, root-cause, or trust the number.
**Partition-and-cost-discipline** — never scan the whole warehouse for a question that touches one slice. Partition + cluster on the columns you filter on, so the engine *prunes* (skips) everything irrelevant. Scanned bytes (or slot-seconds) is the cost; pruning is the lever.
**Standards**: OpenLineage (LF AI & Data) models lineage as dataset/job/run + facets, with a `ColumnLineageDatasetFacet` mapping each output field to its `inputFields`. dbt exposes model→model and column→column lineage (Explorer/Catalog) + `exposures` for downstream consumers.
**Engines**: BigQuery prunes partitions on a qualifying filter of the partition column, and prunes *blocks* on clustered columns; on-demand pricing bills bytes processed (first 1 TiB/month free, then $6.25/TiB), capacity pricing (BigQuery Editions, post-2023 flat-rate replacement) bills slots. Snowflake stores all table data in 50–500 MB micro-partitions with per-column min/max + distinct-value stats, and prunes proportionally; a clustering key co-locates similar rows.
**Grain first** (Kimball): declaring the grain is the binding contract that makes both lineage *and* the partition key well-defined.

## Quick Reference

**The lineage question — can you answer it for any field?**

> "Output column `revenue_usd` in `mart.daily_revenue` = `SUM(orders.amount_cents) / 100` joined on `orders.day` — fed by `stg.orders`, fed by `raw.shopify_orders`."

| Grain of lineage | What it answers | Where it lives |
|---|---|---|
| **Table-level** | "If I drop `raw.shopify_orders`, what breaks downstream?" | dbt DAG / OpenLineage dataset edges / catalog |
| **Column-level** | "Where does `revenue_usd` actually come from, field by field?" | OpenLineage `ColumnLineageDatasetFacet`; dbt column-level lineage |
| **Run-level** | "Which job run produced *this* version of the table, and did it succeed?" | OpenLineage run events (START + COMPLETE/FAIL/ABORT) |

**OpenLineage model** (LF AI & Data graduate standard): a **dataset**, a **job**, and a **run** are the core entities; **facets** are attachable metadata. The `columnLineage` dataset facet's `fields` map each output field to its `inputFields` (`namespace` + `name` + `field`) plus an optional `transformationDescription`.

**The cost question — what does this query scan?**

| Lever | BigQuery | Snowflake | Effect |
|---|---|---|---|
| **Partitioning** | partition by DATE/TIMESTAMP/DATETIME (time-unit), ingestion-time, or integer-range | micro-partitions are automatic (50–500 MB uncompressed) | filter on the key → engine skips non-matching partitions (**pruning**) |
| **Clustering** | `CLUSTER BY` cols → block pruning within partitions | define a **clustering key** → co-locates similar rows | second-level pruning on high-cardinality filter cols |
| **Pruning trigger** | qualifying filter on the partition / clustered column | filter predicate the per-partition stats can satisfy | `WHERE day = '2026-06-01'` reads 1 day, not 5 years |
| **Billing unit** | on-demand: **bytes processed** (1 TiB/mo free, then \$6.25/TiB); capacity: **slots** (Editions) | credits = warehouse size × time | fewer scanned bytes / shorter scans = lower bill |

**The cost of a full scan (worked):** a `SELECT *` (or an unfiltered `WHERE`) on a 5-year daily table scans **all** partitions. With a partition filter for one month it scans ~1/60th. On BigQuery on-demand that is a 60× bill difference for the *same answer*; a single unbounded `SELECT *` on a large table can cost real money. (Columnar engines also bill only the **columns** you select — `SELECT *` defeats that too.)

**Top smells:**

- An output field nobody can trace to its sources (no column-level lineage) — every schema change becomes a manual audit.
- `SELECT *` in a transform or dashboard query (scans every column; defeats columnar pruning).
- A growing fact table with **no partition key** (every query is a full scan).
- A `WHERE` that wraps the partition column in a function (`WHERE DATE(ts) = …`) so the engine **can't prune**.
- Over-partitioning: thousands of tiny partitions (one per day for decades) → metadata overhead + small-file problem; under-partitioning: one partition for everything → full scans.
- "We'll add lineage later" on a pipeline already feeding business-critical dashboards.

## Intent

Two failure modes recur in data engineering, and both are invisible until they bite. The first: a number on a dashboard is wrong (or a column is being deprecated) and **no one can say where it came from** — which source columns, which transforms, which upstream tables. Without lineage, every "what does this depend on?" is a grep-the-whole-repo archaeology dig, and every schema change is a silent-breakage risk. The second: a query that should touch one day's data **scans the entire warehouse**, because the table has no partition key, or the filter is written so the engine can't prune, or someone wrote `SELECT *`. Cloud warehouses bill by bytes scanned or slot-time, so this is not a latency nuisance — it is a line item.

This doc serves two named instincts. **Lineage-traceability**: the reflex to demand, for any output field, a traceable path back to its source columns and transforms (column-level) and its upstream tables (table-level). **Partition-and-cost-discipline**: the reflex to model the *cost* of a query before running it — partition and cluster on the filter columns, write filters that prune, never scan more than the question needs. Both rest on Kimball's oldest discipline: **declare the grain first** — the grain is what makes "the source of this field" and "the natural partition key" well-defined questions in the first place.

## The Principle

> "Declaring the grain is the pivotal step in a dimensional design ... the grain establishes exactly what a single fact table row represents. The grain declaration becomes a binding contract on the design." — Ralph Kimball & Margy Ross, *The Data Warehouse Toolkit*, on step 2 of the four-step process (select the business process → **declare the grain** → identify dimensions → identify facts).

And the operational definitions the engines give us:

> "If a query uses a qualifying filter on the value of the partitioning column, BigQuery can scan the partitions that match the filter and skip the remaining partitions. This process is called pruning." — Google Cloud, *Introduction to partitioned tables*.

> "Each micro-partition contains between 50 MB and 500 MB of uncompressed data ... Snowflake stores metadata about all rows stored in a micro-partition, including: the range of values for each of the columns ... [and] the number of distinct values." — Snowflake, *Micro-partitions & Data Clustering*.

Reformulated as instincts:

- **Trace before you trust.** A number you cannot trace to its sources is a number you cannot defend. Column-level lineage is the receipt.
- **Prune before you scan.** The cheapest byte is the one you never read. Partition + cluster on filter columns; write filters the engine can prune on.
- **Grain is the anchor for both.** The grain fixes what one row means — which makes the source-of-a-field and the natural-partition-key both well-posed.
- **Cost is a design property, not a runtime surprise.** Whether a query scans 1 day or 5 years is decided at table-design time (partitioning) and query-authoring time (the filter), not at the billing statement.

## Lineage-traceability: table-level, column-level, run-level

**Table-level lineage** answers impact analysis: "if I change or drop X, what downstream breaks?" In dbt this is the model DAG (`ref()` / `source()` edges); in OpenLineage it is the dataset→job→dataset graph emitted as jobs run. This is the floor — without it, every migration is a manual audit (see [`data-dev/orchestration-essentials`](orchestration-essentials.md), "if I change column X, what breaks?").

**Column-level lineage (CLL)** answers provenance at field grain: which *input* columns + transforms produced an *output* column. This is the instinct that matters most — table-level tells you a table is involved, column-level tells you the actual computation.

- **OpenLineage** models this with the `ColumnLineageDatasetFacet`: its `fields` property maps each output field to the `inputFields` (`namespace`, `name`, `field`) used to evaluate it, plus an optional `transformationDescription`. (OpenLineage is an **LF AI & Data Foundation** graduate project; the model is dataset / job / run + facets, with run events emitting at least START and a terminal COMPLETE / FAIL / ABORT.)
- **dbt** surfaces column-level lineage in dbt Explorer / Catalog ("end-to-end lineage for each column in a resource") for audit, root-cause, and impact analysis. (Per dbt docs, CLL is a dbt Cloud Enterprise feature; dbt Core gives the model-level DAG.)

**`exposures`** (dbt) close the loop at the downstream boundary: an `exposure` declares a dashboard / ML model / app that *consumes* dbt models, so it appears in the lineage graph. Per dbt docs an exposure is **documentation only** — it records the dependency for lineage/impact analysis; dbt does not reach into the external tool.

**Data catalogs** (DataHub, Amundsen, Atlan, and the like) ingest OpenLineage/dbt metadata to centralize column-level lineage across many systems, so the "where did this field come from?" question is answerable org-wide, not per-repo.

## Partition-and-cost-discipline: pruning, clustering, file sizing, cost models

**Partitioning** splits a table by a column you filter on, so the engine reads only matching partitions:

- **BigQuery**: partition by a time-unit column (DATE / TIMESTAMP / DATETIME, with hourly/daily/monthly/yearly granularity), by ingestion time, or by an integer range. A *qualifying filter on the partition column* triggers **pruning** — matching partitions scanned, the rest skipped. (BigQuery enforces a documented limit on partitions per table; over-partitioning hits it and adds metadata overhead — see the partitioned-tables quotas.) Set `require_partition_filter` to refuse unfiltered (full-scan) queries outright.
- **Snowflake**: partitioning is automatic — all table data lands in **micro-partitions** of 50–500 MB uncompressed, each carrying per-column stats (value range / min-max, distinct counts). A filter the stats can satisfy prunes proportionally ("a filter ... that accesses 10% of the values ... should ideally only scan 10% of the micro-partitions").

**Clustering** is the second-level lever — it co-locates similar rows so the engine prunes *within* partitions on a high-cardinality filter column:

- **BigQuery** `CLUSTER BY` cols → block pruning: a filter on a clustered column scans only the relevant blocks, not the whole table/partition.
- **Snowflake** clustering key → "co-locate similar rows in the same micro-partitions ... [for] improved scan efficiency ... by skipping data that does not match filtering predicates," plus better column compression. Automatic clustering maintains it (only when the table will benefit).

**File / partition sizing** is the Goldilocks axis. Too many tiny partitions/files = metadata + small-file overhead and worse compression; one giant partition = no pruning, full scans every query. Target partitions that are large enough to compress well yet aligned to how you filter (the small-file problem is the lakehouse analogue of over-partitioning).

**Cost models** — know what you are billed for:

| Model | Billed on | Pruning effect |
|---|---|---|
| BigQuery **on-demand** | bytes processed (first 1 TiB/month free; then \$6.25/TiB) | fewer scanned bytes → directly fewer dollars |
| BigQuery **capacity** (Editions) | **slots** (compute); replaced flat-rate, retired 2023-07-05 | shorter/cheaper scans → less slot contention, more headroom |
| Snowflake | credits = virtual-warehouse size × runtime | pruned scans finish faster → fewer credit-seconds |

The discipline is identical across all three: **scan less.** Partition + cluster on filter columns, project only the columns you need (never `SELECT *`), and write filters the engine can prune on. See [`architecture/ai-systems/inference-cost-management`](../architecture/ai-systems/inference-cost-management.md) for the same "cost is a first-class design constraint" framing in the LLM domain.

## Substrate-Specific Examples

The Power Loom kernel is not a data warehouse, but the same two instincts show up structurally:

- **Lineage as provenance chain.** The kernel mints a provenance record per spawn/integration that **walks to a genesis position** (`depthWalked ≥ 1`, fail-closed). This is table-level-lineage's exact shape: every artifact must trace back to its origin, or it is rejected. "If you cannot trace it, you cannot trust it" is the kernel's INV-22 fail-closed posture.
- **Content-address as a join key (column-level analogue).** `content_hash = computeContentHash({post_state_hash, writer_spawn_id, head_anchor})` binds *which inputs* produced a record — the substrate equivalent of a `ColumnLineageDatasetFacet` recording the exact fields that fed an output. Using a bare `post_state_hash` (identity-erasing) is the kernel's "lost lineage" bug.
- **Prune, don't scan.** The ordered integrator computes `git merge-base` to fold *only* the relevant delta, never replaying unrelated history — the version-control analogue of partition pruning (touch the minimal change set, skip the rest).

## Tensions with other principles

### Lineage richness vs pipeline simplicity (KISS)

Emitting full column-level OpenLineage facets from every job is real instrumentation cost and complexity. **Resolution**: scale lineage grain to stakes. Table-level lineage is the floor for any shared pipeline; column-level earns its cost on business-critical / regulated / much-debugged datasets. This is a [`trade-off-articulation`](../architecture/discipline/trade-off-articulation.md) call — name what column-level lineage buys (field-grain impact analysis, audit) against the instrumentation it costs.

### Denormalization for query speed vs lineage clarity

Wide "one big table" denormalization (see [`data-dev/data-modeling-basics`](data-modeling-basics.md)) makes queries fast and pruning simple, but a column may now derive from many upstream joins — column-level lineage is what keeps that traceable. The two pull together only if CLL is in place; without it, denormalization erodes traceability.

### Partitioning for cost vs over-partitioning

Partition pruning cuts cost, but partition *too* finely and you hit the partition limit, add metadata overhead, and create the small-file problem. **Resolution**: partition at the grain you filter on (usually day or month for time series), then use *clustering* for finer high-cardinality pruning — don't reach for ever-finer partitions.

### Idempotent reprocessing vs lineage/cost

Idempotent partition-overwrite (`INSERT OVERWRITE` a dated partition — see [`architecture/crosscut/idempotency`](../architecture/crosscut/idempotency.md)) is what lets you safely reprocess one partition without double-counting. It depends on the partition key being well-chosen (cost discipline) and produces a clean per-partition lineage edge (replays map to the same partition). The instincts reinforce each other here.

## When to use

- **Designing any new table/model** — declare the grain first (Kimball), then derive the partition key and the lineage edges from it.
- **Before shipping a query/transform** — ask "what does this scan?" Add a partition filter; drop `SELECT *`; confirm the filter prunes (not wrapped in a function).
- **On any business-critical or regulated dataset** — require column-level lineage so provenance/audit is answerable.
- **During a schema change or deprecation** — consult lineage (table- *and* column-level) to find every downstream consumer before you break them.
- **When a bill spikes** — audit for full scans (missing partition key, unprunable filters, `SELECT *`) before adding compute.

## When NOT to use (or apply with caveat)

- **Tiny, static, or one-off tables** — a lookup table of 200 rows needs no partitioning; pruning saves nothing. Partitioning it is over-engineering ([`data-dev/data-modeling-basics`](data-modeling-basics.md) over-partitioning pitfall).
- **Exploratory / scratch analysis** — full lineage instrumentation on a throwaway notebook query is theater. Apply the instinct to *productionized* pipelines.
- **Latency-bound, cost-insensitive workloads** — if a query is on a fixed-capacity reservation with idle slots, scanned-bytes cost is moot; optimize for latency/concurrency instead. The instinct is "scan less," but the *why* (dollars vs latency) shifts the priority.
- **Engines without partition support** — the *mechanism* differs (a columnar OLAP store may auto-cluster); the *instinct* (filter on indexed/clustered dimensions, project minimal columns) still holds.

## Failure modes when applied incorrectly

- **Lineage gaps treated as acceptable** — "we mostly know where it comes from." Mostly-traceable is untraceable when a number is disputed at 2am. Counter: enforce column-level lineage on critical datasets; emit OpenLineage/dbt metadata.
- **Unprunable filters** — wrapping the partition column in a function or casting it (`WHERE CAST(ts AS DATE) = …`) silently disables pruning → full scan at full cost. Counter: filter the raw partition column directly; verify the query plan shows pruning.
- **`SELECT *` everywhere** — defeats columnar projection *and* inflates scanned bytes; a habit that quietly multiplies every bill. Counter: project explicit columns; lint for `SELECT *` in models.
- **Over-partitioning** — one partition per hour for years → partition-limit pressure, metadata overhead, tiny files, worse compression. Counter: coarsen the partition (day/month) and use clustering for finer pruning.
- **Stale lineage** — a lineage graph that isn't regenerated from the live DAG drifts from reality and gives false confidence. Counter: derive lineage from the build (dbt artifacts / OpenLineage run events), never hand-maintain it.
- **Grain confusion** — mixing grains in one fact table breaks both lineage (a field's meaning is ambiguous) and pruning (the partition key no longer cleanly maps to one row's meaning). Counter: declare the grain, enforce one row = one grain (Kimball).

## Tests / verification

- **Trace-the-field drill**: pick a random output column on a critical table; trace it to source columns + transforms using the lineage tooling. If you can't, the lineage is insufficient.
- **Dry-run / scanned-bytes check**: in BigQuery, dry-run the query and read the estimated bytes processed; confirm a partition filter shrinks it (e.g., one-month filter ≈ 1/60th of a 5-year table). In Snowflake, inspect `SYSTEM$CLUSTERING_INFORMATION` / the query profile's partitions-scanned vs partitions-total.
- **Prune-proof the filter**: confirm filtering the raw partition column prunes, and that the function-wrapped variant does *not* — proving the discipline is real, not assumed.
- **`require_partition_filter` gate** (BigQuery): set it on large tables so an unfiltered full-scan query is rejected at submit time rather than billed.
- **Impact-analysis dry run**: before a schema change, query the lineage graph for downstream consumers (including dbt `exposures`); the change is safe only once every consumer is accounted for.
- **`SELECT *` lint**: grep models/queries for `SELECT *`; each hit is a projection-and-pruning regression to justify or remove.

## Related Patterns

- [data-dev/data-modeling-basics](data-modeling-basics.md) — grain, star/snowflake, SCD, and the partition-key + over/under-partitioning pitfalls this doc deepens with pruning + cost.
- [data-dev/orchestration-essentials](orchestration-essentials.md) — DAGs capture lineage (Airflow OpenLineage / Dagster assets) for impact analysis; idempotent `INSERT OVERWRITE` on dated partitions ties to cost discipline.
- [architecture/crosscut/idempotency](../architecture/crosscut/idempotency.md) — idempotent per-partition reprocessing is what makes partitioned reload safe and lineage-clean.
- [architecture/discipline/trade-off-articulation](../architecture/discipline/trade-off-articulation.md) — lineage richness vs instrumentation cost, and partitioning vs over-partitioning, are trade-offs to articulate, not defaults.
- [architecture/ai-systems/inference-cost-management](../architecture/ai-systems/inference-cost-management.md) — the same "cost is a first-class design constraint, measure before you spend" instinct in the LLM-inference domain.

## Sources

Authored by multi-source synthesis of:

1. **OpenLineage Documentation** (LF AI & Data Foundation graduate project) — `openlineage.io/docs` — the dataset / job / run model + facets; run events emit at least START and a terminal COMPLETE / FAIL / ABORT.
2. **OpenLineage — Column Level Lineage Dataset Facet** — `openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/` (+ the `ColumnLineageDatasetFacet.json` schema) — `fields` maps output fields to `inputFields` (`namespace` / `name` / `field`) with an optional `transformationDescription`.
3. **dbt Developer Hub — Column-level lineage** — `docs.getdbt.com/docs/explore/column-level-lineage` — end-to-end per-column lineage in dbt Explorer / Catalog (Enterprise); `exposures` as documentation-only downstream-consumer declarations.
4. **Google Cloud — Introduction to partitioned tables** — `docs.cloud.google.com/bigquery/docs/partitioned-tables` — partition pruning on a qualifying filter; time-unit / ingestion-time / integer-range partitioning; partition limits + `require_partition_filter`.
5. **Google Cloud — Introduction to clustered tables** — `docs.cloud.google.com/bigquery/docs/clustered-tables` — block pruning on clustered columns.
6. **Google Cloud — BigQuery pricing** — `cloud.google.com/bigquery/pricing` — on-demand bills bytes processed (first 1 TiB/month free, then \$6.25/TiB); capacity pricing via BigQuery Editions (slots) replaced flat-rate, which was retired 2023-07-05.
7. **Snowflake — Micro-partitions & Data Clustering** — `docs.snowflake.com/en/user-guide/tables-clustering-micropartitions` — 50–500 MB uncompressed micro-partitions; per-column range + distinct-value stats; proportional pruning; clustering keys co-locate similar rows.
8. **Ralph Kimball & Margy Ross, *The Data Warehouse Toolkit*** (3rd ed) — the four-step dimensional design process and "declare the grain" as the binding contract (kimballgroup.com four-step design process).

Each web source was verified to exist via WebSearch/WebFetch during authoring (OpenLineage docs + column-lineage facet; dbt column-level lineage + exposures; BigQuery partitioned/clustered-tables docs + pricing page incl. the 2023-07-05 flat-rate retirement and the 1 TiB-free / \$6.25-per-TiB on-demand figures; Snowflake micro-partitions 50–500 MB + per-column stats; Kimball four-step process + grain). Substrate examples are drawn from the Power Loom v3.1 kernel: the genesis-walking provenance chain (table-level-lineage analogue), the `computeContentHash` input binding (column-level-lineage analogue), and `git merge-base` minimal-delta folding (partition-pruning analogue).

## Phase

Authored: kb authoring batch (v3.1-era, post-Phase-2 / Runtime Foundation; single-lens KB-gap harvest). Multi-source synthesis from 8 verifiable sources spanning the lineage standard (OpenLineage / LF AI & Data), the transform-layer tool (dbt), two cloud warehouses (BigQuery, Snowflake), and dimensional-modeling theory (Kimball). Serves the HETS **data-engineer** persona's two named instincts — **lineage-traceability** (column-/table-/run-level provenance; can you trace any output field to its sources?) and **partition-and-cost-discipline** (partition pruning, clustering, file sizing, cost models; don't scan the whole warehouse). Substrate examples map the instincts onto the kernel's provenance chain, content-address input binding, and minimal-delta integration.
