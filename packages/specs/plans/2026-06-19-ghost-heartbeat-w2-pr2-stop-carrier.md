---
title: Ghost Heartbeat W2-PR2 — the Stop-hook carrier
status: building
lifecycle: persistent
phase: ghost-heartbeat-w2
pr: 2
depends_on: ["#369 (W2-PR1 producer)"]
---

# Ghost Heartbeat W2-PR2 — the Stop-hook carrier

## Goal

Wire the W2-PR1 producer (`drift-audit.js`, merged #369, default-off) to a real
carrier: an **in-plugin Stop hook** that hands the just-finished transcript to the
producer **as a detached background process** — so the drift heartbeat beats
without blocking the session. Advisory, draft-only, **opt-in**
(`GHOST_HEARTBEAT_EMIT=1`), default-OFF. First of two carriers; PR-3 adds the cron
drain (and reuses PR-2's per-session markers as its work-queue).

Non-goals: changing the judge, the store, or the taxonomy. PR-2 is carrier-only,
plus two SCOPED producer hardenings the carrier's auto-trigger makes reachable
(see Files). Promotion stays human-gated (narrows-not-hardens).

## The corrected mental model — `Stop` fires PER TURN, not per session close

VERIFY-board catch (drift:plan-honesty, the feature's own motive): the `Stop` hook
fires at the end of EVERY assistant turn, not once at session termination. Evidence
(firsthand, in-repo): `session-end-nudge.js` increments a per-Stop response counter
and `context-size-warn-stop.js` increments a per-Stop `turn_count`; the
`stop_hook_active` envelope field exists precisely because Stop re-fires. So a naive
"spawn on Stop" carrier would launch one detached `claude -p` (60s) PER TURN — a
50-turn session = 50 spawns. The carrier MUST debounce per session.

## Why a detached background spawn (the latency constraint)

The producer's judge spawns `claude -p` with a **60s** default timeout
(`_lib/capability-free-claude.js`). A Stop hook carries a `"timeout"` of 3–10
**seconds** and runs synchronously. Running the audit inline would blow the timeout
and stall the turn. So the carrier hands off: spawn the producer **detached +
unref'd**, pass stdin through, exit 0. The audit completes out-of-band.

## Runtime Probes (firsthand, this session)

| # | Claim | Probe | Observed |
|---|---|---|---|
| P1 | A detached + `unref()`'d child spawned by a hook-shaped parent survives the parent's exit. | `/tmp` spike: parent spawns `{detached:true,stdio:'ignore'}.unref()` a child that sleeps 2s then writes a sentinel; parent exits immediately. | Sentinel absent at hook-return, present after 3s; child `ppid:1`, `sleptMs:2007`. **PASS** (OS-level; harness-level is R1 below). |
| P2 | The Stop stdin envelope is JSON carrying `transcript_path`. | PreCompact stdout this session carried it; `context-size-warn-stop.js` reads `envelope.transcript_path`. | Confirmed. **PASS.** |
| P3 | The carrier needs NO `session_id` from the envelope. | `drift-audit.js:buildDigest` derives sessionId from transcript CONTENT (dominant in-transcript `sessionId`), not the filename/caller. | Confirmed (lines 97–126). Carrier passes only `--transcript <path>`. **PASS.** |
| P4 | Producer CLI is `node drift-audit.js --transcript <path>`, fail-open (exit 0 always), killswitch-first. | Read CLI block (237–251) + `killed()` (50–52) + `auditTranscript` try/catch (218–229). | Confirmed. **PASS.** |
| P5 | Concurrent audits of one session do NOT double-emit. | `recordEmissions` = one `withLockSoft` section + per-(session,class) `isEmitted` re-check; test T8 = 8-way race → 1 emit. | Confirmed. Carrier needs no lock of its own. **PASS.** |
| P6 | `Stop` fires per turn (not per session close). | `session-end-nudge.js`/`context-size-warn-stop.js` both keep per-Stop counters; `stop_hook_active` field. | Confirmed. Drives the debounce. **PASS.** |
| P7 | `fs.readFileSync(<FIFO>)` BLOCKS (the detached-producer hang vector). | hacker `/tmp` probe. | Hung >1500ms. Drives the producer `isFile` hardening. **PASS.** |

### R1 — harness-level reaping (NOT load-bearing; gated at VALIDATE)

P1 proves OS-level survival but ran the parent as a plain `node` process, not the
real CC Stop harness. Whether CC SIGKILLs the hook's process **tree** on completion
is unsettled (a `detached:true` child is in a new process group, so a group-kill
would not reach it — but a descendant-walk could). **This is deliberately NOT a
load-bearing premise FOR CORRECTNESS:** a reaped realtime spawn never loses
correctness (the emitted-set is the source of truth; the marker is an
optimization). **Honest caveat (VALIDATE honesty-auditor):** PR-2 ships WITHOUT
the cron — that is PR-3 — so the "cron drains the marker" backstop materializes
only once PR-3 lands. Until then, if the realtime spawn IS reaped in production,
PR-2 STANDALONE writes a marker consumed by nobody and delivers no heartbeat
(correctness preserved, feature inert in the interim). So PR-2's realtime VALUE
(not its correctness) does depend on R1. Evidence gathered this session: an
OS-level probe (P1) AND a Bash-tool-harness proxy probe both showed a detached +
`unref()`'d grandchild SURVIVES its parent's exit (reparented to `ppid:1`). The
proxy is the Bash *tool*, not a Stop *hook* (hooks carry timeouts and MAY differ),
so it materially de-risks R1 but is not conclusive; the definitive Stop-hook
dogfood is gated post-`claude plugin update` (install the hook, `EMIT=1`, end a
real session, assert the audit ran) — most faithful AFTER the hook is installed,
not via a mid-session `settings.local.json` hook that may not register until
restart. Per ADR-0012 the concern is "don't build ENFORCEMENT on a non-existent
harness mechanism that BRICKS" — this is advisory + degrades gracefully (once PR-3
lands), so nothing bricks.

## Design

A thin, fail-open Stop hook: `packages/kernel/hooks/lifecycle/ghost-heartbeat-stop.js`.

```
module scope:
  let input = ''                         // module-scope so 'finally' always sees it
  DRIFT_AUDIT = path.join(__dirname, '../../spawn-state/drift-audit.js')   // __dirname-anchored, absolute
  MARKER_DIR  = ~/.claude/checkpoints/ghost-heartbeat-spawns/
  MIN_BYTES   = envInt('GHOST_HEARTBEAT_MIN_BYTES', 16384)   // NaN/neg-guarded
  DEBOUNCE_MS = envInt('GHOST_HEARTBEAT_DEBOUNCE_MS', 900000) // 15 min; NaN/neg-guarded

statFile(p)        := try { st = fs.statSync(p); return st.isFile() ? st : null } catch { return null }   // ONE stat: isFile + size + throw
markerPathFor(tp)  := MARKER_DIR / sha256(tp).slice(0,16) + '.json'
shouldSpawn(tp,now):= read marker.lastSpawnAt (tolerant); return now - last >= DEBOUNCE_MS
buildSpawn(tp)     := { bin: process.execPath, args: [SCRIPT, '--transcript', tp], options: {detached:true, stdio:'ignore'} }   // pure, golden-tested; SCRIPT = AUDIT_BIN_override || DRIFT_AUDIT

on stdin 'data': input += chunk
on stdin 'end':
  try:
    if env.GHOST_HEARTBEAT_EMIT !== '1':      return        // OPT-IN, default-off
    if env.GHOST_HEARTBEAT_DISABLED === '1':  return        // killswitch
    envelope := JSON.parse(input)                            // throw -> catch
    st := statFile(envelope.transcript_path)
    if !st:                                   return        // missing / not-a-file / unreadable
    if st.size < MIN_BYTES:                   return        // throttle: skip trivial sessions (O(1))
    if !shouldSpawn(tp, now):                 return        // DEBOUNCE: at most once / window / session
    writeAtomic(markerPathFor(tp), {transcriptPath: tp, lastSpawnAt: now})   // upsert marker (also PR-3's queue)
    const {bin,args,options} = buildSpawn(tp)
    spawn(bin, args, options).unref()                       // detached handoff, never awaited
  catch e: logger('error', {msg: e.message})                // swallow — advisory, never break the turn
  finally: process.stdout.write(input)                      // SINGLE pass-through for ALL paths; natural exit (NO process.exit -> stdout drains)
```

Decisions + rationale (folding the VERIFY board):

- **Debounce (architect HIGH).** One marker file per session anchor
  (`sha256(transcript_path)`), holding `lastSpawnAt`. `writeAtomic`, NO lock — an
  occasional race double-spawn is harmless (the producer dedups the EMIT, P5); the
  debounce only reduces average rate. The marker is ALSO PR-3's drain queue (zero
  extra code there). Marker pruning is PR-3's job (markers are ~100 B; ~1/session).
  **Honest bound (VALIDATE hacker MED):** the bound is "1 per (`transcript_path`,
  window)", NOT "1 per session" — `transcript_path` AND the harness `session_id`
  both ROTATE at compaction ([[harness-runid-session-rotation]]), so a long
  *compacting* session may spawn a few extra times. This is BOUNDED and
  wasteful-not-incorrect: the producer's content-keyed emit-dedup (the dominant
  in-transcript `sessionId`) is the correctness boundary, robust to path rotation.
  No cheap compaction-stable key exists for the carrier (the stable key is the
  content-derived `sessionId`, which needs the hot-path parse the carrier
  deliberately avoids), so the debounce stays path-keyed and the global per-window
  spawn cap is deferred to PR-3.
