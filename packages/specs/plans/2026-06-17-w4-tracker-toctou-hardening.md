---
lifecycle: persistent
phase: ③.0-W4
status: BUILT + VALIDATED (3-lens SHIP-WITH-NOTES) — cleared to PR
date: 2026-06-17
---

# ③.0-W4 — fact-force-gate tracker TOCTOU hardening (③.0-W3 VALIDATE finding H-LOW-1 follow-up)

A follow-up hardening for the live external-PR beta, closing the ③.0-W3 VALIDATE hacker's H-LOW-1.
All SHADOW; trust moves ZERO (OQ-NS-6). Per-wave workflow: plan + Runtime Probes -> 3-lens VERIFY ->
TDD build -> 3-lens VALIDATE (hacker live re-probe) -> full gate -> PR -> CodeRabbit -> USER merge.

## The finding (H-LOW-1, ③.0-W3 VALIDATE)

`fact-force-gate.js` writes its read-tracker to a DETERMINISTIC path in `os.tmpdir()`:
`claude-read-tracker-<sha256(session_id)[:16]>.json`. `saveTracker -> writeAtomic ->
_resolveForAtomicWrite` (`packages/kernel/_lib/atomic-write.js`) FOLLOWS a same-uid symlink planted
at that path -> a local attacker can redirect/clobber an attacker-chosen file. Pre-existing (the
pre-W3 raw-`SESSION_ID` path was equally predictable); rated LOW (same-uid only; fail-open file).

## Threat-model sharpening (the honest scope — this REFRAMES the fix)

The probes below establish what is ACTUALLY in scope:

- **Same-uid attacker = NOT a privilege boundary, and NOT fixable at the JS layer.** A process running
  as the same uid can write the attacker's chosen target FILE directly — it does not need the symlink
  trick, and it already owns the substrate (it can edit the kernel JS, read secrets, etc.). This is
  exactly why `atomic-write.js:120` concedes same-uid ("OQ-E / ContainerAdapter"). **The demonstrated
  H-LOW-1 (same-uid) cannot be closed here** — neither fix candidate closes it (see below). It stays
  the conceded container-tier residual (v4.x).
- **Foreign-uid attacker (shared multi-user machine) = the only in-threat-model vector.**
  `_foreignOwned` (`atomic-write.js:67-69,126-131`) already REFUSES foreign-uid redirection to an
  EXISTING foreign target — but the documented residual (`atomic-write.js:121-125`) is that a symlink
  to a NON-EXISTENT target is still followed (creates a writer-owned file at the attacker's chosen
  path). The actionable hardening is to deny a foreign uid the ability to plant ANY symlink at the
  predictable path in the first place.
- **Platform split (Probe P3):** on **macOS** `os.tmpdir()` is ALREADY a per-user `0700` dir
  (`/var/folders/.../T`, owned by the user) — the foreign-uid vector is **already closed by the OS**;
  the fix is defense-in-depth + portability there. On **Linux**, `os.tmpdir()` is typically `/tmp`
  (`1777`, world-writable) — the foreign-uid plant vector is **real** and the fix closes it.

## Why candidate fix 2 (O_NOFOLLOW in the shared helper) is REJECTED

`_resolveForAtomicWrite` INTENTIONALLY follows same-uid symlinks — that is the legit v2.8.5 FIX-H3
case (`~/.claude/*.json` is a symlink into the library volume; the write must follow it to preserve
the symlink). Adding `O_NOFOLLOW` / refuse-symlink to the shared helper would RE-BREAK FIX-H3
(`atomic-write.js:71-96`). So fix 2 is non-viable. (Probe P2.)

## Chosen fix — candidate 1: a per-uid `0700` subdir for the tracker (local to the gate)

