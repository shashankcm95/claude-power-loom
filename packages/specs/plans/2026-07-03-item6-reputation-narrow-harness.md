---
lifecycle: persistent
---

# item-6 — the `narrow` harness: recommendNarrowing's missing live caller (SHADOW/advisory)

**Status:** BUILT + VALIDATE SHIP (code-reviewer SHIP; hacker SHIP-WITH-NOTES, both residuals folded/named) → PR pending USER merge. SHADOW/advisory — reads-only, never gates.

## Context

Gap-map item-6: `reputation/breaker→spawn-select [OPEN — reputation-gate.recommendNarrowing has no
live caller]`. `recommendNarrowing(candidates, reputation, breakerOf, opts)` (reputation-gate.js,
v3.10-W3) is a **pure** function that combines two INDEPENDENT axes — the reputation distribution
(down-weight) + the breaker (reroute) — into a per-candidate `proceed`|`down-weight`|`reroute`
advisory (NEVER a hard exclude). Its own header says: *"production stays OPEN until a future
enforcement wave wires it into selection ... the harness reads the stores + pins breakerOf to the
LIVE default source verdict-fail."* item-6 builds that missing harness — the live caller.

**This stays SHADOW/advisory.** Per the consumer convention (agent-identity-reputation.md): the
reputation/breaker consumers are orchestrator-invoked, narrows-only (A3b — never a hard gate,
§0a.3.1-clean because the orchestrator narrows its OWN spawn choice, not a kernel transition). The
whole lab weight/reputation track is SHADOW until #273 closes; the north-star: *a live signal only
HARDENS trust, it never gates until an authenticated minter exists*. `narrow` emits a recommendation
the orchestrator MAY consult; nothing acts on it automatically.

## Runtime Probes (verified against the tree 2026-07-03)