- **`process.execPath` + `__dirname`-anchored script (reviewer/architect/hacker).**
  Bare `'node'` resolves against the detached child's inherited PATH (a poisoned
  `.`/project-local shim → attacker `node`); `process.execPath` removes PATH from
  the trust surface. `DRIFT_AUDIT` is absolute from `__dirname` (the hook's cwd is
  the project root, not its own dir).
- **NaN-guarded env ints (reviewer HIGH).** `parseInt('garbage')→NaN`; `size < NaN`
  is `false`, silently disabling the throttle. `envInt` returns the default unless
  the parse is a finite `>= 0` number. Default `MIN_BYTES` 4096→**16384** (4 KB ≈
  one turn in this transcript format — filters almost nothing; 16 KB filters
  genuinely trivial sessions). MIN_BYTES is a coarse pre-filter; the DEBOUNCE is
  the real rate control.
- **One `statFile` (reviewer/hacker MED).** `statSync` + `.isFile()` in a single
  call handles missing / permission-denied / symlink-to-dir / symlink-to-FIFO at
  the carrier's stat time, and yields `size` without a second stat (no TOCTOU
  between two carrier stats).
- **Pure `buildSpawn` (reviewer MED).** Golden-testable: asserts the
  `{detached:true, stdio:'ignore'}` + `process.execPath` triple structurally, not
  just via a timing proxy.