Place the tracker in `<os.tmpdir()>/claude-loom-<uid>/claude-read-tracker-<key>.json`, where the
subdir is created `mode 0700` (owner-only). A foreign uid cannot enter/write a `0700` dir it does not
own, so it cannot pre-plant a symlink at the predictable tracker path -> closes the foreign-uid plant
vector + the non-existent-target residual at the SOURCE, without touching the shared `atomic-write`
contract (FIX-H3 preserved).

- **TOCTOU-safe dir establishment** (`trackerDir(base)`): `mkdirSync(dir, {mode:0o700})` (atomic;
  fails `EEXIST` if present). On `EEXIST`, `lstatSync` the dir and require ALL of: is a real directory,
  is NOT a symlink, is owned by us (uid match, when uid is knowable), and has NO group/other perm bits
  (`(mode & 0o077) === 0`). If any check fails (symlink / foreign-owned / loose perms) -> the entry is
  untrusted -> **fall back to the flat `os.tmpdir()` path** (status quo — strictly no regression).
- `resolveTrackerPath(data, base)` -> `path.join(trackerDir(base), 'claude-read-tracker-' + key + '.json')`.
  Production calls with `base` undefined (`os.tmpdir()`); the `base` seam is for tests.
- Windows: `process.getuid` is undefined -> subdir name `claude-loom-default`; `os.tmpdir()` is already
  per-user on Windows; the `(mode & 0o077)` check is a POSIX-perm concept (benign on Windows fs).
- **Honest scope (in-code + PR) — tightened post-VERIFY (H-1/ARCH-1/H4-1):** closes the FOREIGN-uid
  plant vector **WHEN the `0700` subdir is established** (real on Linux `/tmp`; defense-in-depth on
  macOS where tmpdir is already `0700`), and — as a consequence — the **foreign-uid projection** of
  the non-existent-target residual. **Conditional, not unconditional:** a foreign uid can pre-plant
  `claude-loom-<uid>` (the name is predictable = the numeric uid) on Linux `/tmp`, FORCING the
  fallback-to-flat where the residual is unchanged (status quo — never worse, but NOT closed). The
  fallback is logged (`tracker_subdir_unsafe_fallback`) so a forced-fallback is OBSERVABLE, not
  silent. Does NOT close the same-uid case (conceded, container-tier). **No rand-suffix retry** (a
  per-process random dir would diverge between the Read process and the Edit process -> brick the
  cross-process stability the tracker requires). No regression on fallback.

## Runtime Probes (firsthand-verified 2026-06-17, against `cffa4ed` = post-#344 main)

| # | Claim | Probe | Observed |
|---|---|---|---|
| P1 | the gate writes the tracker to a flat predictable `os.tmpdir()` path | `Read fact-force-gate.js:62-63` | `resolveTrackerPath` = `path.join(os.tmpdir(), 'claude-read-tracker-' + sha256(session_id)[:16] + '.json')` — flat, no subdir |
| P2 | `_resolveForAtomicWrite` FOLLOWS same-uid symlinks by design (so O_NOFOLLOW would break FIX-H3) | `Read atomic-write.js:71-132` | follows the chain; `_foreignOwned` refuses ONLY foreign-uid redirection to an existing target; same-uid followed (the FIX-H3 library-volume case at :71-96); non-existent-target residual documented at :121-125 |
| P3 | macOS tmpdir is already per-user `0700`; Linux `/tmp` is world-writable | `node -e "fs.statSync(os.tmpdir())"` on this host | macOS: `/var/folders/.../T` mode `700`, uid 501 (me), others-write=false, sticky=false. (Linux `/tmp` is `1777` — world-writable + sticky, by OS convention) |
| P4 | `#344` merged; the gate has the W3 sha256 key | `gh pr view 344`; `git show origin/main:...gate.js` | `#344` MERGED `cffa4ed`; gate exports `deriveSessionKey`/`resolveTrackerPath`, sha256 key live |

## HETS Spawn Plan (kernel + security diff -> full 3-lens tier per workflow Rule 2)

