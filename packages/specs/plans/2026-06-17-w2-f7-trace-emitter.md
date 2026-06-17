---
lifecycle: persistent
phase: ③.1-W2
date: 2026-06-17
status: PLAN (pre-VERIFY)
---

# ③.1-W2 — the F7 structured trace-emitter (the observability spine)

The user's "F7 step-through": a per-step, replayable, queryable, diff-able timeline of
the dry-run loop. W2 builds the **spine** — every downstream wave (persona spawn → recall
retrieval → solve → grade → learning-graph write) emits into it. SHADOW; trust ZERO
(OQ-NS-6); version held 3.11. Pure **lab-tier** addition (no kernel edit → K12-clean).

## Goal / scope

1. **The trace schema** (USER-ratified superset, frozen append-only contract):
   `{ run_id, seq, ts, component, event, dur_ms, inputs_digest, outputs_digest, state_delta, attrs }`
   — digests (sha256) not raw content (privacy / secret-scrub discipline); `state_delta`
   structured (`{lessons[], kbs[], graph_nodes[], drop_count, ...}`); `attrs` a
   component-specific bag.
2. **A per-run timeline store** — append-only JSONL at
   `LAB_STATE_BASE/trace-timeline/<run_id>.jsonl` (ordered by `seq`; replayable; one file
   per run so cross-run diff is a 2-file read). Atomic append; `LOOM_LAB_STATE_DIR` honored.
3. **The emit() API** — `traceEmit(record, opts)`: validates against the frozen schema,
   assigns the monotonic `seq` for the run, appends. The seams (W3–W5) call it.