- **Single `finally` pass-through (reviewer LOW).** Every gate just `return`s; the
  one `finally { stdout.write(input) }` passes through for all paths (no
  double-write). NO `process.exit` — the event loop drains stdout naturally before
  exit (reviewer confirmed: a POSIX pipe `stdout.write` is synchronous; natural
  exit avoids truncation).
- **Chain placement (architect LOW).** Insert the carrier entry BEFORE
  `context-size-warn-stop.js` so that hook keeps its self-declared "last" position
  (its `_comment` cares); the carrier emits no forcing instruction, so order is
  immaterial to output concatenation.

## Files

| File | Change |
|---|---|
| `packages/kernel/hooks/lifecycle/ghost-heartbeat-stop.js` | NEW — the carrier hook (~90 LoC) |
| `packages/kernel/hooks.json` | EDIT — insert a `Stop` entry BEFORE context-size-warn-stop (timeout 5s) |
| `packages/kernel/spawn-state/drift-audit.js` | EDIT (scoped hardening) — (a) `readTranscriptText`: `if (!stat.isFile()) return ''` after `statSync` (closes the FIFO/dir hang the auto-trigger makes reachable, P7); (b) `bumpSignal`: `spawnSync('node'…)` → `spawnSync(process.execPath…)` (same PATH-hijack class, now auto-fired) |
| `tests/unit/hooks/ghost-heartbeat-stop.test.js` | NEW — carrier suite (C1–C12) |
| `tests/unit/scripts/drift-audit.test.js` | EDIT — add T-isfile (directory) + T-isfile-fifo (a real FIFO via a timeout-bounded child → digest fail-closed, no hang) |
| `docs/SIGNPOST.md` | REGEN if drifted (CI `--check`) |
| `packages/specs/rfcs/2026-06-19-ghost-heartbeat-w2-drift-emit.md` | EDIT — flip the §5.5 W2-PR2 row to LANDED + record the carrier design + resolve OQ-W2-2 |