- **VERIFY (pre-build, read-only personas, parallel):**
  - `architect` — is the per-uid `0700` subdir the right design? Is the TOCTOU-safe creation
    (`mkdir 0700` + `lstat`-verify-on-EEXIST + fall-back-to-flat) correct + fail-never? Is the
    `base`-seam clean? Any simpler KISS option?
  - `hacker` — does the `0700` subdir ACTUALLY close the foreign-uid plant vector, or is there a
    TOCTOU on the dir-verify itself? Can a foreign/same-uid attacker still win? Is the honest scope
    correct (same-uid NOT closed; is that the right concession)? Does the fallback re-open anything?
  - `honesty-auditor` — does the fix CLOSE what it claims (foreign-uid residual) and is the
    same-uid concession + the macOS-already-covered nuance stated honestly (not overclaimed as
    "fixes the TOCTOU")?
- **BUILD** — TDD: tests first (red), then impl. Orchestrator-direct build -> no Rule-4 subject.
- **VALIDATE (post-build, parallel):** `code-reviewer` + `hacker` (Rule-2a LIVE re-probe: plant a
  symlink at the subdir path, confirm fallback; confirm 0700; confirm no brick + fail-open) +
  `honesty-auditor` (diff vs claims).

## Routing Decision

```json
{ "recommendation": "route", "escalation": "kernel security-hardening diff -> 3-lens VERIFY + VALIDATE per workflow Rule 2",
  "note": "TOCTOU / symlink / 0700 are security-stakes tokens; this is genuinely architect+hacker-shaped." }
```

## Files