- **P1 — `projectReputation()` emits exactly `recommendNarrowing`'s expected shape.** Probe:
  `project.js:137-144` returns `{ generated_at, source: SOURCE ('verdict-attestation'), label,
  excluded_*, personas: [{persona, total, distinct_spawns, pending_enrichment, by_verdict, ...}] }`.
  `recommendNarrowing`'s structural guard (`reputation-gate.js:67`) requires `reputation.source ===
  SOURCE && Array.isArray(reputation.personas)` — satisfied by the LIVE projection. → the harness
  feeds `projectReputation()` (NOT the A6 `.value` snapshot, whose shape would fail the guard →
  `unauthenticated-lane` → proceedAll). See design Q1 on whether that's §0a.3.1-clean.
- **P2 — the breaker `evaluate` is the `breakerOf` source.** Probe: `circuit-breaker/project.js:385`
  `evaluate({persona, source?, stateDir?, now?, requireLive?})`, `DEFAULT_SOURCE='verdict-fail'`,
  exported (`:443`). Returns `{tripped, source, source_starved, global_tripped, persona_tripped,
  ...}` — exactly the fields `recommendNarrowing`'s axis-B reads. → `breakerOf = (c) => evaluate({persona:
  c, now})` (default source = the LIVE `verdict-fail`; NO `--source` exposed — see design Q3).
- **P3 — no live caller today.** Probe: `grep -rn recommendNarrowing packages --include=*.js | grep -v
  test | grep -v _spike | grep -v 'function recommendNarrowing'` → the only refs are the defn + docs.
- **P4 — the existing consumers are orchestrator CLIs.** Probe: `reputation/cli.js` has
  `show`/`materialize`/`snapshot`/`verify-snapshot`; `circuit-breaker/cli.js check`. `narrow` is the
  MISSING subcommand that COMBINES the two through `recommendNarrowing`.

## The change

1. **New `packages/lab/reputation/narrow.js`** — the IMPURE harness (keeps `reputation-gate.js`
   pure per its charter): `narrow(candidates, {now, minEvidence, passFloor}) → recommendNarrowing(...)`.
   - **CANONICALIZE candidates (VERIFY-hacker HIGH-1):** `const canon = candidates.map(c =>
     canonicalPersonaKey(c) || c)` BEFORE `recommendNarrowing`. The projection keys rows canonical
     (`13-node-backend`→`node-backend`); `recommendNarrowing` looks up verbatim (`:79`,`:84`), so a raw
     numbered-form candidate would miss its own down-weight row → `no-row` → `proceed` (a proven
     laundering lever). `breakerOf` receives the already-canonical token.
   - Reads `projectReputation({now})` for the reputation axis. **MED-1: NOT wrapped in try/catch — a
     store-read fault must FAIL-LOUD (throw / exit non-zero), never launder to `proceed`.**
   - `breakerOf = (c) => { try { return evaluate({persona: c, source: DEFAULT_SOURCE, now}); } catch {
     return null; } }`. **HARD-PIN the source (VERIFY-hacker HIGH-2):** pass `source: DEFAULT_SOURCE`
     ('verdict-fail') EXPLICITLY — `resolveSourceId` uses an explicit source over the
     `LOOM_BREAKER_SOURCE` env, so a poisoned env can't repoint axis B at a starved store and silence a
     reroute. The `try/catch` degrades a breaker THROW to `null` (no-signal) — the ONLY legal fail-safe
     swallow (a dead breaker omits ONE of two independent axes; the reputation axis has no fallback → MED-1).
   - Returns the per-candidate advisory array. NO writes, NO gating.
2. **`narrow` subcommand on `reputation/cli.js`** — `cli.js narrow --personas a,b,c` → prints the
   advisory JSON with a strong `note` (like `snapshot`'s): *"ADVISORY — narrows-only (proceed |
   down-weight | reroute), NEVER a hard gate; the orchestrator judges; a SHADOW read that gates
   nothing."* **Exit 0 always** on a resolved read (an empty store → all `proceed`/`insufficient-evidence`
   is a valid state, not an error) — but exit non-zero on a `projectReputation` throw (MED-1, a fault).
   **Surface `source_starved` (VERIFY-hacker HIGH-2):** when any candidate's `evidence.source_starved`
   is true, emit a LOUD stderr warning (mirroring `circuit-breaker/cli.js:36-39`) — a starved LIVE
   source giving a false-clear must be visible, never masquerade as a clean advisory.
   Extend the CLI header to name `narrow` as an advisory decision-INPUT producer + clarify "routes" =
   the CLI never itself dispatches (architect F2 — charter text widens to match the widened surface).
3. **Tests** `tests/unit/lab/reputation/narrow.test.js` — the harness over injected/fixture stores.
4. **Signpost** regen (new `.js` file → CI Test 121).

## Design questions for the VERIFY board

- **Q1 (architect + hacker) — LIVE projection vs A6 snapshot for the reputation axis.**
  `recommendNarrowing` consumes `projectReputation()` (live). The A6-advise convention says a
  *reputation→decision* flow needs A6-mediation (the snapshot, §3.6). BUT the E11 section says an
  orchestrator-NARROWING consumer *"needs no A6-snapshot mediation"* (it narrows its OWN choice, not a
  kernel transition; a narrow grants nothing). recommendNarrowing is narrows-only (down-weight/reroute
  narrow; proceed is the default) → I lean LIVE projection (matching the fn's contract + the
  narrows-only exemption). Confirm this is §0a.3.1-clean, or require the snapshot.
- **Q2 (architect) — home: a `narrow` subcommand on `reputation/cli.js` (whose header says "never
  writes, gates, or routes") vs a new `reputation-gate` CLI.** A recommendation is advisory, not
  routing — I lean adding it to reputation/cli.js (same stores) with the advisory note. Confirm the
  CLI charter accommodates a decision-COMBINING (still read-only) subcommand, or split it out.
- **Q3 (hacker) — pin the breaker source; do NOT expose `--source`.** The E11 CAUTION: a non-default
  source (`negative-attestation` etc.) is STARVED → a clear result is not a safety signal (a
  laundering lever). The harness PINS `verdict-fail` (the live default), never accepting a caller
  source that could launder a `reroute` away. Confirm the pin + whether the output should surface
  `source_starved` from the breaker so a starved live source is visible.
- **Q4 (hacker) — can a forged/inconsistent reputation launder a candidate to `proceed`?**
  recommendNarrowing already FAILS-TOWARD-NARROWING (malformed total / duplicate row / inconsistent
  by_verdict → down-weight, never proceed) and treats a non-projectReputation object as
  `unauthenticated-lane` → proceedAll. Confirm the harness does not weaken any of those (e.g. by
  passing a hand-built object, or by swallowing a projectReputation throw into a proceed).

## Routing Decision

```json
{ "recommendation": "borderline", "rationale": "lab-tier advisory harness (no kernel/egress/security surface), but TRUST-ADJACENT (the reputation->spawn-select consumer the north-star guards against ossifying/gating). A 2-lens VERIFY (architect for the §0a.3.1/A6-mediation design + hacker for launder-to-proceed / gate-creep / starved-source) is warranted; the full 3-lens tier is not (no data-mutation, no live gate)." }
```

## Disposition

SHADOW/advisory, read-only. On the user's go after VERIFY: TDD build → VALIDATE (hacker re-probes the
built harness: can it be made to gate / launder / read a starved source) → PR → USER merge. It never
gates a spawn — it is the orchestrator-consulted advisory the convention already documents.

## VERIFY result (2-lens, pre-build)

- **architect: SOUND** (2 LOW + 1 LOW-MED). Definitively resolved Q1 + Q2:
  - **Q1 — feed the LIVE `projectReputation()`, NOT the A6 snapshot.** §0a.3.1-clean: A6-mediation
    (§3.6) governs Lab→**KERNEL widening** reads; `recommendNarrowing`'s consumer is the orchestrator
    narrowing its OWN choice — structurally identical to the E11 breaker the doc EXPLICITLY exempts
    (`agent-identity-reputation.md:500-505`). The snapshot (`.value`) would fail the guard → proceedAll
    (silently disabling the advisory), and its trust is WEAKER (integrity-not-authenticity), not stronger.
  - **Q2 — `narrow` on `reputation/cli.js` is within charter.** "routes" = the CLI itself dispatches;
    `narrow` hands a recommendation to the orchestrator (like `snapshot`). A `reputation-gate` CLI would
    be YAGNI + a misleading name. Extend the header (F2).
  - **F4 (LOW-MED, land this wave):** the narrows-only guards live in `reputation-gate.js`; the NEW
    harness surface is where gate-creep would occur → add a test asserting `cli.js narrow` exits 0 for
    every recommendation incl. all-`reroute` + a "NARROWS-ONLY, NEVER GATES — widening requires #273 +
    a new ADR" invariant header line. F1: header names the LIVE/#273-open lane. F3: keep `evaluate()`
    knowledge in `narrow.js` (never the pure module).
- **hacker: NEEDS-REVISION → all folded** (2 HIGH + 2 MED, all PROOF-BACKED / triggered):
  - **HIGH-1 (canonicalize candidates)** — a raw `13-node-backend` misses its `node-backend` down-weight
    row → `proceed` (Probe 4). FOLD: `canonicalPersonaKey(c)||c` before `recommendNarrowing`.
  - **HIGH-2 (hard-pin the source)** — `LOOM_BREAKER_SOURCE=negative-attestation` repoints axis B at the
    STARVED store → reroute silenced (Probe 2). FOLD: pass `source: DEFAULT_SOURCE` EXPLICITLY (beats the
    env in `resolveSourceId`) + surface `source_starved`.
  - **MED-1 (fail-loud)** — do NOT swallow a `projectReputation` throw into `proceed`; let it propagate.
  - **MED-2 (narrows-only invariant test)** — recommendation ⊆ {proceed, down-weight, reroute}; exit 0
    on all-`reroute` (== architect F4).
  - HELD (no change): the pure fn's fail-toward-narrowing on forged/duplicate/inconsistent rows is robust
    and the harness does not weaken it.

Test plan additions (from the folds): canonicalization equivalence (`narrow(['13-node-backend']) ===
narrow(['node-backend'])` over one store); the env hard-pin (`LOOM_BREAKER_SOURCE=negative-attestation`
→ narrow still reads verdict-fail); `projectReputation` throw → non-zero/throw (not all-proceed); the
narrows-only codomain + exit-0-on-all-reroute invariant.

## VALIDATE result (2-lens, post-build over the BUILT diff)

- **code-reviewer: SHIP.** All 5 VERIFY folds confirmed applied AND pin-tested in the built code
  (per-fold table). Injected seams non-reachable from the CLI (`narrow(requested, {})`); no mutation; K12
  layer-clean; double-canon idempotent; no regression (reputation/cli 17/17, circuit-breaker 12+33,
  narrow 10/10). 2 LOW (redundant-but-correct double-canon; output not frozen) — both "matches convention,
  no action."
- **hacker (Rule 2a — LIVE-probed the built harness): SHIP-WITH-NOTES.** ~90 probe inputs, **0
  exploitable-now bypasses**; all 3 VERIFY levers proven CLOSED in the BUILT code (HIGH-1 canon: a
  numbered-form query hits its row; HIGH-2 pin: `source_starved:false` under 9 poison env values via
  `resolveSourceId`'s explicit-short-circuit; MED-1: a throwing store THROWS, CLI exit 1). Codomain sweep
  (30 hostile combos + an injected `exclude` field) → 0 leaks outside {proceed,down-weight,reroute}.
  - **MEDIUM (case-mismatch launder) — FOLDED (query-side) + NAMED (write-side).** A mixed-case token
    (`Node-Backend`) fell back to raw → missed its canonical `node-backend` down-weight row → proceed.
    NOT exploitable now (live store all-canonical; fails SAFE — a missed down-weight, never inverted).
    FOLD: `canonToken` now case-folds (lowercase before canonicalization) — closes the QUERY side (proven:
    `narrow(['Node-Backend'])` → down-weight). The complementary mixed-case-RECORD half is a write-boundary
    normalization in verdict-attestation → NAMED follow-up `task_93e9c55c`.
  - **LOW (undefined candidate drops its key) — FOLDED.** `canonToken` now coerces a non-string to a
    stable string (never a dropped `candidate` key).

Post-fold tests: narrow 10/0, full lab suite 134/0; eslint + signpost clean. SHADOW/advisory, never gates.

- **CodeRabbit: 3 Nitpicks (all Trivial), premise-probed + FOLDED.** (1) `narrow.js` breakerOf: log the
  swallowed breaker throw before returning null (a starved source doesn't throw → the catch only fires on an
  UNEXPECTED evalFn defect; no-silent-catch fundamental). (2) `spawnSync` timeout: 5000 on both CLI tests
  (fail-fast if the CLI hangs). (3) coverage: a `source_starved:true` test (the CLI-warning trigger; tripped
  ignored → no reroute) + a throwing-evaluateFn test (degrades to null, axis A still fires, diagnostic emitted).
  narrow 12/0 post-fold.
