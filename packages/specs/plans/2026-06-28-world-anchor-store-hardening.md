---
phase: hardening
title: World-anchor store hardening - the 3 CodeRabbit Majors missed at #444 review
status: planning
lifecycle: persistent
date: 2026-06-28
---

# World-anchor store hardening (the #444 CodeRabbit Majors)

## Why this exists (honest)

CodeRabbit posted 3 Major inline findings on PR #444 (the world-anchored-by edge store). They were NOT reviewed
before merge because the orchestrator's poll filtered the bot login as `coderabbitai` while the API reports
`coderabbitai[bot]` - so every "0 inline" read was false and #444 merged with 3 unreviewed Majors. All 3 are
premise-probed VALID on merged main (`3a0efd2`), and 2 are SYSTEMIC across all three world-anchor stores (the edge
store copied the pattern from the siblings, so the VALIDATE boards missed them across waves). This PR fixes them.

**Severity reality:** all 3 are SAME-UID issues (the attacker already controls `opts.dir`/the file) in SHADOW lab
code that gates nothing - limited blast radius. But they are real "not-fail-closed" / raceable-cap / idempotency
bugs the stores' own headers claim to defend, so they are fixed, with a red-test per finding.

## The 3 findings (premise-probed, file:line on `3a0efd2`)

| # | Sev | Issue | Sites |
|---|---|---|---|
| C1 | Major | `ensureStoreDir` runs `mkdirSync`+`chmodSync` BEFORE the `lstatSync` symlink/foreign check, so a symlinked `dir` has its TARGET chmod'd before rejection (mutate-before-validate; `chmod` follows symlinks) | edge-store:119, world-anchor-store:96, live-recall-store:135 |
| C2 | Major | `bodiesEqual` compares `recorded_at`, but the header says `recorded_at` is OUTSIDE the identity basis - so a re-record at a different time is a `collision` instead of an idempotent dedup | edge-store `bodiesEqual` (~150-156) |
| C3 | Major | the oversize guard is RACEABLE: `fstat` checks `st.size`, then an UNBOUNDED `readFileSync(fd,'utf8')` re-reads - a same-uid writer can grow the fd between the two and bypass `MAX_*_BYTES` | edge-store:239, world-anchor-store:304 + :339, live-recall-store:212 |

## The fixes

### C1 - validate BEFORE mutate (all 3 `ensureStoreDir`)
Move the `lstat` symlink/non-dir/foreign checks BEFORE `chmodSync`. `mkdirSync(recursive)` stays first (it creates
if absent and its `mode` applies ONLY on create - it does NOT follow+mutate an existing symlink's target; only
`chmod` does). Best-effort `mkdir` (caught), then fail-closed `lstat`, then reject symlink/non-dir/foreign, then
`chmod` only on a validated, owned, real dir:
```
try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort; lstat below fail-closes if absent */ }
const st = fs.lstatSync(dir);                 // fail-closed if absent
if (st.isSymbolicLink()) throw ...;
if (!st.isDirectory()) throw ...;
if (isForeign(st, selfUid)) throw ...;
fs.chmodSync(dir, 0o700);                      // only AFTER validation - never chmod a symlink target
```

### C2 - `recorded_at` out of `bodiesEqual` (edge store)
Remove `&& a.recorded_at === b.recorded_at` from `bodiesEqual` (CodeRabbit's proposed diff). A re-record with the
same `(from_node_id, to_delta_ref, edge_type, sig)` but a different `recorded_at` then DEDUPS (idempotent, the
first `recorded_at` kept), matching the header. The signed-vs-unsigned collision is UNCHANGED (`sig_alg`/`edge_sig`
stay in `bodiesEqual`).

### C3 - bounded read, not unbounded `readFileSync(fd)` (all 4 read sites)
Replace `JSON.parse(fs.readFileSync(fd, 'utf8'))` with a read bounded to `MAX_*_BYTES + 1` through the fd, looping
to handle short reads, rejecting if the content exceeds the cap (the file grew after `fstat`):
```
const cap = MAX_EDGE_BYTES; // or MAX_RECORD_BYTES
const buf = Buffer.alloc(cap + 1);
let n = 0, r = 0;
do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
if (n > cap) { <emit oversize-race>; return null; }   // grew past the cap after fstat
const parsed = JSON.parse(buf.toString('utf8', 0, n));
```
The existing `st.size` pre-check STAYS (a fast early reject for the common oversize case); the bounded read is the
race-proof guard. Each store keeps its own emit shape (`alert(...)` / `emitEgressAlert(...)`).

## Files
| File | Change |
|---|---|
| `packages/lab/world-anchor/world-anchor-edge-store.js` | C1 (ensureStoreDir reorder) + C2 (bodiesEqual) + C3 (1 read site) |
| `packages/lab/world-anchor/world-anchor-store.js` | C1 + C3 (2 read sites) |
| `packages/lab/world-anchor/live-recall-store.js` | C1 + C3 (1 read site) |
| `tests/unit/lab/world-anchor/{world-anchor-edge-store,world-anchor-store,live-recall-store}.test.js` | a red-test per finding per store (see below) |

## Tests (a non-vacuous red-test per finding; must FAIL RED against the unfixed code first)
- **C1:** a symlinked store `dir` -> refused, AND the symlink TARGET's mode is UNCHANGED (snapshot the target's mode
  before, assert unchanged after the refused write) - proves the chmod no longer touches the target.