| File | Change | Kind |
|---|---|---|
| `packages/kernel/hooks/pre/fact-force-gate.js` | add `trackerDir(base)` + `isSafeTrackerDirStat` (per-uid 0700 subdir, TOCTOU-safe, never-throws, reuses `currentUid`); `resolveTrackerPath(data, base)` uses it; `saveTracker` pre-mkdir 0700 (H4-2); unsafe-fallback log; honest-scope comments; exports | code (kernel) |
| `packages/kernel/hooks/lifecycle/session-reset.js` | **[VALIDATE HIGH-1 fold]** the SessionStart stale-tracker cleanup now sweeps the per-uid subdir too (reuses the gate's `trackerDir()`), else W4-relocated trackers accumulate unbounded | code (kernel) |
| `tests/unit/hooks/fact-force-gate.test.js` | +8 W4 cases (subdir-0700, path-inside-subdir, symlink->fallback, **fallback-emits-log**, loose-perms->fallback, reuse-safe-dir, non-EEXIST-error->fallback/no-throw, remove-race->0700-recreate) + `isSafeTrackerDirStat` unit asserts; 28 prior preserved -> **48 asserts total** | test |

## Pre-push gate

`bash install.sh --hooks --test` + full kernel suite + the fact-force-gate test file +
`node scripts/validate-doc-paths.js`. No new source FILE (only a new function) -> SIGNPOST regen
not required (verify Test 121 stays green regardless).

## Out of Scope

- The same-uid TOCTOU (conceded container-tier residual — v4.x ContainerAdapter; documented, not closed).
- The broad `atomic-write.js` O_NOFOLLOW change (rejected — would break FIX-H3).

## Drift Notes

- This wave closes the standing MEMORY watch "M1 TOCTOU symlink-swap accepted — re-evaluate when
  multi-agent/concurrent" for the FOREIGN-uid dimension; the same-uid dimension stays conceded.

## VERIFY result (3-lens board) + folds — 2026-06-17

Board: architect **BLESS-WITH-NOTES**, hacker **BLESS-WITH-NOTES** (live /tmp spikes S1-S10),
honesty **BLESS-WITH-NOTES** (Grade A-). No NEEDS-REVISION. The honesty lens firsthand-verified the
H-LOW-1 reframe is HONEST (it AGREES with the W3 same-uid-only classification + surfaces the
concession prominently — not threat-redefinition). Each finding premise-probed before folding.

| Finding | Sev | Fold |
|---|---|---|
| **ARCH-1 / H4-1** | HIGH | **Claim tightened + observability added.** The foreign-uid closure is CONDITIONAL on the subdir being established; a foreign uid can pre-plant `claude-loom-<uid>` to force fallback-to-flat (hacker spike S9 clobbered a victim end-to-end). KEEP the fallback (fail-closed would brick the SHADOW gate's read-before-edit). Downgrade the claim to "closes on a clean tmpdir; forced-fallback = status quo, never worse" + **log `tracker_subdir_unsafe_fallback`** so a forced fallback is observable. **No rand-suffix retry** (would brick cross-process stability). |
| **ARCH-3** | MED | **`trackerDir` self-contains.** Wrap the WHOLE establish-and-verify body in try/catch -> return flat base on ANY error (not just EEXIST-unsafe); mkdirSync ENOSPC/EACCES/EROFS + lstat ENOENT no longer escape to silently disable the gate. Doc the "never throws" contract. + a test forcing a non-EEXIST mkdir error (base parent is a regular file). |
| **H4-2** | MED | **Re-ensure the dir at `0700` before the write.** `writeAtomic` recreates a removed subdir at `0755` (its `mkdirSync` at `atomic-write.js:148` has no mode arg; FIX-H3 forbids changing it). saveTracker pre-`mkdirSync(dirname,{recursive:true,mode:0o700})` so OUR mode wins on a remove-race. Precondition is same-uid OR a non-sticky world-writable tmpdir (sticky `/tmp` is foreign-safe) — narrow, but cheap to close + documented. |
| **ARCH-2** | MED | **DRY: reuse `currentUid()` from `safe-resolve.js`** (NOT a hand-rolled `typeof process.getuid`); keep the dir-predicate local (genuinely different from the file-oriented `isSafeExecStat`: `isDirectory`+`0o077` vs `isFile`+`0o022`) with a cross-reference comment to `safe-resolve.js:79-88` explaining the mask difference. |
| **ARCH-4 / H4-3 / ARCH-5** | LOW/NOTE | In-code notes: `mode 0o700` is best-effort (umask narrows-never-loosens; the `(mode&0o077)===0` lstat-verify-on-reuse is the actual enforcement); the subdir is a permanent cheap-disable under a foreign pre-plant on world-writable tmpdir (reverts to status quo); keep the redundant-but-documenting `isSymbolicLink` check. |
| **H-1 / H-3 / H-4** | LOW/NOTE | Honesty wording: "closes the non-existent-target residual" -> "the foreign-uid PROJECTION of it"; "strictly no regression" keeps the nuance that the fallback IS the attacker's win condition; **commit/PR title must carry the `foreign-uid` qualifier** (NOT "fix tracker TOCTOU" unqualified). |
| **H-2** | LOW | The macOS-`0700` premise (P3) — the VALIDATE hacker re-runs the literal `node -e fs.statSync(os.tmpdir())` and pastes it into the VALIDATE result (closes the honesty lens's no-Bash negative-attestation). |
| **H-5** | NOTE | Candidate-2 (O_NOFOLLOW) rejection is evidence-backed (FIX-H3 `atomic-write.js:71-96`) — no action. |

## VALIDATE result (3-lens board on the BUILT diff) + folds — 2026-06-17

Board: code-reviewer **SHIP-WITH-NOTES**, hacker **SHIP-WITH-NOTES** (Rule-2a live re-probe — node
spikes against the built module + a full spawnSync E2E + the macOS-`0700` premise re-probe pasted
`700 501 501`), honesty **SHIP-WITH-NOTES** (Grade A-, NO load-bearing overclaim). No
CRITICAL/HIGH-SECURITY blocker (the one HIGH is disk-hygiene). Each finding premise-probed before
disposition.

| Finding | Sev | Disposition |
|---|---|---|
| **HIGH-1** (reviewer) | HIGH (disk-hygiene, NOT security) | **FOLDED.** Premise-probed firsthand: `session-reset.js:160-166` prefix-matches `claude-read-tracker-*` on the FLAT tmpdir — so pre-W4 it DID clean the gate's flat trackers; W4 relocated them into `claude-loom-<uid>/` out of that sweep's reach -> unbounded accumulation (a W4-caused cleanup regression, gate behavior itself unaffected — `loadTracker` fail-opens). Fixed: session-reset now sweeps the subdir too via the gate's `trackerDir()` (DRY). |
| **M1** (hacker) | MED | **Comment tightened (no code change).** `saveTracker`'s H4-2 pre-mkdir closes the remove-WITHOUT-replant case; a remove-THEN-symlink in the same window follows the planted link, but its precondition is same-uid OR non-sticky world-writable tmpdir = the CONCEDED same-uid/container-tier residual (sticky `/tmp` blocks foreign rm; `_foreignOwned` refuses a foreign redirect target). In-code SCOPE note added; still strictly safer than the pre-W4 flat path. |
| **H-LOW-1** (honesty) | LOW | **FOLDED (test added).** New W4-3b asserts the forced-fallback EMITS `tracker_subdir_unsafe_fallback` (captured via `LOOM_LOG_DIR`) — turns "observable" from wired-and-plausible into test-demonstrated. |
| **H-NOTE-2** (honesty) | NOTE | **FOLDED (comment).** Softened "removes the plant surface at the source" -> "...WHEN the subdir is established" so the verb matches its own conditional. |
| **H-LOW-2 / H-NOTE-1** (honesty) | LOW/NOTE | Commit/PR title carries the `foreign-uid` qualifier (NOT a bare "fix tracker TOCTOU"); PR body states the actual test count (48 asserts), not "5 new"/"46". |
| **L1** (hacker) | LOW | Documented residual (no code): a symlinked ANCESTOR of `os.tmpdir()` is invisible to the final-component lstat — the exact `safe-resolve.js:36-40` parent-dir-symlink residual; a parent-walk adds no lower-privilege protection on POSIX and risks false-refusals on legit symlinked tmpdirs. |
| **L2** (hacker) | LOW | Subsumed by the HIGH-1 fold — the accumulation is now swept (was pre-existing W3 behavior; W4 + this fold give it a GC for the first time). |
| **NOTE-1/2/3** (reviewer) | NOTE | No action — `isSymbolicLink` redundancy is deliberate+documented; the `0o077` mask is correct through type bits; the `saveTracker` pre-mkdir scope is correct + tested. |

**Honesty headline:** NO sentence claims the TOCTOU is "fixed"; the foreign-uid closure is consistently
scoped "WHEN the subdir is established / on a clean tmpdir", the same-uid case is conceded in caps, and
the fallback is honest status-quo. The board confirmed the wave is portable hardening, not theater.
Cleared to PR for the USER merge gate.

### CodeRabbit gate (#345) — 1 actionable (Major), folded

CodeRabbit (re-reviewed to completion; check `pass`) flagged ONE Major quick-win, premise-probed valid
and folded: `trackerDir`'s catch logged the EEXIST-unsafe fallback but **silently** returned `root` for
non-EEXIST mkdir errors (`EACCES`/`ENOSPC`/`EROFS`) — so the per-uid hardening could be disabled by an
ENVIRONMENTAL fault with no signal, inconsistent with the ARCH-1 observability intent. Fold: the
non-EEXIST fallback now logs the same greppable `tracker_subdir_unsafe_fallback` event with a `reason`
discriminator (`unsafe_entry` = possible foreign-plant vs `mkdir_failed` + `code` = environmental
fault) so an operator can tell a security signal from a disk/perms fault. Test W4-6 extended to assert
the `mkdir_failed` log fires (suite now 49 asserts/0).