## TDD test spec

Carrier (`tests/unit/hooks/ghost-heartbeat-stop.test.js`) — drive by piping a JSON
envelope to the hook's stdin (real subprocess) and asserting (a) stdout === input,
exit 0 always; (b) whether a spawn occurred. A test-only `GHOST_HEARTBEAT_AUDIT_BIN`
points the spawn at a stub that records its argv to a file (the production default
is the real `drift-audit.js`).

| # | Test | Asserts |
|---|---|---|
| C1 | opt-in OFF → stdout===input, exit 0, stub NOT invoked | default-off |
| C2 | opt-in ON + >MIN_BYTES + no marker → stub invoked with `--transcript <path>`; stdout===input; marker written | happy path + correct argv |
| C3 | killswitch `DISABLED=1` (opt-in ON) → stub NOT invoked | killswitch wins |
| C4 | opt-in ON, `transcript_path` missing → no spawn | no-target fail-open |
| C5 | opt-in ON, `transcript_path` = nonexistent file → no spawn | statFile guard |
| C5b | opt-in ON, `transcript_path` = a DIRECTORY → no spawn | isFile (not just exists) |
| C6 | opt-in ON, size < MIN_BYTES → no spawn | throttle |
| C7 | malformed stdin (not JSON) → stdout===input verbatim, exit 0, no spawn | fail-soft parse |
| C8 | empty stdin → exit 0, no throw, no spawn | degenerate input |
| C9 | `buildSpawn()` golden → `{bin: process.execPath, args:[DRIFT_AUDIT,'--transcript',tp], options:{detached:true,stdio:'ignore'}}` | spawn-options structurally pinned |
| C10 | stub holds the event loop 3s (`Atomics.wait`) → hook returns < 1s | non-blocking (the load-bearing latency claim, against the ACTUAL carrier) |
| C11 | two Stops for the same transcript within DEBOUNCE_MS → exactly ONE spawn; a third after the window (marker mtime forced back) → spawns again | debounce bounds per-turn amplification |
| C12 | `GHOST_HEARTBEAT_MIN_BYTES=garbage` → falls back to default (throttle still ACTIVE), not disabled | NaN guard |

Producer (`drift-audit.test.js`) — add:
| T-isfile | `buildDigest(<directory path>)` → `{ok:false}` (fail-closed, no hang, no throw) | isFile hardening (P7) |

## Threat model delta (vs #369 RFC §6) — corrected per the hacker lens

PR-2 adds an **auto-trigger** to the producer. The #369 claim "no NEW data crosses a
trust boundary" is **corrected** (it was inaccurate): the carrier adds a small new
surface — its OWN `statSync`/`isFile`/`size` reads of `transcript_path` in the
turn-end hot path, and an auto-firing detached child that survives the session.