- **C2 (edge):** write an edge, then re-write the SAME (from,to,type) with a DIFFERENT `recorded_at` -> `{ok:true,
  deduped:true}` (idempotent), NOT `reason:'collision'`; the stored `recorded_at` stays the first. (The existing
  signed-vs-unsigned collision test stays green.)
- **C3:** plant a record whose `st.size` is within the cap but whose CONTENT exceeds the cap when read... since the
  TOCTOU race needs concurrency, the deterministic proxy: assert the bounded read rejects a file > cap (the existing
  oversize test stays green) AND a unit test on the bounded-read helper that a >cap fd is rejected via the read, not
  only the stat. (A true concurrent-growth probe is the VALIDATE hacker's live re-probe.)

## Out of scope (scope-creep guard) - TRACKED follow-ups, not silently dropped

This PR does NOT touch the integrity-vs-provenance residual (ladder item 5); the same-uid co-forge remains open by
design. These are SAME-UID, SHADOW correctness/hygiene fixes, NOT a trust/#273 advance.

Tracked follow-ups (named so a later reviewer does not re-find them as unreviewed Majors):
- **The siblings carry the same C2 CLASS via `content_hash`** (VERIFY hacker H1): `world-anchor-store.bodiesEqual`
  compares `content_hash` (which seals `emitted_at`) and `confirmationsEqual` compares `confirmed_at`, so a benign
  re-record at a different time is a `collision` there too. LEFT AS-IS this PR because the mechanism differs - the
  siblings' timestamps are inside a DELIBERATE full-record tamper seal (`content_hash`), not a free field like the
  edge store's `recorded_at` - so excluding them would weaken the seal and is a separate design change. **Note:** the
  production `runRecordMerge` re-run path uses `confirmed_at = new Date()` when no `opts.now`, so a re-run for an
  already-merged PR would `collision` on the confirmation - a real (minor) idempotency gap, deferred with this item.
- **`recall-graph-store.js:162`'s bare `readFileSync`** is a KNOWN un-fixed C3-class instance (cited in the
  `live-recall-store.js:33` / `world-anchor-edge-store.js:33` headers as the #439 antipattern). Deferred to a broader
  store-read-path audit; NOT fixed here (out of the world-anchor-store family + would balloon the diff).
- A broader sweep of OTHER subsystems' stores (`recall-edge-store`, kernel stores) for the same patterns.
- Any behavior change beyond the 3 findings (e.g. do NOT also drop the now-redundant from/to/type comparisons in
  `bodiesEqual` - a no-behavior-change refactor belongs in a separate PR; architect C2-NULL-FIELD-SYMMETRY).

## HETS Spawn Plan
- **VERIFY (3-lens):** `architect` (the C1 reorder correctness - does `mkdir` before `lstat` mutate a symlink
  target? is the best-effort/fail-closed split right?; the C3 bounded-read + short-read loop; scope boundary) +
  `hacker` (does C3 ACTUALLY close the race; can the bounded read be bypassed; does C1 leave any mutate-before-
  validate; are there OTHER instances in these 3 stores) + `honesty-auditor` (no over-claim - these are same-uid
  SHADOW fixes, not a provenance/trust change).
- **VALIDATE (3-lens, Rule 2a):** `code-reviewer` + `hacker` live-reprobe of the BUILT fix (a real concurrent-growth
  probe on C3; a symlink-target-mode probe on C1; the suites green) + `honesty-auditor`.

## Drift Notes
- ROOT CAUSE (graduate-worthy SCAR): the CodeRabbit poll filtered `user.login=="coderabbitai"` but the pulls/comments
  API reports `coderabbitai[bot]` -> false "0 inline". The correct fetch is `select(.user.login=="coderabbitai[bot]")`
  (or a contains-match), AND cross-check the review body's "Actionable comments posted: N" count. This already let 3
  Majors reach merge; recorded in MEMORY's SCAR list. The poll is ORCHESTRATION code (a throwaway `gh api` one-liner),
  NOT a substrate file - so the SCAR is a separate process fix, not a diff in THIS PR (honesty H2).

## Pre-Approval Verification (3-lens board `wf_f95dc960-992`, 2026-06-28)

**Verdict: PROCEED-WITH-FOLDS (architect + hacker + honesty). No CRITICAL. All folds applied above / into the build.**
The hacker EMPIRICALLY confirmed all 3 fixes: `mkdirSync` on a symlink-to-dir does NOT change the target mode (755
stays 755) while the current `chmodSync` DOES follow it (755->700), so the C1 reorder fully closes it; the C3
do/while bounded-read catches a real 10->110 concurrent grow with NO off-by-one (exactly-cap accepted, cap+1
rejected) and terminates on a 0-byte file; C2 preserves the signed-vs-unsigned collision. Folds:
- **C3 (architect HIGH + hacker H3): a per-store `readBoundedJson(fd, cap)` helper** (one tested function, not 4
  hand-transcribed loops); `Buffer.alloc(cap+1)` + read-length `cap+1-n` PINNED load-bearing (a comment forbids
  `Buffer.alloc(cap)`); fix ALL 4 sites incl. world-anchor-store's TWO (`readAnchorRaw` + `readConfirmationRaw`,
  architect C3-FOURTH-SITE). Per-store helper, NOT cross-store-shared (the deliberate-duplication header).
