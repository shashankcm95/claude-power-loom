---
title: Ghost Heartbeat W2-PR3a — the background drain runner
status: building
lifecycle: persistent
phase: ghost-heartbeat-w2
pr: 3a
depends_on: ["#369 (producer)", "#371 (Stop-hook carrier)"]
---

# Ghost Heartbeat W2-PR3a — the background drain runner

## Goal

A standalone **runner** that periodically discovers session transcripts, audits the
ones with NEW content since it last saw them (bounded, killswitch-first, fail-open,
idempotent), and emits drift via the existing producer. The **guaranteed unattended
heartbeat** — works regardless of whether the PR-2 Stop-hook carrier fired (so it is
ALSO PR-2's reaping backstop). Invocable by any scheduler (`node ghost-heartbeat-run.js`,
a manual cron line, or PR-3b's installed entry).

**Scope split:** runner ONLY. The `install.sh` scheduler OFFER (launchd/cron) is
**PR-3b** — a distinct infra-risk class (zero scheduler precedent, no OS detection,
clean-env dogfood required per H.7.15).

## Runtime Probes (firsthand, this session)

| # | Claim | Probe | Observed |
|---|---|---|---|
| P1 | Transcripts at `~/.claude/projects/<hash>/<sid>.jsonl`; mtime = recency. | `ls -lt ~/.claude/projects/*/*.jsonl` | 539 files; filename = session-id (content sessionId can differ — rotation). **PASS.** |
| P2 | No marker/runner state yet (carrier default-off). | `ls`/`cat` checkpoints | Absent. **PASS.** |
| P3 | `auditTranscript` is idempotent via the emitted-set (the correctness boundary; watermark = optimization-only). | Read `drift-audit.js` + `ghost-heartbeat-state.js` header. | Confirmed. Re-audit never double-emits; only wastes a judge call. **PASS.** |
| P4 | Discovery template only (`collect.js:460-478`), no reusable module. | Recon. | Runner implements its own bounded scan. **PASS.** |
| P5 | Judge is up to 60 s; `auditTranscript` is SYNCHRONOUS. | Read `capability-free-claude.js` + `auditTranscript`. | Needs a WALL-CLOCK budget, not just a count cap. **PASS.** |
| P6 | `install.sh` non-interactive, no OS detection, no scheduler precedent; CI runs `install.sh --hooks --test` fresh. | Recon. | PR-3b deferred (clean-env infra). **PASS.** |
| P7 | The producer's `loadState` (emitted-set read) uses RAW `readFileSync` → FIFO-hangs; `pruneEmitted` has ZERO call sites (emitted-set grows unbounded). | VERIFY board grep of `ghost-heartbeat-state.js`. | Both confirmed → fold the `loadState` hardening + document the growth residual. **PASS.** |

## Design

New module `packages/kernel/spawn-state/ghost-heartbeat-run.js` (separate SRP unit
from the single-transcript producer — endorsed by the architect VERIFY lens, NOT a
`drift-audit.js --since-watermark` mode). It REQUIRES `auditTranscript`.

```
envIntClamped(name, def, min, max):                                  // VERIFY: NaN/neg/huge disable caps
  s = (env[name]||'').trim(); if !/^\d+$/.test(s) return def
  return Math.min(max, Math.max(min, parseInt(s,10)))

loadRunState(statePath):                                             // VERIFY HIGH: FIFO-safe + numeric-validated
  parsed = withRegularFileFd(statePath, fd => JSON.parse(fs.readFileSync(fd,'utf8')), null)   // #371 primitive, NOT raw readFileSync
  audited = {}
  if parsed?.audited is a plain (non-array) object:
    for [k,v] of Object.entries(parsed.audited):                    // own-props only (no proto)
      if Number.isFinite(v) && v >= 0: audited[k] = v               // DROP Infinity / string / junk (skip-everything-forever poison)
  return { audited }

discover(projectsDir):                                              // VERIFY HIGH: fail-open + symlink/special reject
  try { projs = fs.readdirSync(projectsDir) } catch { return [] }   // missing dir -> []
  out = []
  for proj of projs:
    pp = join(projectsDir, proj)
    try { if !fs.lstatSync(pp).isDirectory() continue } catch { continue }   // lstat NO-FOLLOW: a symlinked dir fails isDirectory()
    try { files = fs.readdirSync(pp) } catch { continue }
    for f of files:
      if !f.endsWith('.jsonl') continue
      fp = join(pp, f)
      try { st = fs.lstatSync(fp); if !st.isFile() continue; out.push({path:fp, mtimeMs:st.mtimeMs}) } catch { continue }
                                                                     // lstat: a symlinked/FIFO .jsonl fails isFile() -> never reaches the judge (CWE-22 + FIFO)
  return out.sort((a,b) => b.mtimeMs - a.mtimeMs)                    // newest-first

runHeartbeat({ projectsDir, statePath, auditFn, now=Date.now, log=()=>{} }):
  if env.GHOST_HEARTBEAT_DISABLED === '1':  return {ok:false, reason:'killswitch', audited:[]}   // FIRST — before ANY FS read
  if env.GHOST_HEARTBEAT_EMIT !== '1':      return {ok:false, reason:'opt-out',   audited:[]}
  audit  = auditFn || (o => auditTranscript(o))
  maxN   = envIntClamped('GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN', 20, 1, 500)
  budget = envIntClamped('GHOST_HEARTBEAT_RUN_BUDGET_MS', 240000, 1000, 600000)
  cands  = discover(projectsDir)
  state  = loadRunState(statePath)
  start  = now(); done = []; nextAudited = { ...state.audited }
  for c of cands:
    if done.length >= maxN:           break
    if now() - start >= budget:       break                          // gate LAUNCH (a synchronous in-flight audit finishes)
    if (state.audited[c.path] || 0) >= c.mtimeMs:  continue          // skip unchanged (mtime monotonic for append-only; same-ms rewrite self-heals next run)
    try { audit({ transcriptPath: c.path }); } catch (e) { log('audit-error', {path:c.path, msg:e.message}); }  // per-session fail-open
    nextAudited[c.path] = c.mtimeMs; done.push(c.path)
  try { writeAtomic(statePath, { version:1, audited: prune(nextAudited, cands), lastRunAt: iso(now()) }); }
  catch (e) { log('run-state-write-error', {msg:e.message}); }       // VERIFY HIGH: writeAtomic throws -> fail-open
  return { ok:true, audited: done, scanned: cands.length }

CLI (require.main): try { runHeartbeat({log:…}); } catch (e) { stderr; } finally { process.exit(0); }   // top-level net -> ALWAYS exit 0
```

Decisions + rationale (folding the VERIFY board):

- **Killswitch-first, then opt-in** — the FIRST statements, before any FS read; a
  flooded `~/.claude/projects` cannot force even a stat.
- **Scans `~/.claude/projects` DIRECTLY** (robust backstop; finds sessions even if the
  carrier never fired). Corrects PR-2's "marker = drain queue". The markers are the
  carrier's debounce state; the runner has its own `audited` map. Both dedup against
  the SHARED emitted-set (P3) — never double-emit, never coordinate.
- **`loadRunState` + the producer's `loadState` both read via `withRegularFileFd`**
  (VERIFY HIGH): a FIFO at either state path would hang the unattended runner forever
  (raw `readFileSync` blocks). Hardening `loadState` (the emitted-set read in
  `ghost-heartbeat-state.js`) also closes the carrier/producer exposure (the runner
  makes it reachable unattended). Numeric-validate `audited[path]` on load — an
  `Infinity`/numeric-string poison would make the skip-gate `>=` true forever (silent
  denial-of-monitoring, probe-confirmed).
- **Discovery rejects symlinks + special files via `lstat` no-follow** (VERIFY HIGH,
  CWE-22): a symlinked project dir or `.jsonl` would feed an out-of-tree path to the
  judge (probe-confirmed `escape.jsonl -> /etc/hosts`). `lstat.isDirectory()` /
  `lstat.isFile()` reject symlinks AND FIFOs at discovery, before the producer.
- **`audited[path]=mtimeMs` is a COST optimization, NOT correctness.** The emitted-set
  is the correctness floor (P3): a lossy/reset/pruned `audited` map can only WASTE a
  judge call, never miss a real drift. Skip-unchanged avoids re-judging quiescent
  sessions (most of the 539).
- **Bounded by clamped count + wall-clock** (VERIFY): `envIntClamped` rejects
  NaN/negative/huge (they would silently disable a cap). Budget gates LAUNCH; the cron
  interval (PR-3b) sits above the worst-case run time.
- **Fail-open is absolute:** per-session try/catch; `writeAtomic` try/catch; a
  top-level CLI catch → exit 0 on ANY throw.
- **Injectable seams** (`auditFn`, `projectsDir`, `statePath`, `now`) → deterministic
  tests with no real `claude -p`. Tests save/restore `process.env`.

## Files

| File | Change |
|---|---|
| `packages/kernel/spawn-state/ghost-heartbeat-run.js` | NEW — the runner (~130 LoC) |
| `packages/kernel/spawn-state/ghost-heartbeat-state.js` | EDIT — harden `loadState` to read via `withRegularFileFd` (FIFO-safe; the runner makes the emitted-set read reachable unattended) |
| `tests/unit/scripts/ghost-heartbeat-run.test.js` | NEW — R1–R15 + R-real |
| `tests/unit/scripts/ghost-heartbeat-state.test.js` | EDIT — add a FIFO-safe `loadState` regression test (timeout-bounded child) |
| `packages/specs/rfcs/2026-06-19-ghost-heartbeat-w2-drift-emit.md` | EDIT — §5.3 → runner-as-separate-module LANDED; resolve OQ-W2-3; note PR-3b deferred |
| `docs/SIGNPOST.md` | REGEN (new `.js`) |

## TDD test spec (`tests/unit/scripts/ghost-heartbeat-run.test.js`)

Drive `runHeartbeat` with a tmp `projectsDir` (a `<proj>/<sid>.jsonl` tree with set
mtimes), a tmp `statePath`, an injected `auditFn` (records calls), an injected `now`.
No real `claude -p`. Save/restore `process.env` per test.

| # | Test | Asserts |
|---|---|---|
| R1 | killswitch `DISABLED=1` → `auditFn` NEVER called; `reason:'killswitch'`; state file NOT written (short-circuit before any FS) | killswitch-first |
| R2 | opt-in off → `auditFn` NEVER called; `reason:'opt-out'` | opt-in gate |
| R3 | 3 fresh sessions → all 3 audited, newest-first | discovery + order |
| R4 | second run, no mtime change → ZERO audits | skip-unchanged (load-bearing) |
| R5 | one session's mtime advances → re-audited; unchanged sibling → skipped | per-path mtime gate |
| R6 | `MAX_SESSIONS_PER_RUN=2`, 5 candidates → exactly 2 (newest) | count cap |
| R7 | tiny `RUN_BUDGET_MS` + injected clock that advances per audit → stops launching after budget | wall-clock budget |
| R8 | one `auditFn` throws → batch CONTINUES, others audited, `ok:true` | per-session fail-open |
| R9 | missing / empty `projectsDir` → `{ok:true, audited:[]}`, no throw | discovery fail-open |
| R10 | vanished transcript → its `audited[]` entry dropped next run (READ BACK the persisted statePath JSON, not just the return) | prune hygiene |
| R11 | CLI: `node ghost-heartbeat-run.js` with `DISABLED=1` exits 0 | fail-open exit code |
| R12 | `MAX_SESSIONS_PER_RUN` ∈ {garbage, -1, 999999999} → clamped to [1,500]/default (caps STAY active) | envInt clamp |
| R13 | poisoned run-state `audited[path] = Infinity` and `="99999999999"` (string) → dropped on load → that session IS audited (not skipped forever) | state-poison validation |
| R14 | a FIFO at `statePath` → `loadRunState` returns empty PROMPTLY (timeout-bounded child), never blocks | FIFO-safe state read |
| R15 | a symlinked `.jsonl` (and a symlinked project dir) → NOT in candidates | CWE-22 symlink reject |
| R-real | `auditFn` = the REAL `auditTranscript` with a MOCKED `judgeFn` (no `claude -p`), two tmp transcripts whose FILENAME != dominant content sessionId → (1) a grown file re-audits; (2) the emitted-set de-dups a second file sharing content-sessionId+class | path-vs-content dedup invariant (Rule-2a-corollary) |

Plus `ghost-heartbeat-state.test.js`: a FIFO-safe `loadState` test (timeout-bounded child → empty state, no hang).

## Threat model delta (vs the #371 carrier)

- **T-runner-1 — auto-runs over ALL sessions.** Mitigated: killswitch-first + opt-in
  (before any FS read), clamped count + wall-clock bounds, skip-unchanged, the
  producer's capability-free judge + allowlist-only emit.
- **T-runner-2 — symlink/FIFO in `~/.claude/projects` (CWE-22 confused deputy).**
  Closed: `lstat` no-follow at discovery rejects symlinked dirs/files + FIFOs before
  the producer ever sees the path. (Probe-confirmed the naive glob traverses
  `escape.jsonl -> /etc/hosts`.)
- **T-runner-3 — run-state poisoning.** The UNBOUNDED skip-forever is CLOSED:
  numeric-validate `audited[path]` to a finite `[0, now + 1 day]` on load (drops
  Infinity / huge-finite `1e308` / numeric-string / negative) + FIFO-safe read via
  `withRegularFileFd`. A BOUNDED residual remains (VALIDATE honesty-auditor): a poison
  value in `[real-mtime, now + 1 day]` suppresses ONE session's RE-judge for ≤ the
  ceiling-slack window, then self-heals via write-back. Tolerable — the emitted-set
  (NOT this cost-map) is the correctness floor, so NEW drift is NEVER suppressed; only
  a redundant re-judge of UNCHANGED content is skipped.
- **T-runner-4 — unbounded spend.** Clamped caps + sequential (not parallel) audits +
  killswitch-first. The cron-cadence per-window cap is PR-3b's.
- **Amplified residual (self-asserted content sessionId — narrows-only).** The
  producer derives sessionId from transcript CONTENT (self-asserted in an open-writable
  tree). The runner AMPLIFIES this by auto-feeding every in-tree `.jsonl` unattended: a
  planted `.jsonl` (now confined IN-TREE by the symlink reject) with a forged sessionId
  could suppress (pre-emit a class for a victim sessionId) or inflate (N fake sessionIds
  → convergence). Tolerable ONLY because counts gate a HUMAN-triage prompt, NEVER an
  action (integrity≠provenance holds). Full close = an authenticated/kernel-minted
  sessionId (deferred to the integrity≠provenance SET). PR-3a adds NO action-gate.
- **Documented residual — emitted-set unbounded growth (P7).** `pruneEmitted` has zero
  call sites; the runner raises the growth rate from active-sessions to
  all-sessions-ever. NOT a correctness regression (no double-emit, no missed drift) —
  a slow state-bloat bounded by total session count (~hundreds). A retention cap is a
  named future follow-up (the runner can't cheaply compute the content-sessionId keep
  set). Scoped OUT of PR-3a per YAGNI, stated not silent.

## Pre-Approval Verification (3-lens VERIFY board)

| Lens | agentId | Verdict | Disposition |
|---|---|---|---|
| architect | a754d3dc0f8a09327 | SOUND-WITH-NOTES | separate-module factoring ENDORSED; emitted-set growth (MED) → documented residual; Rule-2a rotation gap (MED) → R-real FOLDED; tail-starvation (LOW) → named not denied; mtime `>=` (LOW) → commented; killswitch R-test (LOW) → R1 asserts no state write |
| code-reviewer | a3f9a8378c7413db3 | CHANGES-REQUIRED | writeAtomic throw (HIGH) → try/catch + CLI net FOLDED; discover() throws (HIGH) → fail-open both levels FOLDED; envInt NaN (MED) → clamp FOLDED; prune-incomplete (LOW) → commented; R10 read-back FOLDED; env save/restore in tests FOLDED |
| hacker | ac5437074db4a8a9d | BLOCKERS-FOUND (3 HIGH) | FIFO-at-state (HIGH) → `withRegularFileFd` for loadRunState + loadState FOLDED; state-poison (HIGH) → numeric validation FOLDED; symlink traversal (HIGH) → lstat no-follow FOLDED; envInt clamp (MED) FOLDED; self-asserted-sessionId amplification (MED) → threat-model note FOLDED; emitted-set growth (LOW) → documented |

## VALIDATE result (3-lens post-build board, on the BUILT diff)

| Lens | agentId | Verdict | Disposition |
|---|---|---|---|
| code-reviewer | a8275a9fd80ee7b4e | PASS-WITH-NOTES | fail-open complete, poison fully closed, `loadState` behavior preserved. Record-on-throw (LOW) → record `audited`/`done` only on SUCCESS + `attempts` cap FOLDED (a failed audit now retries next run); R7 loose (LOW) → tightened to `===1`. |
| hacker (live re-probe) | a1975d29a3c2e6136 | NO-BLOCKERS | LIVE-confirmed all 3 pre-build HIGH fixes CLOSED: FIFO-at-state hang, poison skip-everything, symlink traversal. killswitch + caps robust; runner adds NO action-gate. 3 LOWs (scan cost self-inflicted; in-range one-run suppression = documented; killswitch-typo `'01'`) ACCEPTED (keep `==='1'` for codebase consistency). |
| honesty-auditor | ae00f648ffb4dc31e | MINOR-GAPS (B+) | T-runner-3 "Closed" overclaim → reworded to "bounded ≤24h, self-heals" FOLDED; RFC §5.5 stale `--since-watermark` → updated FOLDED; R13 name vs 1-shape assertion → reworked to 3 discovered-candidate vectors FOLDED. All 6 spot-checked folds verified present. |

All board folds applied; runner 16/16 + state 10/10 green.

## Drift Notes

- This PR CORRECTS two prior-plan premises: PR-2's "marker = drain queue" (runner
  scans projects directly) + the RFC §5.3 `--since-watermark` sketch (separate module).
- `route-decide` substrate-meta catch-22; hand-escalated to route.

## Acceptance gate

- [x] Runner unit tests green (R1–R15 + R-real, 16/16) + the `loadState` FIFO test (state 10/10).
- [x] Full kernel suite green + `bash install.sh --hooks --test` (2 known-benign fails only).
- [x] SIGNPOST regenerated.
- [x] VALIDATE board done (3-lens; hacker live-re-probed FIFO/poison/symlink → all CLOSED; all folds applied).
- [x] CodeRabbit gate CLEAN: the walkthrough reviewed HEAD `2fb8b5c` and reported "No actionable comments were generated" (zero findings — the VERIFY+VALIDATE boards had already folded the issue set).
- [x] PR opened: #373 — awaiting the USER merge gate (never auto-merge).
- [ ] PR-3b (install.sh launchd/cron offer) specced as the follow-up. (After PR-3a merges.)