- **T-carrier-1 — auto-spawn.** Mitigated: default-off, killswitch, byte-throttle,
  DEBOUNCE (≤1 spawn/window/session), and the producer's own caps (capability-free
  judge, allowlist-only emit, maxEmit 6).
- **T-carrier-2 — `transcript_path` injection.** SAFE: argv-array spawn
  (`shell:false`), so flag-looking / whitespace / newline values are single literal
  args (hacker probe-confirmed); the producer's `argv.indexOf('--transcript')` takes
  the literal next element; a bogus path throws ENOENT → fail-closed.
- **T-carrier-3 — special-file (FIFO/dir) content.** The carrier's `statFile` +
  `.isFile()` rejects a symlink-to-FIFO/dir at stat time; the PRODUCER now ALSO
  rechecks `stat.isFile()` before `readFileSync` (closes the P7 hang). Residual: a
  microsecond TOCTOU swap AFTER the producer's own stat — negligible (advisory
  feature; `transcript_path` is harness-supplied, not user free-text) and deferred
  to the sandbox tier with the other R12 host-isolation residuals.
- **T-carrier-4 — PATH hijack of the detached child.** Closed: `process.execPath`,
  not bare `'node'`.
- **T-carrier-5 — concurrent-window fan-out.** Rate is bounded by concurrent-window
  count × the per-session debounce, NOT "one." No recursion (the judge is
  capability-free, cannot spawn). A global per-window cap is deferred to PR-3.
- **Deferred LOW (env inheritance).** The detached child inherits the full
  `process.env` (so it keeps `HOME`/`PATH` the producer needs for its state path).
  A curated minimal env was considered and DEFERRED: it is fragile (must enumerate
  every var the producer/store needs) and the child is capability-free + local, so
  the exfil exposure is minimal. Revisit at the sandbox tier.
- **Unchanged residual (narrows-not-hardens / integrity≠provenance):** the carrier
  derives no trust; it only chooses WHEN to invoke the producer (passes only
  `--transcript`). Counts still gate a human-triage prompt, never an action; the
  sessionId is still self-asserted. The moment a `drift:` count gates an action it
  needs an authenticated writer — PR-2 does not change this.

## Pre-Approval Verification (3-lens VERIFY board, this session)

| Lens | agentId | Verdict | Disposition |
|---|---|---|---|
| architect | a1cf29fef7a6a714f | SOUND-WITH-NOTES | per-turn Stop (HIGH) → debounce FOLDED; throttle default 4096→16384 FOLDED; node-path FOLDED; chain-placement prose FOLDED; R1 reframed not-load-bearing |
| code-reviewer | ae41f2e292651cbb1 | PASS-WITH-NOTES | NaN throttle (HIGH) FOLDED; DRIFT_AUDIT path (HIGH) FOLDED; isFile() (MED) FOLDED; buildSpawn golden (MED) FOLDED; input scope + C10 hold (LOW) FOLDED; stdout-flush confirmed safe |
| hacker | a4ad885b0bf5f772c | BLOCKERS-FOUND (2 MED) | FIFO/TOCTOU (MED) → producer `isFile` recheck FOLDED + residual deferred; bare-node PATH (MED) FOLDED; per-window cap (LOW) → threat-model corrected, cap→PR-3; env-strip (LOW) DEFERRED with rationale; trust-boundary overclaim CORRECTED |

## VALIDATE result (3-lens post-build board, on the BUILT diff)