- **C3 tests (hacker H4 / honesty H5): non-vacuous** - call the helper DIRECTLY on a >cap fd (bypass the `st.size`
  pre-check, which otherwise SHADOWS the bounded read) + boundary tests at EXACTLY cap (accept) and cap+1 (reject)
  per store; the red-test must fail RED against the unbounded `readFileSync`, not the retained `st.size` check.
- **C2 (architect + hacker H2): minimal diff** (drop ONLY `recorded_at`); the dedup-on-different-`recorded_at` test
  asserts `{deduped:true}` + the STORED `recorded_at` stays the FIRST; the existing signed-vs-unsigned collision
  test stays GREEN (a divergent-SIG body STILL collides+alerts - reduced timestamp-path observability is a recorded
  decision, not a silent regression).
- **Deferrals TRACKED (architect SCOPE + hacker H1 + honesty H4):** the siblings' `content_hash`-timestamp same-class
  + `recall-graph-store.js:162` + the non-claim line - all in the Out-of-scope section above.
- **honesty H2:** the poll-bug root cause is a separate orchestration SCAR (in MEMORY), not a diff here.

## VALIDATE result (3-lens board `wf_b3cc64b0-23b`, 2026-06-28)

**Verdict: hacker SHIP / code-reviewer + honesty SHIP-WITH-FOLDS. Zero CRITICAL/HIGH security residual.**
The hacker ran **25 live probes** against the BUILT diff: C3 (grow-after-open past cap, sparse file, shrink-then-read,
EXACTLY cap accepted / cap+1 rejected, positional-read-from-0) all reject correctly with no off-by-one + no fd leak;
C1 (symlink-to-dir / -nonexistent / chain / -file) all refuse with the target mode UNCHANGED, proven non-vacuous vs
the reconstructed old chmod-before-lstat order; C2 dedups a different-recorded_at re-record while a divergent SIG
still collides+alerts. The real `~/.claude/lab-state` was byte-unchanged. 3 folds applied:
- **F1 (HIGH - fail-closed-must-be-observable):** world-anchor-store's store-dir refusal was SILENT (siblings emit).
  Added `emitEgressAlert('world-anchor-store-dir', ...)` to BOTH write-path catch blocks + a test asserting it fires
  (confirmed RED without the emit).
- **F2 (MED - telemetry null-conflation):** `readBoundedJson` returned `null` for BOTH oversize AND a literal-`null`
  body. Refactored to `readBoundedText(fd, cap)` (returns the bounded TEXT or `null` ONLY for oversize; the caller
  JSON.parses inside the outer try) across all 3 stores / 4 read sites -> a literal-null body now reads as
  not-an-object, not oversize-race; `Buffer.alloc(cap+1)` + `cap+1-n` kept load-bearing.
- **F3 (LOW):** added a direct-helper test for the confirmation sidecar (bypasses st.size) + a distinct
  `confirmation-oversize-race` label.

**Gate after folds:** world-anchor suite (36 + 35 + 20 + siblings) all green; eslint + ASCII clean; the 4 drift
gates clean. Same-uid SHADOW correctness/observability fixes; NOT a trust/#273/provenance advance.
