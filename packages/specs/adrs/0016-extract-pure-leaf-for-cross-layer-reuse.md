---
adr_id: 0016
title: "Extract a pure leaf to kernel/_lib when logic is needed across layers"
tier: technical
status: accepted
created: 2026-06-07
author: /self-improve promotion (qualitative pattern, 4× recurrence)
superseded_by: null
files_affected:
  - packages/kernel/_lib/canonical-json.js
  - packages/kernel/_lib/recency-decay.js
  - packages/kernel/_lib/jsonl-read.js
  - packages/kernel/_lib/evolution-snapshot-read.js
related_adrs:
  - 0012
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
---

## Context

Across the v3.3/v3.4 Evolution Lab waves, the same structural move recurred four
times: a piece of logic was needed in two layers (kernel + lab, or runtime + lab),
and rather than import across the layer boundary (which would violate the K12
dependency rule — the Lab must not import the kernel, and the kernel must not import
the Lab) or duplicate the implementation, the shared logic was **extracted to a pure,
dependency-free leaf module under `packages/kernel/_lib/`** that both consumers
reference.

Instances (chronological):

1. **`canonical-json.js`** — `canonicalJsonSerialize` (INV-22 content-address basis); kernel content-hashing + Lab `attestation_id` `sig_hash` determinism (v3.4 design-input b).
2. **`recency-decay.js`** — `computeRecencyDecay` / `computeRecencyDecayAt`; the runtime registry display-decay + the E4 reputation projection share one math, injectable clock for E4 determinism.
3. **`jsonl-read.js`** — `readJsonlBounded`; both Lab stores (negative-attestation + verdict-attestation) read bounded JSONL through one tail-reading, cap-enforcing leaf (the H1-deep fix).
4. **`evolution-snapshot-read.js`** — `resolveSnapshotPath` + hash-basis + `O_NONBLOCK`-fd read; the kernel A6 spawn-record reads the Lab-materialized snapshot as a DATA file (K12-clean, no Lab import) via the same leaf the Lab materializer writes against.

## Decision

When logic must be exercised by **more than one layer** (kernel / runtime / lab),
and a direct cross-layer import would breach the K12 dependency rule, **extract the
logic to a pure leaf module under `packages/kernel/_lib/`** rather than duplicating
it or reaching across the boundary.

A qualifying leaf is:

- **Pure** — no I/O beyond what it is explicitly given (or I/O fully encapsulated and
  bounded, as in `jsonl-read`/`evolution-snapshot-read`), deterministic for fixed
  input, no ambient clock/random (inject the clock — see `computeRecencyDecayAt`).
- **Dependency-free** — depends only on Node built-ins and other `_lib` leaves; never
  on kernel hooks, runtime personas, or Lab projections. This is what keeps it
  importable from any layer without inverting the dependency rule.
- **Single-responsibility** — one cohesive concern per file (SOLID-SRP).

Each new leaf gets its **own focused test suite**, and (per the H1-deep / A6-DoS
lessons) a leaf that touches files or untrusted size **bounds the cost, not just the
size** — cap the parse/allocation, not merely the byte-length check.

## Consequences

- **Positive** — the dependency rule stays intact while genuine reuse is honored
  (DRY without cross-layer coupling); each leaf is independently testable; the
  injectable-clock convention makes downstream projections deterministic.
- **Cost** — a small proliferation of `_lib` files. Acceptable under the
  "many small files over few large files" file-organization principle.
- **Guardrail (YAGNI)** — extract on the **second** real consumer, not in
  anticipation of one. The v3.4 W4 circuit-breaker correctly **resisted** a leaf
  extraction because it had no cross-layer consumer — confirming this is a
  reuse-driven convention, not a default-for-everything.

## Status note

Promoted from a recurring memory observation via `/self-improve` (2026-06-07) after
the 4th instance. Recorded as a **project convention** (this ADR), deliberately NOT
an always-on global rule — it is project-structure-specific (the `_lib` + K12
dependency rule are Power Loom internals) and descriptive of a good move, not an
error-preventing guardrail.