| Lens | agentId | Verdict | Disposition |
|---|---|---|---|
| code-reviewer | a4c32f3897dd8a66a | PASS-WITH-NOTES | FIFO-at-marker-path `shouldSpawn` block (MED) → `statFile` guard on the marker read FOLDED; marker-before-spawn skip (LOW) ACCEPTED (negligible, well-typed spawn); spawn async-error comment (LOW) FOLDED. Fail-open confirmed complete; C9/C10/C11 confirmed honest + non-vacuous. |
| hacker (live re-probe) | a721a66c713794000 | NO-BLOCKERS | LIVE-confirmed: FIFO hang closed (~1 ms), injection safe (argv-array), killswitch robust (exact `'1'`), marker-write fail-closed, no fd leak. Debounce-keys-on-path (MED) → honesty correction FOLDED (per-(path,window) bound; global cap → PR-3), NOT re-keyed (no cheap compaction-stable key). Hex `MIN_BYTES` (LOW) → whole-string-digit parse FOLDED. Env-inherit (LOW) DEFERRED. |
| honesty-auditor | ace7f107b0f7e03a2 | MINOR-GAPS (grade B) | T-isfile relabel (HIGH — tested a dir, not the FIFO it claimed) → T-isfile-fifo FOLDED (real FIFO, timeout-bounded). RFC deliverable unapplied (HIGH) → RFC §5.5 LANDED + OQ-W2-2 FOLDED. Wrong producer-test path (MED) → FOLDED. R1-value silence → R1 framing CORRECTED (PR-2 standalone inert-if-reaped). All 5 spot-checked folds verified present in code. |

All board folds applied; carrier 13/13 + producer 17/17 (incl. the now-real T-isfile-fifo) green.

### CodeRabbit (round 1, all 3 valid → folded)

- **Major (inline) — carrier `shouldSpawn` marker-read TOCTOU.** `statFile(mp)` then
  `readFileSync(mp)` re-reads by path → a swap to a FIFO between check and read
  blocks the turn. FOLDED via a new shared `_lib/safe-read.js` `withRegularFileFd`
  (open `O_NONBLOCK` + `fstat` the bound fd + read-from-fd), matching the repo's
  established fix (`evolution-snapshot-read.js`).
- **Major (outside-diff) — producer `readTranscriptText` TOCTOU** (the residual I'd
  deferred). Same fix via `withRegularFileFd` — UPGRADED from deferred to closed
  (CodeRabbit showed a cheap established pattern exists). 5 helper tests (safe-read).
- **Major (outside-diff) — RFC §5.2 still described the retired design** (MIN_TURNS /
  synchronous `spawnSync` / session-close). FOLDED (§5.2 now matches the landed
  detached/debounced contract; §5.5 + OQ-W2-2 were already corrected).

## Drift Notes

- The arc dogfooded its own motive AGAIN (twice): (1) the plan's "Stop = session
  close" premise was a drift:plan-honesty miss the VERIFY board caught; (2) the
  built T-isfile was a relabeled-slot (tested a directory, claimed the FIFO
  hang-fix) the VALIDATE honesty-auditor caught — both the exact classes this
  feature surfaces.
- `route-decide` returned root/0 (substrate-meta catch-22); hand-escalated to route.

## Acceptance gate

- [x] Carrier unit tests green (C1–C12) + producer T-isfile + T-isfile-fifo (13/13 + 17/17).
- [x] Full kernel suite green + `bash install.sh --hooks --test` (the only 2 fails are the documented local-stale-cache `contract-plugin-hook-deployment` artifact — auto-passes in CI — and a pre-existing untracked unrelated `.md`'s yaml-lint; SIGNPOST regenerated → Test 121 OK).
- [x] R1 dogfood recorded as a PROXY (OS-level P1 + a Bash-tool-harness probe both show the detached child survives `ppid:1`); the definitive Stop-hook dogfood is gated post-`claude plugin update` (proxy is the Bash tool, not a hook). Cron backstop = PR-3.
- [ ] CodeRabbit gate: inline-comments + reviews surfaces (NOT the status-check), premise-probe each, fold. (PENDING — post-push.)
- [x] SIGNPOST regenerated (drifted by the new `.js`; Test 121 now OK).
- [ ] PR opened for the USER merge gate (never auto-merge). (PENDING.)
