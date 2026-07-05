# Intake Gate — Wave 2 (Gap-7 Part-B) + Gap-9 disposal stub: terminal-block classify → dispose

Status: PLANNED (2026-07-05). Realizes Gap 7 / Part B + Gap 9 (design sketches in
`packages/specs/research/2026-07-04-intake-pr-acceptance-gate-design.md` §Part-B and
`packages/specs/research/2026-07-04-live-dogfood-lifecycle-gaps.md` §Gap-9). Follows Part A / Wave 1 (#513).

## Context

The colophon dogfood surfaced three world-contact rungs. Wave 1 (#513) shipped Gap-7 Part-A
(`hasExternalMergeHistory`, a SHADOW/dormant intake heuristic). This wave adds the two rungs that interlock at the
END of a candidate's life:

- **Gap-7 Part-B — submit-time terminal-block classifier.** The definitive PR-acceptance signal is the
  `CreatePullRequest` permission error at submit (the admin-only interaction limit is invisible to the Part-A
  heuristic). Classify that error as a **terminal block** (`pr-creation-restricted`) — a candidate whose repo can
  never merge our PR — so it is recorded (calibrates Part-A) and triggers disposal instead of leaving inert residue.
- **Gap-9 — disposal stub.** "Only merged is retained" is currently *non-promotion* (passive), not disposal. Every
  dry run leaves durable residue (a `draft-*.json` + a `live-pending` lesson node + a cost-ledger line) that
  accumulates forever with no reaping. Add an **observable, immutable-tombstone disposal** triggered by a terminal
  block (and reusable by a future background expiry), honoring the content-addressed / uid-owned / O_NOFOLLOW /
  never-silent-delete invariants of the pending store.

Both stay **SHADOW/dormant**: the classifier only fires on the operator-only armed emit path (which never populates
`forkRepo` and runs killswitch-on today), exactly like Part-A. Nothing here gates a live weight or spawn decision.

## Routing Decision

route-decide.js returned `root` (0.15) but fired `[ROUTE-META-UNCERTAIN]` (substrate-meta catch-22: `tombstone`,
`content-addressed` under-scored by the general dictionary). Escalated by judgment per H.7.16 + the ultracode
directive — this is architect-shaped (new store shapes + #273/immutability/tombstone design + a kernel-boundary
call). Verbatim route-decide JSON:

```json
{ "recommendation": "root", "confidence": 0.5, "score_total": 0.15, "substrate_meta_detected": true,
  "substrate_meta_tokens": ["tombstone", "content-addressed"], "weights_version": "v1.3-dict-expanded-2026-06-12",
  "signals_matched": ["content-addressed"], "forced": false, "uncertain": false }
```

## HETS Spawn Plan

- **VERIFY (pre-build, on THIS plan):** the 3-lens board in parallel — `architect` (design soundness: sibling-store
  vs enum-extend, lab-classify vs kernel-touch, tombstone shape + disposal ordering) + `hacker`
  (adversarial-security: can disposal erase attack evidence? can a forged terminal-block skew calibration? is the
  classifier fooled by a non-terminal 403? does anything reach a privileged path?) + `code-reviewer` (correctness +
  the immutability/uid/O_NOFOLLOW/fail-soft invariants).
- **VALIDATE (post-build, on the BUILT diff):** the same 3-lens tier — `code-reviewer` (correctness) + `hacker`
  (LIVE re-probe of the built stores + classifier against forged/adversarial inputs) + `honesty-auditor`
  (claim-vs-evidence: is it truly SHADOW/dormant + byte-inert on the existing dry pipeline?). Rule 2 (kernel/
  security/data-mutation class) → full 3-lens tier required.

## Files To Modify

- **NEW** `packages/lab/issue-corpus/terminal-block.js` — the pure classifier `classifyEmitTerminalBlock(emitResult)`
  → `{ terminal: boolean, block_reason: 'pr-creation-restricted' | null }` (reads emitPR's existing `{ok,reason}`;
  ZERO kernel change) + a candidate-keyed SHADOW terminal-block outcome store (append + list; observable).
- **NEW** `packages/lab/causal-edge/live-disposal.js` — `disposeCandidate({ record_id, reason, pendingNodeId?, artifactPath?, ... })`
  → writes an observable immutable disposal tombstone + marks the pending lesson dead (sidecar tombstone, NOT an
  in-place mutation) + optionally reaps the draft artifact (logged). Fail-soft; never throws into the caller.
- **MOD** `packages/lab/causal-edge/live-pending-store.js` — add a READ-side `tombstonePendingLesson(node_id, reason)`
  (writes a `.tombstone` sidecar; the node file is immutable) + `isPendingTombstoned(node_id)` for listers to skip.
  No mutation of the content-addressed node; uid/O_NOFOLLOW parity with the existing read path.
- **MOD** `packages/lab/persona-experiment/live-draft-run.js` — after `emitFn` returns/throws, classify the result;
  on a terminal block, record the terminal-block outcome + invoke `disposeCandidate` (fail-soft, behind a default-off
  `disposeOnTerminalBlock` dep so the shipped dry pipeline is byte-inert).
- **MOD** `packages/lab/persona-experiment/live-solve-one.js` — thread the (default-off) disposal dep + surface the
  terminal-block/disposition in the run report. No new user-facing flag armed by default.
- **NEW** `tests/unit/lab/issue-corpus/terminal-block.test.js` and `tests/unit/lab/causal-edge/live-disposal.test.js`,
  plus extensions to the pending-store and live-draft-run suites.

## Runtime Probes (verify the premises before building)

- Probe: `grep -n "reason:.*err.message\|runGh:" packages/kernel/egress/{emit-pr,gh-emit}.js` → CONFIRMED emitPR's
  outer catch returns `reason: err.message` and runGh's message is `runGh: gh <args.slice(0,2)> failed (HTTP NNN)`
  → the endpoint (`api repos/o/r/pulls`) + HTTP status ARE in the reason string. So a lab classifier matching
  `HTTP 403` + `/pulls` needs NO kernel change. (emit-pr.js:686-689, gh-emit.js:154.)
- Probe: `grep -n "OUTCOMES = Object.freeze" packages/lab/world-anchor/merge-outcome-store.js` → `['merged']` at
  :99; the record is keyed by `join_key_id`/`pr_number`/`pr_url` (:206-226) → a terminal block has NONE of those
  (no PR created) → it CANNOT be a merge-outcome record. Sibling store confirmed, not an enum extend.
- Probe: `grep -n "module.exports\|function.*Pending\|O_NOFOLLOW\|selfUid\|content_hash" packages/lab/causal-edge/live-pending-store.js`
  → the store is content-addressed (`computeContentHash`), uid-owned (`isForeign`), O_NOFOLLOW read path
  (readNodeRaw), and has NO delete/expire API → disposal must ADD one honoring those invariants.
- Probe: `grep -n "emitFn(\|emitPR(data, {})" packages/lab/persona-experiment/live-draft-run.js` → emitFn is called
  with `{}` opts (dry) at :323; a throw is caught → `emit-threw` outcome. The armed create-error is UNREACHABLE in
  the shipped dry pipeline → the classifier is dormant by construction (SHADOW).

## Phases

### Build

1. `terminal-block.js`: pure `classifyEmitTerminalBlock({ ok, emitted, reason })` — terminal iff `ok===false` AND the
   reason matches BOTH an HTTP-403/404 permission signal AND the `/pulls` create endpoint (a 403 on an earlier
   tree/commit/ref step is NOT a PR-acceptance block — do not misclassify). Tri-state safe: an ambiguous/absent
   reason → `{terminal:false}` (never over-claim a block). Plus a candidate-keyed append-only terminal-block store
   (`{repo, issue_ref, candidate_patch_sha, block_reason, at}`) — observable, SHADOW, gates nothing.
2. `live-pending-store.js`: `tombstonePendingLesson(node_id, reason)` writes a `<node_id>.tombstone` sidecar
   (immutable node untouched); `isPendingTombstoned` + list-skip. uid/O_NOFOLLOW parity; observable alert.
3. `live-disposal.js`: `disposeCandidate(...)` — observable disposal tombstone record + pending tombstone + optional
   logged artifact reap. Fail-soft (returns `{disposed, reason}`, never throws). Never a silent unlink.
4. Wire into `live-draft-run.js` (default-off `disposeOnTerminalBlock`) + `live-solve-one.js` report surface.

### Test (TDD — write first, expect red)

- classifier: 403+/pulls → terminal; 403 on tree/commit/ref → NOT terminal; 404-on-pulls → terminal (repo/perm);
  a dry `{ok:true,emitted:false}` → NOT terminal; a network timeout (no HTTP status) → NOT terminal (tri-state).
- disposal: writes an observable tombstone; pending node file is UNCHANGED after tombstone (immutability); a foreign
  uid node is refused; a double-dispose is idempotent + observable; fail-soft on a missing artifact.
- byte-inert: the shipped dry pipeline (dispose dep default-off) produces an identical run report + writes no
  tombstone/terminal-block record.

### Validate

- 3-lens tier on the built diff (code-reviewer + hacker LIVE re-probe + honesty-auditor).
- `bash install.sh --hooks --test` + the full kernel + lab suites green; `node scripts/generate-signpost.js --check`
  (two new `.js` files → SIGNPOST drift gate).

## Verification Probes (post-build)

- `node -e` drive `classifyEmitTerminalBlock` on the 5 fixture reasons → the documented tri-state matrix.
- `node -e` dispose a fixture candidate → assert the pending node file bytes are unchanged + a tombstone sidecar
  exists + an observable alert fired.
- Run `live-solve-one` on a fixture in the default (dispose-off) mode → assert byte-identical report + zero
  tombstone/terminal-block writes (dormancy).

## Out of Scope (Deferred)

- The **background expiry** of pending lessons older than N days (Gap-9's second half) — this wave is the
  terminal-block-triggered disposal only.
- A **kernel structured `block_reason`** on emitPR (vs the lab classifier reading `err.message`) — deferred until
  arming; the string carries the endpoint + status today, and touching the crown-jewel egress is not warranted for a
  dormant classifier.
- **Physical artifact deletion policy** — the stub reaps only when an `artifactPath` is passed + logs it; the default
  is tombstone-only (retain the evidence). A retention/GC policy is a follow-up.
- **Gap-8 review-loop** (the bigger rung) — unchanged; still design-sketched.
- Calibration hardening (using terminal-block records to HARD-gate Part-A) — needs an authenticated minter (#273)
  before a forgeable record can gate; this store is observability-only.

## Drift Notes

- route-decide `[ROUTE-META-UNCERTAIN]` fired (tombstone/content-addressed) — a fresh substrate-meta catch-22
  instance; escalated by judgment. Candidate calibration data for the dictionary.

## Why this is the right shape

Smallest surface that closes both rungs: a pure lab classifier (zero kernel touch), a sibling candidate-keyed store
(the `['merged']` mint gate untouched), and a tombstone disposal (evidence-preserving, #273-safe). Default-off so the
shipped dry pipeline is byte-inert. The classifier + disposal are the mechanism that, once armed, turns a dead-end
from "silent inert residue" into "recorded terminal-block + clean disposal + a calibration data point."

## What this DOESN'T claim to fix

It does not make an external merge predictable (only the merge is the signal — OQ-NS-6), does not arm the emit path,
and cannot be exercised end-to-end against a real create-error without operator arming. It reduces wasted residue and
makes dead-ends observable + disposed.

## Pre-Approval Verification (2026-07-05) — 3-lens VERIFY board (architect + hacker + code-reviewer)

Verdict: **all three FLAGS (none NEEDS-REVISION).** The three core design calls are BLESSED by all lenses:
sibling candidate-keyed store (a terminal block has no `join_key_id`/`pr_number`/`pr_url` → fails
`merge-outcome-store.validateRecord` at 4 fields → a sibling store is the right SRP split); the pure lab-side
classifier (zero kernel touch is the right YAGNI call for a dormant, gates-nothing path); tombstone-not-delete (the
only shape consistent with the content-addressed stores' verify-on-read). The findings below are folded into the
build (each premise re-probed firsthand against the real code):

- **[architect+hacker HIGH — CONFIRMED] Anchored endpoint match, not a `/pulls` substring.** `runGh`'s message
  (`runGh: gh api <endpoint> failed (HTTP NNN)`, gh-emit.js:154) carries the endpoint. The create is `repos/o/r/pulls`
  (bare, POST, :998); the NON-terminal dedup GET is `repos/o/r/pulls?head=...&state=open` (:948) — a naive `.includes('/pulls')`
  misclassifies the dedup GET (hacker PoC: 8 cases, strict-right/naive-wrong-2). FOLD: extract via
  `/^runGh: gh api (\S+) failed \(HTTP (\d{3})\)/`, require status ∈ {403,404} AND endpoint EXACT
  `^repos\/[^/]+\/[^/]+\/pulls$` (no query, no sub-resource). Test fixtures for BOTH the create (terminal) and the
  `pulls?head=` dedup GET (NON-terminal) + `git/ref|trees|commits` (NON-terminal).
- **[architect HIGH — CONFIRMED] The `pendingNodeId` seam doesn't exist.** `captureLiveLesson` (live-draft-run.js:245)
  discards `mintLivePendingLesson`'s `node_id`. FOLD: thread it out as an additive always-a-string `lesson_node_id`
  (`''` on every non-mint branch, like `lesson_commitment`); `solveGradeDraftOne` passes it as `pendingNodeId`. Test:
  a terminal block with a captured lesson tombstones the RIGHT node_id.
- **[code-reviewer HIGH] The classify+dispose call gets its OWN try/catch** inside `solveGradeDraftOne` (mirror the
  emitFn/artifact-write pattern) so a throw becomes one field on the SAME outcome, never escaping to the loop-level
  catch that discards classifyFields/verdict (the fixed F4 bug class). Test: a throwing dispose still returns a full
  outcome with persona/verdict intact.
- **[code-reviewer+hacker HIGH] Tombstone read/write parity with `readNodeRaw`.** `isPendingTombstoned` opens the
  `.tombstone` with O_NOFOLLOW + fstat-same-fd + reject foreign-uid/non-regular (NOT bare `existsSync`); the sidecar
  is content-address-verified (`content_hash` over `{node_id, reason, tombstoned_at}`) so a foreign/forged tombstone
  is REJECTED (cannot suppress a node). Write with `{flag:'wx', mode:0o600}`; EEXIST → read-compare (idempotent /
  observable collision). Test: a foreign/symlinked/forged `.tombstone` is refused (alert) and does NOT hide the node.
- **[hacker HIGH] Disposal must not become an evidence-erasure lever.** No physical artifact reap this wave (deferred
  — evidence-preserving, tombstone-only). The tombstone is ADDITIVE + independently enumerable:
  `listLivePendingLessons({ includeTombstoned: true })` is the audit path so a tombstoned (possibly forged) node
  never vanishes with no recovery. Named invariant + test: a tombstoned node's file bytes are UNCHANGED AND it is
  still discoverable via the audit lister.
- **[hacker MEDIUM] Classifier drift-canary (fail-silent close).** On `ok===false` with a 403/404 on the `/pulls`
  family that did NOT anchor-match the create (e.g. the dedup GET), return `{terminal:false, unclassified:true}` and
  the caller emits `emitEgressAlert('terminal-block-unclassified', {reason_shape})` (bounded, value-redacted). Keep an
  ordinary emit failure SILENT (high-signal). This makes the classifier tri-state-honest: `terminal` / not / unclassifiable.
- **[hacker+architect MEDIUM] The terminal-block/disposal store is content-addressed, closed-shape, verify-on-read,
  dedup-EXCLUDING-`at`** (mirror `merge-outcome-store` :241-305): dedup key over `{repo, issue_ref, candidate_patch_sha,
  block_reason}`, `content_hash` over the full body, exact-set STORED_KEYS, `{flag:'wx'}`, first-write-wins /
  divergent = observable collision. Observability-ONLY: an import-graph dam test asserts NO gating consumer imports it
  (mirrors the live-pending two-dams); HARD-gating calibration needs an authenticated minter (#273) — deferred.
- **[architect MEDIUM] Disposal ordering under partial failure:** (1) record the terminal-block/disposal outcome
  (durable why), (2) tombstone the pending lesson. Each independently observable + idempotent; a re-dispose completes
  a partial one. Test: outcome-recorded-then-tombstone-fails → outcome durable, observable, re-dispose completes.
- **[hacker LOW] fail-soft ≠ fail-silent:** every disposal refuse path (foreign dir, symlink, write-failed, foreign
  node) emits an observable alert BEFORE returning `{disposed:false, reason}`. Non-vacuous test: plant a foreign-uid
  dir, assert the alert fires red.
- **[code-reviewer MEDIUM] Byte-inert golden test:** capture the pre-change run-report for a fixture; assert
  deep-equality after the change with disposal default-off (the mock-green≠real-path lesson).

**Revised file list (post-VERIFY):** NEW `packages/lab/issue-corpus/terminal-block.js` (pure classifier only) ·
NEW `packages/lab/causal-edge/live-disposal.js` (`disposeCandidate` + the content-addressed disposal-outcome store) ·
MOD `packages/lab/causal-edge/live-pending-store.js` (tombstone + isPendingTombstoned + list `includeTombstoned`) ·
MOD `packages/lab/persona-experiment/live-draft-run.js` (thread `lesson_node_id` + the own-try/catch classify+dispose
wiring, default-off `disposeFn` dep). `live-solve-one.js` is UNCHANGED — the `terminal-block:*` reason flows onto the
existing outcome surface automatically + conditionally, preserving byte-inertness.

Status: PLANNED → VERIFIED → BUILT + VALIDATED.

## VALIDATE result (2026-07-05) — 3-lens on the BUILT diff, each finding adversarially handled

**code-reviewer: CLEAN · honesty-auditor: CLEAN (Grade A, no-overclaim) · hacker: FLAGS (1 CONFIRMED MEDIUM +
LOW/NITs, none a BLOCK).** All five pre-approval HIGH folds verified against the built code (anchored regex,
lesson_node_id threading, own-try/catch F4-safety, tombstone O_NOFOLLOW/uid/content-hash parity, disposal-store
dedup-excludes-`at`). Full kernel + lab suites green; SHADOW/byte-inert confirmed (the classify+dispose branch sits
behind `emitRes.ok !== true`, unreachable on the dry path; disposal is a true no-op unless armed). Folds:

- **[hacker MEDIUM — CONFIRMED, folded] tombstone-lane #273 residual.** A same-uid co-forged (or PRE-PLANTED)
  tombstone can CENSOR a legit captured-floor node from world-anchor-mint's default read (the mint reads
  `listLivePendingLessons` without `includeTombstoned`). It is the SAME same-uid co-forge class the store already
  accepts for the node, inert while the mint is SHADOW/weight-inert, and NOT evidence-destruction (bytes retained +
  recoverable via `includeTombstoned:true`). Keeping the mint skipping tombstoned is CORRECT (disposed ≠ floor).
  Folded: (a) a NAMED #273 forward-contract in the tombstone header — the tombstone read must gain AUTHENTICATED
  provenance at the SAME arming point as the node minter (item 5) before the mint gates a weight; (b) a cheap
  observability canary — `mintLivePendingLesson` emits `minted-already-tombstoned` when a fresh node is born
  already-tombstoned (the pre-plant shape); (c) test pt9 (canary fires) + pt10 (header names the contract).
- **[hacker LOW, folded] dead MAX caps** — dropped `MAX.candidate_patch_sha`/`MAX.block_reason` (HEX64 + BLOCK_REASON_RE
  are the real bounds); kept `MAX.repo`.
- **[hacker NIT, accepted] trailing-slash create endpoint** (`repos/o/r/pulls/`) — gh never emits it; left as-is to
  avoid making the `pulls/N` rollback sub-resource noisy.
- **[code-reviewer LOW, folded] extra fd-open per list entry** — `listLivePendingLessons` now builds a Set of
  tombstoned names from the same `readdirSync` result and only opens the (verifying) tombstone read when a
  `.tombstone` entry exists → ZERO extra opens in the dormant no-tombstone case; a forged `.tombstone` still fails
  verify → the node stays listed (fast-path, not a weakening).
- **[honesty LOW, folded] byte-inert is output-inert** — the classify block IS entered on a dry `ok:false` non-gh
  reason (output unchanged). Added a wiring test on the REAL reachable path (`lock-unavailable`/`etiquette`/`cap`) →
  reason stays `emit:*`, zero disposals, even armed.
- **[honesty NIT, folded] frozen-record** — added d13 (`listDisposalOutcomes` returns deep-frozen records).
- **[code-reviewer NIT, noted] golden-test shape** — the "byte-inert golden" is realized as a no-new-keys +
  no-dispose assertion (the guarantee that actually matters), not a literal fixture-snapshot diff.

Final: new + affected suites green (terminal-block 14 · live-disposal 13 · live-disposal-shadow 5 ·
live-pending-tombstone 10 · live-draft-run 58); full lab (140) + kernel (118) suites 0 failed; eslint CLEAN; SIGNPOST
current.
