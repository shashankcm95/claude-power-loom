---
lifecycle: persistent
phase: ③.1-W2b
date: 2026-06-17
status: PLAN (design carried from the W2 architect VERIFY)
---

# ③.1-W2b — the close-path ingester + query/replay/diff CLI (the F7 consumer)

Second half of W2 (W2a #348 shipped the frozen contract). W2b is the CONSUMER: it folds the
kernel's close-path latency (already journaled, K12-clean) into the F7 timeline, and adds the
query surface (list / replay / diff) over the W2a store. Design carried from the W2 architect
VERIFY (Finding 1-3); no fresh VERIFY (the probe below confirmed the design + surfaced one
new field-rename the coupling guard already covers). SHADOW; trust ZERO; version held 3.11.

## Goal / scope

1. **The close-path ingester** (`ingestClosePath`): enumerate a run's spawn-state journals
   `<LOOM_SPAWN_STATE_DIR>/<kernelRunId>/resolver-journal-<agentId>.jsonl`, read each entry
   by `kind`, and `traceEmit` one `component:'close-path'` record per duration into the F7
   timeline — `event:'status-git'` (dur=`status_git_ms`) from `shadow-resolver-verdict`,
   `event:'producer-git'` (dur=`producer_git_ms`) from `shadow-provenance-record`. Tolerate
   an absent `producer_git_ms` (a non-COMMITTED close legitimately has none).
2. **The coupling guard** (VERIFY Finding 2): validate each entry's expected shape; track
   `ingested` vs `skipped`; RETURN the counts (the caller/CLI surfaces a non-zero skip — a
   loud signal, never a silent empty timeline). Document the coupled kernel fields in the
   module header as a known cross-tier contract.
3. **The query/replay/diff CLI** (`cli.js`, matching the lab CLI convention): `ingest`,
   `list` (runs), `replay <run_id>` (ordered timeline), `diff <runA> <runB>` (added /
   removed / changed across runs — the accrual question).

## Runtime Probes (firsthand, against main @ `0ec324a` — source AND real on-disk data)

| Claim | Probe | Result |
|---|---|---|
| the duration-bearing entry kinds + fields | Read `spawn-close-resolver.js:548/591/696` | CONFIRMED — `shadow-resolver-verdict` (ALWAYS): `status_git_ms` + `spawn_id` + `event:'spawn-close-shadow'`; `shadow-provenance-record` (COMMITTED-only, gate l.547): `producer_git_ms` + `spawn_id`; `shadow-provenance-skipped`/`-error`: NO duration. |
| **the verdict duration field was RENAMED** | `head` REAL `resolver-journal-*.jsonl` files in `~/.claude/spawn-state` | **CONFIRMED + SURPRISE** — EVERY real on-disk sample still uses `"k14_git_ms"` (representative value `:20`, e.g. `d37d788b8c3ae54d/...`); NONE yet carries `status_git_ms` (the PRE-③.0-W1 name; current source emits `status_git_ms` per l.704 "replaces k14_git_ms"). **→ the `status_git_ms ?? k14_git_ms` fallback is the PRIMARY real-data path today, not a legacy edge** (VALIDATE honesty-auditor confirmed). A live instance of VERIFY Finding 2's silent-rename risk → the coupling guard surfaces any entry with neither. |
| `producer_git_ms` is stable | same real sample | CONFIRMED — `"producer_git_ms":23` on the provenance-record entry; name unchanged across the W1 rename. |
| journal location + per-agentId cardinality | `find ~/.claude/spawn-state -name 'resolver-journal-*.jsonl'` | CONFIRMED — `<spawn-state>/<kernelRunId>/resolver-journal-<agentId>.jsonl`; one file per agentId → ingester ENUMERATES the run dir (Finding 3), not a single file. |
| F7 store API to emit into | W2a `index.js` | `traceEmit({run_id, component, event, dur_ms, attrs})` — the store owns seq; the ingester passes `traceRunId` as `run_id` + `{spawn_id, source_kind}` in attrs (digests-not-raw; the journal carries no raw content). |
| lab CLI convention | Read `verdict-attestation/cli.js` | `#!/usr/bin/env node` + `// @loom-layer: lab` + subcommands + clean messages + exit 0/1. Match it. |

## Design (carried from the W2 VERIFY — no re-VERIFY needed)

- **Finding 1 (entry-kind):** read by `kind`, one trace record per duration, tolerate absent
  `producer_git_ms`. ✓ folded above.
- **Finding 2 (coupling guard):** shape-validate + skip-count + surface; header documents the
  coupled fields + the `k14_git_ms`→`status_git_ms` rename. ✓
- **Finding 3 (multi-file):** enumerate the run dir, iterate all spawns. ✓
- **Finding 8 (fixture):** the test plants REAL-shaped multi-entry journals (a COMMITTED case
  = verdict + provenance-record; a non-completed case = verdict + provenance-skipped, no
  producer_git_ms; a legacy case = verdict with `k14_git_ms`), NOT a fused single entry — a
  fused fixture is a vacuous oracle (Rule-2a). Drive via `LOOM_SPAWN_STATE_DIR` + `LOOM_LAB_STATE_DIR` sandbox.

## Build (TDD)

Write `tests/unit/lab/trace-emitter/ingest-close-path.test.js` FIRST (red), then impl
`packages/lab/trace-emitter/ingest-close-path.js` + `cli.js`:
1. ingester folds a COMMITTED journal → two close-path records (status-git + producer-git)
   with correct `dur_ms` + `spawn_id` in attrs.
2. a non-completed journal (provenance-skipped) → ONE record (status-git only); no
   producer-git, no synthetic zero.
3. a LEGACY journal (`k14_git_ms`, no `status_git_ms`) → still yields a status-git record
   (the `?? k14_git_ms` fallback).
4. multi-spawn run dir (N journal files) → all N folded; counts correct.
5. coupling guard: a poisoned/garbage line + an unknown-kind entry → `skipped` count > 0,
   surfaced; a malformed line never crashes the ingest.
6. CWE-22: `ingestClosePath` rejects an unsafe `kernelRunId` / `traceRunId` (reuse the W2a
   `assertSafeRunId` + a safe-segment check on the spawn-state runId).
- Oracle discipline: REAL-shaped fixtures (per Finding 8); sandboxed dirs; every oracle
  exercises a real fold (counts + emitted records read back from the timeline).
- Dogfood (`_spike/`): ingest a planted real-shaped journal → replay the timeline → diff two
  runs (the Rule-2a-corollary real-path proof).

## VALIDATE (post-build, 3-lens)

- **code-reviewer**: ingest correctness (by-kind, the `?? k14_git_ms` fallback, multi-file
  enumerate, counts); CLI correctness; no vacuous fixtures.
- **hacker**: poisoned-journal-line robustness (a Byzantine journal entry must not corrupt the
  timeline or crash); CWE-22 on both run-id params; does the ingester trust the journal
  blindly (it should shape-guard + skip-count)? any raw-content leak from journal→trace.
- **honesty-auditor**: does the ingester ACTUALLY capture latency (not a vacuous stub)? Are the
  fixtures real-shaped (the architect's explicit warning)? Is the `k14_git_ms` rename handled +
  documented, not silently dropping legacy data?

## VALIDATE board result (3-lens, post-build, 2026-06-17) — SHIP

- **hacker — SHIP-WITH-RESIDUAL.** Prototype-pollution HELD (V8 own-prop; ingester reads named
  scalars, never assigns journal keys); CWE-22 on both run-ids HELD. Folded: **H1** — a
  negative-int duration passed `Number.isInteger` but the schema rejects `<0` → `traceEmit`
  threw → the WHOLE batch aborted (+ partial timeline + re-run double-emit); fixed with a
  `>= 0` gate + a try/catch batch-isolation guard (a bad entry degrades to `skipped`, never
  aborts). **H2** — `attrs.spawn_id` copied journal content verbatim (a 20MB string / an object
  via `|| null`); fixed with `safeSpawnId` (typeof-string + len≤128, else null). **Carries:**
  M1 (O(n²) `nextSeq` — the existing W2a→W4 atomic-counter carry); full attrs secret-scrub
  (W4, when real untrusted content flows); same-uid symlink (conceded #345).
- **code-reviewer — SHIP-WITH-NITS.** Ingest/query/CLI correctness confirmed; fixtures
  real-shaped (Finding 8 honored). Folded: **F1** — the CLI's `emitted===0`-from-nonempty
  warning false-positived on a legit all-no-duration journal (a run that ended skipped/error);
  fixed to warn on `skipped > 0` only (the KIND-rename is an accepted, documented blind spot).
  **F2** — `summary` subcommand had no real-process coverage; added a dogfood check.
- **honesty-auditor — NO-OVERCLAIM (Grade A).** All 6 claims CONFIRMED (K12-clean; real
  kind/field names; loud signal wired; deferrals labeled). Folded the LOW: the plan's
  `k14_git_ms:28` corrected to the on-disk `:20` + the STRONGER finding (every on-disk journal
  still uses `k14_git_ms` → the fallback is the PRIMARY real-data path, not a legacy edge).

**Net: SHIP.** Two HIGHs (batch-abort DoS, raw-content/oversize attrs) + an honest false-positive
fix, all folded; the parser-differential (ingester `Number.isInteger` vs schema `>=0`) closed.

## Gate + PR

`install.sh --hooks --test` (125/0) + kernel + lab suites green; eslint + markdownlint clean;
SIGNPOST regen for the new modules. Branch `feat/w2b-close-path-ingester`; PR; CodeRabbit
gate; USER merge. Version held 3.11.
