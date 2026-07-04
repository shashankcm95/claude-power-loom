# item-6 follow-up — QUERY-side persona case-fold (reputation CLI + circuit-breaker)

Status: BUILDING · Branch `fix/reputation-query-case-normalize` off `origin/main` (`e857312`)

## Problem

`canonicalPersonaKey`'s `BARE_SHAPE` is lowercase-only (`/^[a-z][a-z0-9-]{0,40}$/`,
[canonical-persona-key.js:41](../../lab/persona-experiment/canonical-persona-key.js)). So a mixed-case
query token like `Node-Backend` fails the shape, `canonicalPersonaKey` returns `null`, and the
`|| raw` fallback keeps the token verbatim (`Node-Backend`) — which misses its own canonical
`node-backend` row. Two query-side consumers still fold WITHOUT a `.toLowerCase()`:

- `packages/lab/reputation/cli.js:40` — `canonToken(tok)` (serves `show --persona` and the
  `snapshot --persona/--personas` collect path).
- `packages/lab/circuit-breaker/project.js:392` — `evaluate()` query canon.

The reference already-shipped fold is `packages/lab/reputation/narrow.js:40-43` (`canonToken`):
```js
function canonToken(c) {
  const s = (typeof c === 'string' ? c : String(c)).toLowerCase();
  return canonicalPersonaKey(s) || s;
}
```
This is the third instance of the query-side fold (narrow.js was item-6's HIGH-1/MEDIUM). It closes
the QUERY-side half for the two remaining consumers; the complementary mixed-case-RECORD half is the
verdict-attestation write-boundary normalization (the sibling `fix/reputation-persona-write-case-normalize`
session — DISJOINT file set: it touches `verdict-attestation/store.js` + its test + `reputation/project.test.js`).

Both consumers are SHADOW/advisory and gate nothing; the miss fails in the SAFE direction (a false
"no-row"/"clear", never a false halt). PRE-EXISTING (a mixed-case query already missed a canonical
record before the write fix — verified by live probe), out of scope for the write-side PR.

## Change (mirror narrow.js exactly)

1. `reputation/cli.js:canonToken` — lowercase first, then `canonicalPersonaKey(s) || s`. Mirror the
   narrow.js idiom verbatim (`String()`-coerce for one source of truth, though cli.js's call sites are
   all string-guarded).
2. `circuit-breaker/project.js:evaluate()` — lowercase `rawPersona` before canonicalizing. Keep the
   `rawPersona`/null structure; introduce a `folded` intermediate so the row-lookup logic stays
   structurally identical and the `persona ?` reporting branches are unaffected.

## Invariant to preserve (W4d off-roster distinctness)

`13-foo` vs `foo` must NOT collapse. Case-fold only normalizes CASING; it never strips the numbered
prefix (that is `canonicalPersonaKey`'s job, gated on the KNOWN roster set). `13-foo`/`foo` are already
lowercase, so `.toLowerCase()` is a no-op on them — unaffected. An off-roster `13-Foo` folds to
`13-foo`, `canonicalPersonaKey` strips `13-` → `foo` → off-roster → `null` → stays `13-foo` (distinct
from a `foo` row).

## Tests (a test each, both query paths)

- `tests/unit/lab/reputation/cli.test.js` — (a) `show --persona Node-Backend` hits the canonical
  `node-backend` row; (b) `snapshot --personas 13-Node-Backend` (mixed-case + numbered) resolves to the
  `node-backend` distribution (covers the collectPersonas path).
- `tests/unit/lab/circuit-breaker/project.test.js` — (a) `evaluate({persona:'Node-Backend'})` sees the
  seeded `node-backend` trip (fix-proof: fails clear without the fold); (b) off-roster `13-Foo` does NOT
  collapse onto a seeded `foo` row (invariant lock).

## Runtime Probes

- `canonicalPersonaKey('Node-Backend')` → `null` (uppercase fails `BARE_SHAPE`) — confirms the bug. ✓ (read src)
- narrow.js `canonToken` does `.toLowerCase()` then `canonicalPersonaKey(s) || s`. ✓ (read src)
- `evaluate` uses `personaOfVerdict` (canonicalized) for verdict-fail rows; the project.test.js harness
  pins `negative-attestation` (personaOfNeg = raw), so seeding `node-backend` keys a raw `node-backend`
  row that a folded `Node-Backend` query matches. ✓ (read src + test)
- Only two query-side `canonicalPersonaKey(...) || raw` sites in the named subsystem; the sibling
  `personaOf`/`personaOfVerdict` row-keyers are the record-side (out of scope). ✓ (grep)
- File set disjoint from the sibling write-side session → no merge conflict. ✓ (git status of both worktrees)

## Rigor note

SHADOW/advisory (gates nothing). Per-wave order honored per the task request (circuit-breaker
`evaluate()` is a live-projection consumer). Under ultracode the VALIDATE ran the full 3-lens
adversarial board on the BUILT diff (Rule 2a — attack the implementation with live probes), above the
single-lens minimum a SHADOW change would otherwise take.

## Pre-Approval Verification (VERIFY)

code-reviewer lens on the plan + exact proposed edits → **PASS** (0 CRITICAL/HIGH/MEDIUM/LOW). Confirmed
the mirror is faithful, off-roster distinctness empirically preserved (`13-Foo` → `13-foo` ≠ `foo`), and
`persona` truthiness unchanged for every input class. One non-blocking PRINCIPLE note (DRY — 3rd
near-identical `canonToken`); extraction of a shared `foldPersonaToken` deferred as a separate refactor
(the task scope is explicitly "mirror narrow.js").

## VALIDATE result

Built diff: 4 files, +68/-2 (`reputation/cli.js`, `circuit-breaker/project.js`, + both test files).

- Tests: `cli.test.js` **20/20**, `project.test.js` **18/18** (5 new); 7 broader lab suites + the full
  `packages/lab` tree GREEN (no regression, incl. `narrow.test.js` 12/12, `reputation-gate` 14/14).
- Fix-proof (non-vacuity): reverting the fold fails exactly 3 new cli + 1 new project assertions; restored.
- eslint (repo-wide) clean; markdownlint clean; signpost up-to-date.
- 3-lens adversarial board on the BUILT diff — **PASS / PASS / PASS**:
  - code-reviewer (correctness/regression): PASS. Traced truthiness across all input classes; confirmed
    double-fold idempotency (narrow.js passes an already-lowercased token into `evaluate`).
  - hacker (adversarial): PASS. Live probes — Unicode case-fold (U+212A Kelvin→`k`, Turkish-I, fullwidth,
    U+1E9E) never forges a roster match (non-ASCII fails `BARE_SHAPE`→raw; ASCII folds only match MORE
    lowercase rows = narrows-only); prototype tokens (`__proto__`/`constructor`) safe; off-roster
    distinctness holds. One disclosed LOW residual: a mixed-case RECORD is missed by a folded query
    (false-clear direction) — reachable only via a forged/non-canonical record, gates nothing, and is the
    named write-side follow-up (`narrow.js` carries the same residual → no new class).
  - honesty-auditor (claim-vs-evidence): PASS. "Mirror narrow.js" accurate; both sites folded; both test
    paths (cli show+snapshot, breaker evaluate) exercised. PRINCIPLE: benign form divergence — `project.js`
    omits the dead `String()` coercion (upstream type-guard makes it unreachable there).

Rule 4: NOT recorded to verdict-attestation — this was a root-built diff (only delegated builder spawns
are legal subjects).
