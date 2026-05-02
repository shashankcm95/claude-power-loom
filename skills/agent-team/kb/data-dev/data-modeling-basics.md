---
kb_id: data-dev/data-modeling-basics
version: 1
tags: [data, modeling, schema, warehouse, starter]
---

## Summary

Data modeling basics for HETS data-engineer personas: dimensional (Kimball) for analytics — facts + slowly-changing dimensions; wide-table (denormalized) for query simplicity at storage cost; star vs snowflake schemas; SCD types (Type 1 overwrite, Type 2 history, Type 3 limited history); partition keys for query pruning + cost control; data contracts for cross-team boundaries. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Dimensional modeling (Kimball)

- **Fact table**: events / measurements. Grain = one row per business event (e.g., one order, one page view).
- **Dimension table**: descriptive attributes. Slowly changing.
- **Star schema**: facts at center, dimensions radiating out. One join per dimension.
- **Snowflake schema**: dimensions normalized further. More joins; less data duplication.

Star is the default; snowflake only if dimension tables get unwieldy.

### Slowly Changing Dimensions (SCD)

| Type | Behavior | When to use |
|------|----------|-------------|
| Type 1 | Overwrite — no history | Corrections, no analytical value in old version |
| Type 2 | New row per change with effective dates | Need point-in-time accuracy for analysis |
| Type 3 | Add column for previous value | Limited history, only last change matters |
| Type 6 | Hybrid (1+2+3) | Complex needs |

### Wide-table / OBT (One Big Table)

Modern columnar warehouses (Snowflake, BigQuery, Databricks) shift the calculus. Denormalized "wide" tables can be cheaper to query than dimensional joins:
- ✅ Faster queries (no joins)
- ✅ Simpler downstream consumption
- ❌ Storage cost (denormalized data is bigger)
- ❌ Updates are harder (touch many rows)

Use OBT when read-heavy + columnar warehouse + storage is cheap.

### Partitioning

- Partition by a column commonly filtered on (date, region)
- Avoid over-partitioning (1 partition per day for 10 years = 3650 partitions; queries scanning all = slow)
- Avoid under-partitioning (single partition for everything = full table scans)
- Cluster within partitions for second-level pruning

### Data contracts

When data crosses team boundaries, define:
- Schema (column names, types, nullability)
- Semantic meaning (what each column represents)
- SLA (freshness, completeness)
- Backward-compatibility policy (additions OK without notice; removals + type changes require N-day deprecation)

### Common pitfalls

- Normalizing too aggressively (joins everywhere; query cost explosion)
- Denormalizing too aggressively (no single source of truth; updates inconsistent)
- No partition key on growing tables (full scans for every query)
- SCD Type 1 used where Type 2 was needed (history lost; can't reconstruct point-in-time)
- Schema changes without coordination (downstream consumers break silently)
- Primary keys that aren't actually unique (silent duplicate rows in fact tables)

### Related KB docs (planned)

- `kb:data-dev/orchestration-essentials`
- `kb:data-dev/dbt-patterns`
- `kb:data-dev/data-contracts`
