---
lifecycle: persistent
---

# item-6 follow-up — case-normalize `subject.persona` at the verdict-attestation WRITE boundary

## Context

The item-6 VALIDATE hacker surfaced a case-mismatch laundering gap (`task_93e9c55c`, deferred from
item-6): `validateRecordVerdictInput` (`packages/lab/verdict-attestation/store.js`) accepts
`subject.persona` as any non-empty, control-char-free, bounded string — it does **not**
lowercase/roster-normalize. Because `canonicalPersonaKey`'s `BARE_SHAPE` is lowercase-only, a record
written mixed-case (`Node-Backend`) makes every reputation consumer's `personaOf` fall back to RAW,
keying the projection row under `Node-Backend` instead of the canonical `node-backend`. A consumer
querying the canonical key MISSES the mixed-case row → a poor distribution is silently skipped → the
advisory proceeds. It fails in the SAFE direction (a missed down-weight, never inverted) and is not
exploitable against today's all-canonical live store, so it was deferred.

item-6's `narrow` harness already closed the QUERY side (`canonToken` case-folds before
canonicalization). This closes the complementary WRITE side for ALL reputation consumers
(show / snapshot / narrow / circuit-breaker), not just narrow.

## Routing Decision

```json
{
  "task": "lowercase-normalize subject.persona at the recordVerdict write boundary ...",
  "recommendation": "root",
  "confidence": 0.5,
  "score_total": 0.15,
  "scores_by_dim": { "compound_strong": { "matched": ["verdict-attestation"], "raw": 1, "weight": 0.15, "contribution": 0.15 } },
  "weights_version": "current"
}
```

`root` — a single-perspective, well-scoped change. Per the task's explicit request (it touches a
store write path), still run per-wave VERIFY/VALIDATE, but right-sized: 2 read-only lenses
(architect + hacker) at VERIFY, hacker re-probe at VALIDATE — NOT a full HETS build team.

## The change (design)

**Chosen seam: the WRITE boundary** (`validateRecordVerdictInput`), NOT the read-path `personaOf`.
Rationale (normalize once at ingest; every read stays a pure `canonicalPersonaKey(raw) || raw`):

- **`recordVerdict` is the SOLE persona-write boundary.** The CLI (`cli.js:168,232`) routes through
  it; the enrich paths (`enrichRecord`/`enrichRecords`/`applyEnrichment`) never touch
  `subject.persona`. Normalizing here covers show / snapshot / narrow / circuit-breaker with one edit.
- **The read path MUST stay untouched.** `project.test.js`'s `rawRec` fixture hand-writes
  `persona: 'pRaw'` (mixed-case, off-roster) via `writeRawLedger` (bypassing `recordVerdict`).
  Case-folding in `personaOf` would rewrite `pRaw` → `praw` and break that + risk collapsing distinct
  raw personas. The write boundary leaves hand-crafted-ledger tests alone.
- **The roster is all-lowercase** (`agents/*.md`), so case-variants of a token ARE the same logical
  persona — lowercasing is a safe normalization, never a wrongful collapse of two distinct personas.
- **`attestation_id` excludes persona** (`store.js:219` basis = `[agentId, identity, kind, verdict]`),
  so normalizing does not perturb dedup/content-address.

**Edit** — in `validateRecordVerdictInput`, after the `nonEmptyString(subject.persona)` check,
compute `const persona = subject.persona.toLowerCase();`, run the length + control-char checks on the
**normalized** value (so the bound/control-char invariants hold on exactly what lands on disk — the
`İ`→2-char growth edge then fails CLOSED at the 512 cap, the safe direction), and return
`subject: { persona }` (a fresh object → immutability-safe, drops extraneous caller fields). No new
import (`.toLowerCase()` is native; `canonicalPersonaKey` already imported for the H-1 guard).

**H-1 mislabel guard: left unchanged (considered).** With normalization, two NEW records
`Node-Backend` + `node-backend` for one agentId now correctly read as the SAME persona (a strict
improvement — before, a false mislabel throw). A hand-written LEGACY mixed-case row + a new lowercase
input for one agentId would false-throw, but (a) no legacy mixed-case rows exist in the live store,
(b) the throw is FAIL-CLOSED (rejects the write, corrupts nothing), (c) it is pre-existing behavior,
not a new regression. Out of scope to touch the guard.

**Off-roster distinctness preserved.** `13-foo` vs `foo` differ by numbered PREFIX (not case) — both
already lowercase → lowercasing leaves them distinct → `project.test.js` test 15 preserved. Lowercase
collapses ONLY case-variants of the SAME token (`Foo`≡`foo`), which is the desired normalization.

## Runtime Probes

- **Bug reproduced (pre-fix, against origin/main e857312):** wrote `Node-Backend` through
  `recordVerdict` + enrich → `STORED subject.persona = "Node-Backend"`; `PROJECTION persona keys =
  ["Node-Backend"]`; canonical `node-backend` query hits row? = **false** (the gap). ✅ non-vacuous.
- **Fix probe (post-build) — CONFIRMED:** same input → STORED `node-backend`, PROJECTION keys
  `["node-backend"]`, canonical `node-backend` query hits row = **true**. MEDIUM-1 cap edge:
  `U+0130`×257 (lowercases to 514) → **REJECTED at the 512 cap** (validates on the normalized value,
  fails closed).
- **Regression probe — CONFIRMED:** ALL 135 `tests/unit/lab/**` suites green (esp. project test 15
  off-roster + store 13c/13d mislabel). eslint clean; markdownlint clean.

