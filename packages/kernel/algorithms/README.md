# Kernel Algorithm Library (K11)

Where **Axiom A4** lives: *"kernel scope SHALL include algorithmic logic. Deterministic operations live
in kernel code **with unit tests** — not prose discipline or embedded pseudocode for LLM execution."*
(`packages/specs/rfcs/v6-substrate-synthesis.md:387`; binding from v3.2.)

This directory holds the substrate's **registered kernel algorithms**. The `manifest.json` ledger +
the **A4-binding gate** (`packages/kernel/_lib/kernel-algorithms-audit.js`, run via the
`kernel-algorithm-a4-binding` validator in `contracts-validate.js`) keep the library honest.

**Scope (honest, as of v3.2 Wave 3 — ENFORCING):** the gate enforces *structural integrity* of declared
algorithms (hard errors), an *unregistered-`.js` scan*, and — since the Wave-3 flip
(`enforcement: "error"`) — a **no-park-and-forget** rule: any `planned[]` entry is now a hard CI error,
not a stderr warning. It does **not** detect deterministic logic an author never declares (prose-scanning
was rejected as a false-positive trap). The watchlist is **drained**: R9/R11 were **reclassified as
runtime** (see Members), not kernelized — so the gate binds on the registered library, with R9/R11's
determinism satisfied in tested *runtime* functions per the boundary rule recorded under Members.

## What counts as a kernel algorithm

A `.js` file in this directory is a registered algorithm. It MUST be:

1. **Pure / deterministic** — same input → same output; no hidden state.
2. **Side-effect-free at module scope** — no I/O, child processes, timers, or global handlers at the top
   level. Any CLI behavior lives **only** under `if (require.main === module)`. (The gate reads the
   source statically and never `require()`s it — module-scope side effects would otherwise poison the
   validator process.)
3. **Exported via a FLAT `module.exports = { … }` object literal** — a comma-separated identifier list,
   the form the gate's static export check parses (e.g. `module.exports = { scoreTask, ROUTE_THRESHOLD };`).
   **No nested object literals as values** (`{ fn, opts: { … } }`) — the non-greedy parser truncates at the
   inner `}` and would spuriously flag later names. If you genuinely need nested exports, upgrade the parser
   and relax this rule together.
4. **Unit-tested** — a test under `tests/unit/kernel/algorithms/` that the CI kernel-property-tests job
   runs (`node <file>.test.js`, imperative asserts, `process.exit(failed === 0 ? 0 : 1)`).
5. **Registered** in `manifest.json` under `algorithms[]`.

**Non-algorithm helpers** (re-export shims, shared utilities) live in `packages/kernel/_lib/`, **not
here** — otherwise the gate's `algorithm-unregistered` check flags them. The library is for the pure
deterministic functions A4 governs; the meta-tooling that checks them is `_lib`.

## The manifest (`manifest.json`)

Two arrays with **different** required-field sets:

| array | required fields | meaning |
|---|---|---|
| `algorithms[]` | `id`, `file`, `exports[]`, `test`, `kind`, `summary` | **realized** — a real file + exports + a unit test. Subject to structural-integrity checks (hard errors). |
| `planned[]` | `id`, `owner`, `wave`, `note` | **A4 watchlist** — known-future determinism (e.g. R9 leaf-criteria, R11 routing) not yet kernelized. No file/test required yet. |

Top-level: `version` (number), `enforcement` (`"warn"` | `"error"`).

## Enforcement (flipped to ENFORCING in Wave 3)

- **`enforcement: "warn"` (Wave 0–2, historical):** `planned[]` entries emitted one consolidated stderr
  `⚠` watchlist line — they did **not** fail CI. Structural-integrity violations on `algorithms[]`
  entries were hard errors from day one (false-positive-free; the ledger is authored clean).
- **`enforcement: "error"` (Wave 3 flip — CURRENT):** any `planned[]` entry is a hard error (CI exit 1).
  The flip was a **one-line data change**, not a code edit — the gate implemented both modes from Wave 0.
  The watchlist is currently empty (drained), so the live effect is: structural integrity +
  unregistered-scan are enforced, and any *future* parked subject fails CI rather than nagging forever.

**Forcing-function (still live for any FUTURE kernel algorithm):** the PR that moves an entry from
`planned[]` to `algorithms[]` **MUST land its test file in the same PR** — the integrity check
hard-errors on a realized entry whose declared `test` does not exist. That is the designed teeth (A4:
deterministic kernel code is unit-tested). *(This never fired for R9/R11 — they were reclassified as
runtime, not moved to `algorithms[]`; the forcing-function applies to genuine future kernel algorithms.)*

## Members

| id | file | status |
|---|---|---|
| `route-decide` | `route-decide.js` | realized — H.7.3 task-routing scorer (a 7-dimension weighted scorer = genuine derivation logic) |

**Reclassified as runtime (NOT kernel algorithms) — Wave 3:** `leaf-criteria` (R9 —
`packages/runtime/orchestration/leaf-criteria.js`) and `spawn-verify-route` (R11 —
`packages/runtime/verify/spawn-verify.js`) were on the Wave-0/1 watchlist but were **removed** at the
Wave-3 flip rather than kernelized. Rationale (the Wave-1 A4 boundary rule): *"A4/K11 binds branching /
derivation logic with a non-trivial spec (route scoring, subset math, path canonicalization); a
static-set membership lookup or single-field presence check is a runtime constant, NOT a kernel
algorithm."* R9's six criteria are threshold/presence/membership checks (a declaration-conformance gate),
and R11 **runs subprocesses** (disqualified by "side-effect-free at module scope" above). Both are tested
*runtime* functions (`tests/unit/runtime/…`) — satisfying A4's spirit ("tested code, not LLM-re-derived
prose") without being registered kernel algorithms. Full adjudication:
`packages/specs/plans/2026-06-03-v3.2-wave3-a4-enforcing-flip.md`.
