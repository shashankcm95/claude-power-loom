---
lifecycle: persistent
phase: ③.1-W1
date: 2026-06-17
status: PLAN (pre-VERIFY)
---

# ③.1-W1 — session-reset dead-write fix + ROADMAP ③.0 phase-close sign-off

The first dry-run wave: clears the two ③.0 carry-forwards bundled as carry #1
(`2026-06-17-v3.0-foundation-close` volume) — the MED `session-reset.js` dead-write
and the deferred ROADMAP `## Phase-close sign-off` for ③.0. SHADOW; trust ZERO
(OQ-NS-6); version HELD at 3.11 (no release surface touched).

## Goal

1. **Fix the dead reset-write** in `packages/kernel/hooks/lifecycle/session-reset.js`
   (the gate's SessionStart companion) so the SessionStart hook no longer writes a
   read-tracker to a path the fact-force-gate never reads.
2. **Record the ③.0 phase-close sign-off** in `docs/ROADMAP.md`, mirroring the
   per-phase `## Phase-close sign-off` format, sourced from the `v3.0-foundation-close`
   library volume.

## Runtime Probes (firsthand, against the repo at `147799a` — not prose/memory)

| Claim | Probe | Result |
|---|---|---|
| The gate keys the tracker per-session via `sha256(payload session_id)` in a per-uid subdir | `grep` `resolveTrackerPath`/`deriveSessionKey` in `fact-force-gate.js:165` | CONFIRMED — `resolveTrackerPath(data,base)=path.join(trackerDir(base), 'claude-read-tracker-'+deriveSessionKey(data)+'.json')`; `deriveSessionKey` = `sha256(session_id ?? sessionId ?? env ?? ppid).slice(0,16)` |
| `session-reset.js:50` writes to the OLD flat path (`os.tmpdir()/claude-read-tracker-<env SESSION_ID>.json`) | Read `session-reset.js:30-53` | CONFIRMED — `TRACKER_PATH = path.join(os.tmpdir(), 'claude-read-tracker-'+SESSION_ID+'.json')`, `SESSION_ID = env.CLAUDE_SESSION_ID ?? … ?? ppid`. Wrong dir AND wrong key derivation vs the gate → the gate never reads it = DEAD write. |
| The reset-write is also REDUNDANT (per-session keying already yields clean-slate) | Read `loadTracker` (`fact-force-gate.js:177`) | CONFIRMED — `loadTracker` returns `{files:{}, sessionStart: Date.now()}` on missing/parse-fail. A new `session_id` → new sha key → nonexistent file → clean slate automatically. |
| Nothing reads `tracker.sessionStart` (the only field the reset-write adds beyond `{files:{}}`) | `grep -rn sessionStart packages/` | CONFIRMED — `sessionStart` is only WRITTEN (loadTracker fallback + shape docstring); zero consumers. `session-end-nudge`'s `sessionStart` is unrelated separate state. |
| `writeAtomic` is used ONLY by the dead write in session-reset.js | `grep -n writeAtomic session-reset.js` | CONFIRMED — sole use at line 50 → removing the write lets the import (line 22) go. |
| `SESSION_ID` is used elsewhere | `grep -n SESSION_ID session-reset.js` | Used at 30 (def), 31 (TRACKER_PATH), 50 (write), 55 (logger `sessionId`). After removal, only the logger uses it. |
| session-reset.js reads NO stdin payload today | `grep -n stdin session-reset.js` | CONFIRMED — no stdin read; `SESSION_ID` is env-only. (Relevant to Option A below.) |
| No existing test for session-reset.js | `find tests -name '*session-reset*'` | CONFIRMED — none. TDD adds `tests/unit/hooks/session-reset.test.js`. |
| The ③.0 sign-off content + ROADMAP format | Read `v3.0-foundation-close` volume + `docs/ROADMAP.md:470-510` | CONFIRMED — per-phase `## ✅ <phase> …` + `## Phase-close sign-off (<phase>, <date>)` pattern; insert after the v-next section (line ~511), before `## ⬜ Deferred`. |

## The design fork (for the VERIFY board to ratify)

The carry note (and the v3.0-close volume) proposed **Option A**:
`writeAtomic(resolveTrackerPath(null), {files:{}, sessionStart})` + drop `TRACKER_PATH`.

**Probe finding:** `resolveTrackerPath(null)` derives the key from the `ppid` floor
(`deriveSessionKey({})` → no `session_id` → `process.ppid`), which STILL would not
match the gate's key (the gate prefers the PreToolUse payload `session_id`). To match,
Option A would have to **read the SessionStart stdin payload** and pass its `session_id`
to `resolveTrackerPath(data)` — adding a new stdin-read code path to a SessionStart hook
and resting on an unprobed harness claim (SessionStart payload `session_id` ===
PreToolUse payload `session_id`).

**Option B (RECOMMENDED) — remove the dead write entirely (KISS / dead-code elimination):**
- The write is DEAD (wrong path) AND REDUNDANT (per-session keying + `loadTracker`
  clean-on-missing already give every new session a clean slate) AND its only
  non-`{files:{}}` payload (`sessionStart`) has zero consumers.
- Remove: the `writeAtomic(TRACKER_PATH, …)` call (L50-53), the `TRACKER_PATH` const
  (L31), the now-unused `writeAtomic` import (L22) + its H.9.8 migration comment.
- Keep: `SESSION_ID` (the diagnostic logger), the TTL SWEEP (flat + per-uid subdir),
  all diagnostic warnings. SessionStart stops needing to know the gate's per-session
  key shape at all (clean decoupling — the gate owns its tracker lifecycle).
- **Behavior delta:** the only observable change is that a *resumed* session reusing the
  SAME `session_id` keeps its prior read-records instead of being cleared. That is
  arguably MORE correct (you DID read those files in this logical session), and the
  current dead write does not achieve the reset anyway (wrong path). Reset-on-resume,
  if ever wanted, is a separate future feature — YAGNI here.

Recommendation: **Option B.** Rationale: it is strictly simpler, removes dead code,
adds no new failure surface, and rests only on already-probed facts (no new harness
assumption). The architect VERIFY pass adjudicates; the hacker VALIDATE pass checks the
security question (does removing the SessionStart reset open a stale-tracker bypass of
the Read-before-Edit gate?).

## Build (TDD)

1. Write `tests/unit/hooks/session-reset.test.js` FIRST (red against current impl):
   - The SessionStart hook, when run, does NOT create/write any
     `claude-read-tracker-*.json` in the flat tmpdir (asserts the dead write is gone).
   - The TTL sweep still removes a >1-day-old `claude-read-tracker-*.json` in the flat
     tmpdir AND in the per-uid subdir (regression guard — must keep working).
   - A fresh (<1-day) tracker is NOT swept.
   - The hook exits 0 and emits no stdout (SessionStart contract).
   - Diagnostics: the plugin-root warning path + marketplace branches are exercised at
     least to "does not throw" (fail-soft envelope).
   - **Oracle discipline (vacuous-oracle guard, Rule-2a / v3.9-W1):** every assertion
     EXERCISES a real effect and is platform-independent (no hardcoded `/Users`; drive
     the sweep with files the test itself plants under a redirected `TMPDIR`).
2. Run red → confirm the no-write assertion fails against current impl.
3. Apply Option B (pending VERIFY ratification) → green.

## VALIDATE (post-build, 3-lens — kernel security-control diff)

- **code-reviewer** (correctness): the removal is complete and side-effect-free; the sweep
  and diagnostics intact; no dangling refs (`TRACKER_PATH`/`writeAtomic`).
- **hacker** (adversarial-security): does removing the SessionStart reset open a
  stale-tracker bypass of the Read-before-Edit gate (a prior same-`session_id` session's
  read-records persisting)? Probe the gate's actual read path against a planted stale
  tracker.
- **honesty-auditor** (claim-vs-evidence): is the "dead + redundant + sessionStart-unread"
  premise actually true on file:line? Is the ROADMAP sign-off a faithful mirror of the
  v3.0-close volume (no upgraded claims, "narrows" stays "narrows")?

## Gate + PR

`bash install.sh --hooks --test` (118/0) + full kernel suite green + the new
session-reset test green + lab suite green. Branch `feat/w1-session-reset-deadwrite`,
PR, CodeRabbit gate, USER merge. Version held 3.11 (no release surface; `--allow-unbumped`
not needed — no bump claimed). ROADMAP is a living doc (in-place sign-off append is the
workflow, not an immutability violation).

## Drift Notes

- The carry note + the v3.0-close volume both recorded the fix as Option A
  (`resolveTrackerPath(null)`). The probe found that form is itself buggy (ppid key).
  This is a `drift:plan-honesty`-adjacent case: a carried "the fix is X" prose claim is a
  PREMISE to probe, not a fact — re-probed against source before building, found the
  simpler+correct Option B. Surfacing to VERIFY rather than silently swapping.

## Named residual (VERIFY finding #6 — accept, don't silently drop)

- **Same-`session_id` resume retains read-records (pre-existing fail-OPEN; orthogonal to
  W1).** The gate's freshness rests on per-session keying + a **1-day file-level** TTL
  sweep (`session-reset.js:167`); `loadTracker` never compares per-entry read timestamps
  against now (the Edit path is a bare truthiness check, `fact-force-gate.js:267`). So a
  session resumed with the SAME `session_id` can Edit-from-memory a file Read long ago.
  Option B consciously chooses "retain on resume" (more faithful for a per-session gate),
  which makes this residual a NAMED accepted carry, not a silent drop. The dead write
  never closed it (wrong path). Compaction `session_id` rotation only *helps* (new key →
  clean slate). **Carry candidate (v-next opportunistic-hardening):** a per-entry
  read-recency TTL in the gate's Edit path — separate future hardening, NOT W1 scope.

## VERIFY board result (architect, 2026-06-17) — READY-WITH-CORRECTIONS

Option B ruled correct **decisively** (re-verified dead+redundant on file:line; Option A
"doesn't even fix the bug as the carry note wrote it" — `resolveTrackerPath(null)` keys by
`ppid`; matching the gate would need an UNPROBED SessionStart-payload-`session_id`
assumption — ADR-0012 failure class). Corrections folded into Build/Test below:

1. **[MED] Test-oracle: add a POSITIVE companion** — after the hook runs, assert the
   gate's resolved path `resolveTrackerPath(<known payload>, base)` ALSO does not exist
   (prove the hook touches NEITHER flat nor per-uid tracker location — kills the
   "asserted absence in the wrong dir" vacuous false-green).
2. **[MED] Sweep regression: cover the `subdir === tmpDir` fallback branch** — force
   `trackerDir()` to return the flat base (via the `base` seam), assert no double-unlink /
   no throw. Not just the happy two-dir path.
3. **[LOW] Remove BOTH stale comment blocks** (`:18-21` + `:47-49`, the H.9.8 write
   narration) — keep `:23-28` (the `trackerDir` reuse comment, load-bearing for the sweep).
4. **[LOW] Honesty: rename the `reset` log event** to `session_start` (the hook no longer
   resets anything) — confirm nothing greps the literal `reset` event name first.
5. **[NOTE] ROADMAP insertion** at ~`:511` (between the v-next `---` and `## ⬜ Deferred`),
   two-part `## ✅ <phase>` + `## Phase-close sign-off (<phase>, <date>)` shape; honesty:
   carry "CLOSEABLE-WITH-NOTES" + "SHADOW / trust ZERO / version held 3.11", no
   narrows→hardens upgrade. Mirror the `v3.0-foundation-close` volume on claim strength.
6. **[NOTE] Name the Q4(a) residual** — done above ("Named residual" section).

## VALIDATE board result (3-lens, post-build, 2026-06-17) — SHIP

Kernel security-control diff → full 3-lens parallel tier (all read-only personas):

- **code-reviewer (correctness) — SHIP-WITH-NITS.** Removal complete + side-effect-free
  (zero dangling `TRACKER_PATH`/`writeAtomic`; `SESSION_ID` still used by the logger; try
  envelope intact); sweep + diagnostics unchanged; 10/10 tests, oracles non-vacuous,
  sandboxing sound; ROADMAP honest. 1 LOW (tombstone comment) → **FOLDED** (collapsed to
  one line referencing the header).
- **hacker (adversarial-security, 7 live probes) — SHIP-WITH-RESIDUAL.** **Probe 3 proved
  the change opens NO new bypass** — the removed write was a dead no-op that never touched
  the gate's read path, so removing it is net-neutral for an attacker. The pre-seed
  Edit-without-Read bypass (M1) is REAL but **pre-existing (W3/W4-era), same-uid
  container-tier only; the foreign-uid boundary HOLDS** (Probe 4: `isSafeTrackerDirStat`
  refuses foreign/group-bit/symlink dirs; real dir `drwx------ 501`). The sweep is
  symlink/traversal-safe (Probe 5, cleared). L1 (forced-flat-fallback) = the pre-existing
  W4 conceded residual, NOT a W1 regression. The "Named residual" (per-entry read-recency
  TTL) is the correct v-next carry → KEPT named.
- **honesty-auditor (claim-vs-evidence) — NO-OVERCLAIM (Grade A).** All 3 code premises
  (DEAD / REDUNDANT / sessionStart-UNREAD) CONFIRMED on file:line; the ROADMAP sign-off is
  a faithful mirror of the volume (verdict strength + SHADOW/trust-ZERO/3.11 + every
  finding/disposition + the 2282 figure preserved, no narrows→hardens); "RESOLVED in
  ③.1-W1" annotation verified accurate against the diff. 1 MINOR-DRIFT (B.10: the EC table
  is synthesized, not a verbatim source table) → **FOLDED** (added a synthesis disclosure
  line above the table).

**Net: SHIP.** No CRITICAL/HIGH/MED blocked; both cosmetic nits folded. Residual carried
named to v-next (per-entry read-recency TTL in the gate's Edit path; same-uid container-tier).