## Pre-Approval Verification (VERIFY board, pre-build)

- **architect — APPROVE-WITH-NITS:** write boundary is the correct seam (SOLID/DRY/KISS all favor it);
  `recordVerdict` confirmed the sole persona producer (cli routes through it; enrich never touches
  persona); off-roster distinctness (test 15) preserved; immutability correct; H-1 scope-out sound.
  Actionables folded: (a) apply the normalized local to BOTH the cap + control-char checks, (b) add a
  test documenting the accepted legacy-mixed-case-row residual, (c) cross-reference `narrow.js:canonToken`
  at the boundary, (d) fix the `İ`-cap rationale wording.
- **hacker — SAFE-WITH-NOTES** (0 CRITICAL/HIGH; could not construct a laundering lever the fix opens):
  MEDIUM-1 = the normalized-value validation build requirement (probed GREEN above); MEDIUM-2 = the
  legacy-row false-throw (fail-closed, no live occurrence, tested by 13g); LOW-1 = `cli.js stats` reads
  raw (display-only, not a gate); LOW-2 = off-roster case-variant collapse is DESIRED, not wrongful;
  `.toLowerCase()` (not locale) is the correct locale-independent choice.

## Build result

- `store.js`: case-fold at the write boundary + normalized-value cap/control-char checks + fresh
  `subject: { persona }` return + corrected mislabel-guard comment. No new import.
- Tests: store 13e (stored lowercased + id-stable dedup), 13f (mixed+canonical coexist), 13g (legacy-row
  accepted residual); project 16 (end-to-end canonical query hits it), 17 (off-roster case folds, prefix
  distinct). Pre-existing opaque uppercase labels lowercased to match canonical storage.

## Tests

- **store.test.js** — (a) a mixed-case persona is STORED lowercased (`Node-Backend` →
  `rec.subject.persona === 'node-backend'`, persisted); (b) `Node-Backend` then `node-backend` (distinct
  verifiers) for ONE agentId coexist (no false mislabel), both stored `node-backend`; (c) `Foo`≡`foo`
  same-agentId is the same persona (no mislabel) while `Foo` vs `bar` still throws (distinctness kept).
- **project.test.js** — a record WRITTEN `Node-Backend` projects under the canonical `node-backend`
  row (the "canonical query hits it" end-to-end); off-roster `Foo`→`foo` normalizes while `13-foo`
  stays distinct from `foo` (case normalizes, prefix does not).

## HETS Spawn Plan

| Persona | Role | Why |
|---|---|---|
| architect (read-only) | VERIFY: design soundness | is the write boundary the right seam? does it preserve read-path purity + the off-roster distinctness invariant? |
| hacker (read-only) | VERIFY: adversarial | can case-folding be a laundering lever (collapse distinct personas / launder a down-weight / bypass the cap or control-char check)? |
| hacker (read-only) | VALIDATE: re-probe BUILT code (Rule 2a) | live-probe the built store — does it actually store lowercased? any crafted-input bypass? |

## VALIDATE result (post-build, Rule 2a — lenses live-probed the BUILT code)

- **hacker — SAFE-WITH-NOTES** (0 CRITICAL/HIGH; no laundering lever the fix opens). All 6 attack classes
  probed live: wrongful-collapse HELD (19 roster names all lowercase, no case clash), `U+0130`×257 cap
  edge REJECTED post-fold, control-char reject set airtight both fold directions, H-1 guard
  non-vacuous + case-variant-tolerant, `attestation_id` dedup invariant, legacy-row residual fail-CLOSED.
  Residuals: MEDIUM = the circuit-breaker CLI query-side (see below); LOW = legacy-row migration caveat
  (tested by 13g); NIT = `U+212A` (Kelvin) → `k` folds but grants nothing on an open-writable SHADOW
  ledger (byte-identical to a direct canonical write; same-uid co-forge ceiling).
- **code-reviewer — APPROVE** (0 CRITICAL/HIGH). Verified live: persona normalized consistently at all
  three recordVerdict uses; both cap + control-char checks on the normalized local; fresh `{ persona }`
  return; the mislabel-guard comment accurate. NIT (folded): commit the `U+0130` cap edge as a
  regression test → **done (store test 4c)**.
- **Blocking: none.** store 25/0, project 17/0, full lab 135/0; eslint + markdownlint clean.

### Deferred (out of scope — the QUERY-side mirror, pre-existing)

The VALIDATE hacker surfaced that the reputation `show`/`snapshot` CLI (`cli.js:39-41` `canonToken`) and
the circuit-breaker `evaluate()` (`project.js:391-392`) pass a MIXED-CASE query VERBATIM (no
`.toLowerCase()`), so a `Node-Backend` query misses the now-canonical `node-backend` row. This is the
INVERSE of this task's gap (a canonical query missing a mixed-case row) and is **pre-existing** — a live
probe confirmed a mixed-case breaker query already missed a canonical record independent of this change.
Only `narrow.js:canonToken` folds its query (item-6). Deferred to follow-up `task_9e071ff5` (add
`.toLowerCase()` to both query-canon sites, mirroring `narrow.js`). Fail-safe/SHADOW; no live consumer.

## Drift Notes

- route-decide returned `root`; task explicitly requested per-wave rigor for a store-write path.
  Right-sized to 2 VERIFY lenses + 1 VALIDATE lens rather than a full build team (anti-over-spawn).