4. **The close-path ingester (ARCH-PC-4 capture mechanism, K12-clean)** — reads the
   kernel's spawn-state JOURNAL `<LOOM_SPAWN_STATE_DIR>/<runId>/resolver-journal-<agentId>.jsonl`
   (it ALREADY persists `producer_git_ms` + `status_git_ms` + the ③.0-W1 soft-fail-lock
   drop events on the verdict/provenance entries, keyed by `agentId`) and folds them into
   the timeline as `component: close-path` records. **No kernel edit** — the kernel
   journals; the lab emitter ingests (K12-clean). *(Corrected from the first-draft ".log
   ingest" premise — the durations live in the journal, not `~/.claude/logs`.)*
5. **A query / replay / diff surface** (CLI): `list` runs, `replay <run_id>` (ordered
   timeline), `diff <runA> <runB>` (what changed across runs — the experiment payoff:
   does the experience layer accrue + sharpen?).

## Runtime Probes (firsthand, against main @ `c01a6ef` — not prose/memory)

| Claim | Probe | Result |
|---|---|---|
| kernel → lab boundary is clean (kernel cannot import the lab emitter — K12) | `grep -rn "require.*lab" packages/kernel` | CONFIRMED empty. So the close-path CANNOT call a lab emitter directly → the ingester pattern is mandatory, not a preference. |
| the close-path persists measured durations in the spawn-state JOURNAL (NOT the .log) | Read `spawn-close-resolver.js` l.424 / 594-610 / 645-746 | CONFIRMED + **CORRECTED** — `producer_git_ms` + `status_git_ms` are fields on the verdict/provenance entries `appendJournal`'d to the journal; `spawnCloseWallMs` (l.424) is a TIMESTAMP fed to `buildK14Ctx`, NOT a persisted duration; the `logger(...)` calls are ERRORS-only. **→ the ingester source is the spawn-state journal, not `~/.claude/logs`.** (Runtime-Claim Probe caught the plan's first-draft "ingest the .log" premise.) |
| the journal is JSONL, per-run, keyed by `agentId` | Read `journalPathFor` + `appendJournal` (l.203/212) | CONFIRMED — `journalPathFor = path.join(stateDir, runId, 'resolver-journal-'+agentId+'.jsonl')`; `stateDir = LOOM_SPAWN_STATE_DIR \|\| ~/.claude/spawn-state`; entries carry `spawn_id`/`agentId` + `resolved_at` + `mode:shadow`. Correlation key (`agentId`) + `runId` (in the path) both present → no deferred correlation probe needed. |
| lab state-dir convention | `grep LAB_STATE_BASE` | CONFIRMED — `LOOM_LAB_STATE_DIR \|\| ~/.claude/lab-state`; reuse verbatim. |
| lab store persistence idiom | Read `recall-graph-store.js` | `deepFreeze` on read (reused). **NOTE (corrected at VALIDATE M2):** the trace store uses `fs.appendFileSync` (O(1) append), NOT `writeAtomicString` — the latter rewrites the whole file, defeating the append. Per-run JSONL (a timeline stream), not content-addressed one-file-per-node. Trade-off: appendFileSync follows a symlinked run-file (same-uid conceded, #345); the 0700 dir is the foreign-uid containment. |
| the actor-process layer already exists | Read `real-e2e-actor-dogfood.js` + `trajectory-friction-run.js` refs | CONFIRMED — `runActorTrajectory({record, claudeBin, cwd, timeout, allowedTools})` captures the actor's tool-call trajectory via real `claude -p --output-format stream-json`. W2 does NOT rebuild this; the `solve` seam folds its trajectory summary into `attrs` (W4). |
| no existing trace/timeline/emitter | `find -iname '*trace*' -o -iname '*timeline*'` | CONFIRMED none → W2 is net-new (no dedup risk). |

## Design forks (for the VERIFY board)

1. **Close-path capture: ingest-the-journal (RECOMMENDED) vs edit-the-kernel.** K12 forbids
   the kernel importing lab, and the durations already live in the spawn-state journal
   (`resolver-journal-<agentId>.jsonl`, per-run, keyed by `agentId`). So the emitter INGESTS
   the journal → zero kernel edit, K12-clean, decoupled (the kernel journals; the lab
   assembles the trace). The alternative (a kernel-tier observability bus the lab
   subscribes to) is over-engineering for one consumer (YAGNI). Correlation key (`agentId`)
   plus `runId` (in the journal path) — both confirmed present.
2. **Store shape: per-run JSONL timeline (RECOMMENDED) vs content-addressed per-record.**
   A trace is an ordered append stream → JSONL per `run_id` (replay = read-in-order; diff =
   two-file compare). Content-addressing (the recall-graph idiom) is for dedup'd nodes, not
   a timeline. Keep `fs.appendFileSync` for O(1) append durability (NOT `writeAtomicString`,
   which rewrites the whole file — see the VALIDATE M2 correction below).
3. **Wave size / split.** W2 = spine (schema + store + emit) + close-path ingester +
   query/replay/diff CLI + tests (~400-460 LoC). If VERIFY judges it over the
   reviewable-in-one-sitting bar, split: **W2a** = schema + store + emit + tests; **W2b** =
   ingester + query/replay/diff CLI. Default: one wave; architect advises.

## Scope boundaries (deferred, named — not silent)

- **The substrate-seam emit calls** (persona-spawn / recall-retrieval / grade / graph-write)
  land WITH their components (W3/W4) — each calls `traceEmit(...)`. W2 delivers the API +
  instruments the ONE seam whose data exists now (close-path, via the ingester) + proves
  the spine with a dogfood. Instrumenting the recall-graph store now would be premature (no
  dry-run loop yet) and touch a content-addressed store — deferred to W4.
- **`reapOrphans()` at batch-start** belongs to the W4/W5 batch-runner, NOT the emitter.
  (Corrects the carry-list bundling.)
- **The actual under-load measurement** (ARCH-PC-4's "real concurrent load") happens when
  the dry-run loop runs (W4/W5). W2 delivers the CAPTURE capability; the measurement is a
  W4/W5 activity using it.

## Build (TDD)

Write `tests/unit/lab/trace-emitter/*.test.js` FIRST (red), then impl:
1. **schema**: a valid record passes; each missing/extra field or wrong type is rejected;
   `inputs_digest`/`outputs_digest` must be 64-hex (digest, never raw); frozen field set.
2. **store**: append assigns monotonic `seq` per run; concurrent appends don't interleave
   a half-line (atomic); read-back replays in `seq` order; `LOOM_LAB_STATE_DIR` honored
   (sandbox the dir per test); read-back is `deepFreeze`'d (the #266 read-path immutability
   lesson — test the read/list return, not just the constructed record).
3. **ingester** (W2b): given a fixture `resolver-journal-<agentId>.jsonl` (planted JSONL), folds
   `spawnCloseWallMs`/`producer_git_ms`/`status_git_ms`/drop events into `component:
   close-path` records with correct `dur_ms`; idempotent (re-ingest doesn't double-count —
   track a high-water mark); a malformed log line is skipped, not fatal.
4. **query/diff**: `replay` returns ordered; `diff` reports added/removed/changed records
   across two runs.
- Oracle discipline (Rule-2a / vacuous-oracle guard): every oracle exercises a real effect
  (planted files, real append/read), platform-independent, sandboxed dir.
- Dogfood (`_spike/`): emit a synthetic run + ingest a real close-path log + replay + diff
  two runs → prove the timeline is real (a green unit suite is a hypothesis; the dogfood
  is the real-path check, Rule-2a-corollary; the close-path source is the spawn-state journal,
  not `.log`).

## VALIDATE (post-build, lens by need)

Lab-tier + handles potentially-sensitive solve I/O → privacy is the security surface:
- **code-reviewer** (correctness): schema/store/ingester correct; atomic append; seq
  monotonicity under concurrency; idempotent ingest; read-path immutability.
- **hacker** (privacy/leak lens — live probe): does the trace store EVER persist raw
  content or secrets? (The schema mandates digests — probe that `state_delta`/`attrs`
  can't smuggle raw issue text / tokens; confirm the digest path; check the JSONL store
  perms.) Does the ingester trust the kernel log blindly (a poisoned log line → bad
  trace)? Path/dir handling in the store (CWE-22 on `run_id`).
- **honesty-auditor** (claim-vs-evidence): does W2 actually capture close-path latency (or
  is the ingester a vacuous stub)? Is "K12-clean" true (zero kernel edit)? Are the deferred
  scopes labeled DEFERRED, not silently dropped?

## Gate + PR

`install.sh --hooks --test` (125/0) + full kernel suite + lab suite (incl. new trace-emitter
tests) green; eslint + markdownlint clean; SIGNPOST regen if any `.js` header changes the
signpost set. Branch `feat/w2-f7-trace-emitter`; PR; CodeRabbit gate; USER merge. Version
held 3.11.

## VERIFY board result (architect, 2026-06-17) — READY-WITH-CORRECTIONS → SPLIT W2a/W2b

Rulings: ingest-the-journal CONFIRMED K12-clean; per-run JSONL CORRECT; deferred cut
CORRECT (dogfood proves the emit path; do NOT add a second live seam). **Split adopted.**

**W2a (this PR) — the frozen contract:** schema + per-run JSONL store + `traceEmit` API +
tests + emit→replay dogfood. Folds:
- **[HIGH-4] add `schema_version`** to the frozen field set (the one field un-addable
  post-freeze; cf. kernel `SCHEMA_VERSION`, lesson-taxonomy freeze).
- **[MED-7] pin `component`** as a closed-but-extensible `const` set the schema module owns
  (validate against it; add a member, never loosen the type — Open/Closed).
- **[MED-5] CWE-22 guard `run_id`** pre-`path.join` (raw-segment check BEFORE join collapses
  `..` — the #215 `checkWithinRoot` lesson; reuse the `isSafeRunId` idiom).
- **[NOTE-6] header-note** the read-modify append is not O(1) (fine at dry-run scale; YAGNI
  — flag where O_APPEND swaps in for a future high-volume wave).
- `dur_ms` is single-meaning per record (one record per duration, not a sum).
- Read-path immutability: `deepFreeze` the timeline read-back (#266 — test the read/list
  return, not just the constructed record).

**W2b (next PR) — the consumer:** the close-path ingester + query/replay/diff CLI. Folds:
- **[HIGH-1] the two durations are on SEPARATE gated entry kinds** — `status_git_ms` on
  `shadow-resolver-verdict` (l.704, always); `producer_git_ms` on `shadow-provenance-record`
  (l.605) ONLY when `commit_outcome==='COMMITTED'` (gate l.547; else `shadow-provenance-skipped`
  with NO producer duration). The ingester reads by `kind`, emits one record per duration
  (`event: status-git` / `event: producer-git`), tolerates absent `producer_git_ms`. **Fixtures
  must be REAL-shaped multi-entry journals** (a COMMITTED case AND a non-completed case) — a
  fused-entry fixture is a vacuous oracle (Rule-2a).
- **[MED-2] cross-tier coupling guard**: validate each parsed entry vs an expected-shape
  guard; track `ingested_count` vs `skipped_count`; surface non-zero skips (a loud signal,
  not a silent empty timeline). Document the coupled kernel fields in the module header.
- **[MED-3] one journal file PER agentId per run** — enumerate the run dir
  (`readdir` + `resolver-journal-*.jsonl`), iterate all spawns; test the multi-spawn case.
- **[LOW-8] fixture name** = `resolver-journal-<agentId>.jsonl` (NOT the falsified `.log`).

## VALIDATE board result — W2a (3-lens, post-build, 2026-06-17) — SHIP

Frozen-contract + privacy surface → full 3-lens (all read-only personas). 26 unit tests +
dogfood green.

- **code-reviewer — SHIP-WITH-NITS.** 1 HIGH (the #266 read-path test used EMPTY objects →
  proved nothing about nested freezing) + 3 LOW. ALL FOLDED: nested-content freeze test
  (asserts nested frozen + mutation throws); `dur_ms=0` schema+emit regression tests; removed
  the unused `ALLOWED_FIELDS`/`COMPONENT_SET` exports (narrow-export YAGNI); reworded a
  misleading test comment.
- **hacker — SHIP-WITH-RESIDUAL (13 live probes).** Digest privacy boundary HELD; CWE-22
  `run_id` guard AIRTIGHT (14 traversal payloads, all blocked, guard fires pre-`path.join`).
  Folded: **M1** read-path drops poisoned lines (non-object / non-integer-seq) + stable
  append-order sort (no NaN-sort); **M3** `chmod 0700` the dir (tighten a pre-existing loose
  dir) + `appendFileSync mode 0600`; **M2** corrected the plan's `writeAtomicString` claim
  (it's `appendFileSync`; same-uid symlink-follow conceded, 0700-dir is foreign-uid
  containment). **Carried to W4 (named, honest-scoped in the store header):** **H1** —
  `state_delta`/`attrs` are free-form bags the store does NOT scan → a W4 caller of real
  stranger-repo content MUST pre-scrub them (the ③.0-W2 secret-scrub factory) before real
  content flows; **H2** — `nextSeq` races under concurrent emitters to one `run_id` (seq
  collides; line appends stay atomic) → replay is correct (append-order canonical) but strict
  seq monotonicity under concurrency needs an atomic counter / per-run lock once W4's
  concurrency model is decided.
- **honesty-auditor — NO-OVERCLAIM (Grade A).** All 6 claims CONFIRMED on file:line (K12-clean
  verified; privacy claim precision-scoped to the digest fields; deferrals labeled; no
  close-path-capture claim in W2a). 1 MINOR (a tautological dogfood conjunct) FOLDED.

**Net: SHIP.** Two HIGHs were both contract-HONESTY issues (privacy is digest-fields-only,
not absolute; seq is single-writer-monotonic, not concurrent) — the store header now scopes
both honestly + both deeper fixes are carried to W4 where the real-content/concurrent flow
actually exists.

## W4 carries (named — from the W2a VALIDATE)

1. **[H1] pre-persist scrub of `state_delta`/`attrs`** (the ③.0-W2 secret-scrub factory) before
   the dry-run loop folds REAL stranger-repo content into the trace — the privacy boundary is
   digest-fields-only until then.
2. **[H2] strict seq monotonicity under concurrent emitters** (atomic counter / per-run lock)
   once W4's batch-runner concurrency model is decided; until then seq is single-writer-monotonic
   and append-order is the canonical replay order.

## Runtime Probes — resolved (no open premises into build)

- **Ingest source + correlation key — RESOLVED.** Source = `<LOOM_SPAWN_STATE_DIR>/<runId>/
  resolver-journal-<agentId>.jsonl`; durations = `producer_git_ms` + `status_git_ms` on the
  verdict/provenance entries; correlation = `agentId` (per entry) + `runId` (in the path).
  The first-draft ".log ingest" premise was FALSIFIED by the probe and corrected above — a
  `drift:plan-honesty` near-miss the Runtime-Claim Probe caught before the architect blessed
  it. One residual the build confirms empirically: that a verdict entry reliably carries
  BOTH duration fields (vs only one), against a real captured journal in the dogfood.
