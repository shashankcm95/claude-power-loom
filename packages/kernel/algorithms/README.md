# Kernel Algorithm Library (K11)

Where **Axiom A4** lives: *"kernel scope SHALL include algorithmic logic. Deterministic operations live
in kernel code **with unit tests** — not prose discipline or embedded pseudocode for LLM execution."*
(`packages/specs/rfcs/v6-substrate-synthesis.md:387`; binding from v3.2.)

This directory holds the substrate's **registered kernel algorithms**. The `manifest.json` ledger +
the **A4-binding gate** (`packages/kernel/_lib/kernel-algorithms-audit.js`, run via the
`kernel-algorithm-a4-binding` validator in `contracts-validate.js`) keep the library honest.

**Scope (honest, as of v3.2 Wave 0):** this is a **scaffold + WARN-first gate**, not full A4 enforcement.
It enforces *structural integrity* of declared algorithms today (hard errors) and *tracks* known-future
determinism as a `planned[]` watchlist (WARN only). It does **not** detect deterministic logic an author
never declares. Real enforcement — the watchlist flipping to hard errors — arrives in **Wave 3** once
R9/R11's deterministic cores land as tested kernel algorithms.

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

## Enforcement (WARN-first, then flip)

- **`enforcement: "warn"` (Wave 0–2):** `planned[]` entries emit one consolidated stderr `⚠` watchlist
  line — they do **not** fail CI. Structural-integrity violations on `algorithms[]` entries **are** hard
  errors from day one (false-positive-free; the ledger is authored clean).
- **`enforcement: "error"` (Wave 3 flip):** any remaining `planned[]` entry becomes a hard error. The
  flip is a **one-line data change**, not a code edit.

**Wave-2 forcing-function:** the PR that moves an entry from `planned[]` to `algorithms[]` **MUST land
its test file in the same PR** — the integrity check hard-errors on a realized entry whose declared
`test` does not exist. That is the designed teeth (A4: deterministic kernel code is unit-tested), not a
surprise.

## Members

| id | file | status |
|---|---|---|
| `route-decide` | `route-decide.js` | realized — H.7.3 task-routing scorer |
| `leaf-criteria` | _(planned, R9, Wave 2)_ | watchlist |
| `spawn-verify-route` | _(planned, R11, Wave 2)_ | watchlist |
