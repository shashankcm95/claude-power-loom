---
status: complete
research_artifact: null
lifecycle: ephemeral
---

# Plan — harden the homedir script-resolvers vs symlink/plant exec

## Context

Two kernel hooks resolve a CLI script across candidate paths then `spawnSync(process.execPath, [script, ...])`-execute it: `resolveSelfImproveScript()` (pre-compact-save.js, on the #281 branch) and `resolveStoreScript()` (auto-store-enrichment.js). A hacker VALIDATE (2026-06-09, PR #281) live-confirmed a PRE-EXISTING assume-breach finding: on a partial/broken install where the canonical `__dirname`-relative copies are absent, an attacker who can write into the user's `$HOME` can plant a regular file OR a symlink at a homedir candidate, and the hook executes it at the next compaction/stop event (`accessSync` follows symlinks; `spawnSync` runs the target). Same class as the accepted M1 TOCTOU symlink-swap note. This wave raises the bar; it is NOT a complete fix (see Threat-model honesty).

## Routing Decision

```json
{ "recommendation": "root-by-size, kernel-by-class", "note": "two kernel hooks + a shared _lib helper + tests; per-wave with the kernel-mandated 3-lens VALIDATE." }
```

Stacks on `fix/precompact-store-resolver` (#281): the pre-compact-save half edits `resolveSelfImproveScript`, which #281 just rewrote (spawn-state candidates + the `require.main` test seam). Retargets to main when #281 merges.

## HETS Spawn Plan

- VERIFY (pre-build): `architect` — the shared-helper factoring, the Windows `getuid` landmine, the all-miss fallback contract, and the threat-model honesty.
- VALIDATE (post-build): 3-lens parallel (code-reviewer + hacker + honesty-auditor) — REQUIRED (kernel + security diff). The hacker RE-PROBES the BUILT hardening with live symlink/plant probes (Rule 2a).

## Runtime Probes

- Probe 1 (harness): `fs.lstatSync(c)` does NOT follow symlinks — `isSymbolicLink()===true` on a symlink; `.uid===process.getuid()` works on POSIX (probed 2026-06-09: file uid 501 === proc uid 501). `fs.statSync` DOES follow (the dangerous one the resolvers currently use via `accessSync`).
- Probe 2 (Windows landmine): `process.getuid` is `undefined` on Windows AND `lstat().uid` is `0` there → a naive `uid === process.getuid()` is `0 === undefined` → false → EVERY candidate refused → both hooks silently no-op on Windows. MUST guard: apply the uid check only when `typeof process.getuid === 'function'`.
- Probe 3 (call sites): `auto-store-enrichment.js` — `const STORE_SCRIPT = resolveStoreScript()` at module load (L34); `storePattern()` wraps `spawnSync([STORE_SCRIPT,...])` in try/catch returning null (L160-177) → already null-tolerant. NO `module.exports` / `require.main` guard (resolver + stdin runner run at module load) → needs a test seam. `pre-compact-save.js` (#281 branch) already has the seam + returns null on all-miss.
- Probe 4 (existing helpers): `packages/kernel/_lib/safe-exec.js` exists (invocation, not resolution); `path-canonicalize.js`, `k9-path-guard.js` exist. None do lstat-symlink+uid resolution → a new `_lib/safe-resolve.js` is the right home (single responsibility).

## Threat-model honesty (load-bearing — for the honesty-auditor; reframed per VERIFY F1/F2/F4)

**The load-bearing defense is symlink-reject** — it is the only check that materially raises the bar against the stated actor. It closes the sub-case where an attacker can create a *symlink* at a candidate whose target is something they could not directly plant as a regular file there (a symlink pointing at an attacker file elsewhere, or at a system binary). It eliminates **passive partial-install exploitation** (plant once, never race).

**The uid-ownership check is cheap defense-in-depth, NOT a co-equal pillar.** On a correctly-permissioned `$HOME` (`0700`/`0755`) a *foreign* uid cannot create a file in `~/.claude/...` at all — the write fails at the OS layer, so there is no file to reject. The uid-check is material ONLY in the group/other-writable-`$HOME` *misconfiguration*. Keep it (near-zero cost), but do not advertise it as a second defense.

What it does NOT defend (state plainly in PR/commit — "raises the bar," not "closes the hole"; sharpened after the VALIDATE hacker re-probe):
- **same-uid full-`$HOME` breach** — an attacker who is the user can plant a same-uid regular file (or a same-uid **hardlink** — `isFile()` true, not a symlink, carries target's uid) that passes both checks. Needs a sandbox/signature (ContainerAdapter track).
- **symlinked PARENT directory** (VALIDATE hacker HIGH) — `lstat` no-follows the FINAL component only; a parent-dir symlink to an attacker dir is NOT detected. But reaching attacker *code* through one still requires a same-uid write (→ the breach above) OR is caught by the uid check (a foreign attacker's redirected target is foreign-owned). It **reduces to the same-uid residual** (honesty-auditor: "collapses into the already-disclosed same-uid breach"). A realpath/parent-walk close adds **no lower-privilege protection on POSIX** (uid-check already refuses the foreign case) and risks false-refusals on legitimately symlinked `$HOME` (e.g. `/home` automounts) → deferred to the sandbox track. The over-claim was in the *framing*, not a new hole.
- **WINDOWS** (VALIDATE hacker MEDIUM) — `process.getuid` absent → `selfUid=null` → uid check SKIPPED (without it every candidate is refused and the hooks die). So on Windows the final-component symlink/junction reject is the only gate and the parent-dir-junction gap is unguarded. Accepted (the no-op landmine is worse); documented.
- **residual TOCTOU**: two windows. (1) lstat→spawnSync path-reopen is **irreducible** at this layer — `spawnSync` runs `node <scriptPath>` and node re-opens the path by name; an fd can't be passed to the child. Accepted (matches the M1 note; VALIDATE hacker MEDIUM confirmed live but disclosed). (2) resolve-site→call-site drift: `auto-store`'s `STORE_SCRIPT` is resolved at *module load*, so window (2) spans the whole hook lifetime — narrowed by an F2 pre-spawn re-check in `storePattern` (collapses it to ~one statement), not eliminated.

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `packages/kernel/_lib/safe-resolve.js` | NEW — `isStatSafe(stat, selfUid)` (pure policy) + `isSafeExecCandidate(path)` (lstat + delegate) + `resolveExecCandidate(candidates)` (first-safe or null) | low (new, pure) |
| `packages/kernel/hooks/lifecycle/pre-compact-save.js` | `resolveSelfImproveScript` delegates to `resolveExecCandidate`; null on all-miss kept | low |
| `packages/kernel/hooks/lifecycle/auto-store-enrichment.js` | `resolveStoreScript` delegates; **all-miss returns null** (was `candidates[0]`); `storePattern` guards `if (!STORE_SCRIPT) return null`; add `module.exports` + `if (require.main === module)` test seam | medium (live Stop hook) |
| `tests/unit/kernel/safe-resolve.test.js` | NEW — pure-policy + fs-fixture tests | low |
| `tests/unit/kernel/resolver-symlink-hardening.test.js` | NEW — both resolvers refuse a planted symlink (child-process, HOME-isolated) | low |

## Design

```js
// safe-resolve.js — pure policy is unit-testable without root/chown.
function isStatSafe(stat, selfUid) {
  if (!stat) return false;
  if (stat.isSymbolicLink()) return false;            // symlink-swap defense (lstat, no-follow)
  if (!stat.isFile()) return false;                   // must be a regular file
  if (selfUid !== null && stat.uid !== selfUid) return false; // cross-uid plant defense (POSIX only)
  return true;
}
function currentUid() { return typeof process.getuid === 'function' ? process.getuid() : null; } // null = Windows: skip uid check
function isSafeExecCandidate(p) {
  try { return isStatSafe(fs.lstatSync(p), currentUid()); } catch { return false; }
}
function resolveExecCandidate(candidates) {
  for (const c of candidates) if (isSafeExecCandidate(c)) return c;
  return null;
}
```

Both resolvers become `return resolveExecCandidate(candidates);` (DRY). The uid check is POSIX-guarded (Windows → `selfUid=null` → skip, symlink+isFile checks still apply).

### Legacy-candidate evaluation (the user's explicit ask)

**Recommend KEEP** the `~/.claude/scripts/` legacy candidate in `resolveSelfImproveScript`, now hardened by the same `resolveExecCandidate` check. Rationale: it is a fail-soft last-resort that fires only when no canonical copy exists; the symlink+uid hardening neutralizes the attack vector WITHOUT removing the legacy-install resilience #281 deliberately shipped one PR ago. Dropping it would reverse a same-week decision (DN-3: don't bury a reversed decision) for marginal gain now that it is hardened. The two resolvers stay shape-divergent by one candidate — documented, intentional.

## VERIFY folds (architect, 2026-06-09 — PROCEED; applied)

- **F1** (MUST): threat block reframed above — symlink-reject load-bearing; uid-check is defense-in-depth only material on group/other-writable `$HOME`; hardlink same-uid passes (in-scope).
- **F2** (SHOULD): `storePattern` re-checks `isSafeExecCandidate(STORE_SCRIPT)` immediately before spawn — collapses the module-load→call-time window. (No-op for `runSelfImproveScan`: its resolve+spawn are adjacent.)
- **F3** (confirm): candidates[0]→null is a real improvement (kills a wasted child spawn + a misleading `store_failed` log); null-guard sufficient; only 2 readers of `STORE_SCRIPT`.
- **F5** (rename): `isStatSafe` → `isSafeExecStat` (binds to the exec-candidate domain). Mirror `memory-root.js:163` getuid-guard convention verbatim.
- **F6** (MUST): add a NO-SPAWN assertion for `STORE_SCRIPT===null` (spawnSync spy must NOT be called) + a null-stat pure-fn row + an accept-canonical EXACT-path pin for auto-store.
- **F8** (confirm): the entire stdin runner moves inside `if (require.main === module)`; `module.exports` added; test asserts require adds ZERO stdin listeners (delta, mirroring #281).
- **F9** (MUST): rewrite the pre-compact docblock — post-PR divergence (2) [null vs candidates[0]] DISAPPEARS (both null now); only the legacy 4th candidate remains divergent.

## Phases

- [x] 1. RED: `safe-resolve.test.js` (11 cases) + `resolver-symlink-hardening.test.js` (5 cases) — RED confirmed pre-impl (helper missing; 0/5).
- [x] 2. GREEN: `safe-resolve.js` added; both resolvers delegate to `resolveExecCandidate`; auto-store test seam + null-guard + F2 pre-spawn re-check; pre-compact docblock rewritten (F9); removed now-unused `fs` import from auto-store; updated #281's all-miss fixture to also copy `kernel/_lib` (the new dep).
- [x] 3. Gates: safe-resolve 11/11 · symlink-hardening 5/5 · precompact 4/4 · kernel suite 59 files exit 0 · `install.sh --hooks --test` 121/0 · eslint clean · live run-as-hook smoke BOTH hooks (auto-store passes input through, pre-compact emits SAVE_PROMPT).
- [x] 4. VALIDATE: 3-lens — code-reviewer APPROVE (all wiring/seam/exports/tests confirmed; 1 LOW: add an F2 post-load-swap test → DONE, 6th test), hacker NEEDS-FIXES (HIGH parent-dir-symlink + MEDIUM Windows-gap + MEDIUM residual-TOCTOU), honesty-auditor APPROVE (MEDIUM: tighten the symlink-reject claim). RESOLUTION: the parent-dir vector **reduces to the conceded same-uid breach** (all three lenses agree; a foreign attacker's redirected target is foreign-owned → uid-check refuses); a realpath/parent-walk close adds no lower-privilege protection on POSIX + risks false-refusals on symlinked-`$HOME` → the fix is **claim-tightening + the F2 test + the Windows note**, structural close deferred to ContainerAdapter (matches the other residuals). All folded. Final gates: safe-resolve 11/11 · symlink-hardening 6/6 · precompact 4/4 · kernel 59 files exit 0 · install 121/0 · eslint clean.

## Post-push CI + CodeRabbit fold (2026-06-10)

- **CI fail = `[SIGNPOST-DRIFT]`** (NOT doc-path) — adding `safe-resolve.js` drifted `docs/SIGNPOST.md`; `generate-signpost --check` is in the CI "Hook smoke + contracts" job but NOT in `install.sh --hooks --test`, so the local pre-push gate missed it. Regenerated. **Recurrence of the #260 lesson** — run `generate-signpost --check` + `contracts-validate` + `validate-doc-paths` locally before pushing, not just `--hooks --test`.
- **CodeRabbit Major #1 (real gap, folded)**: `isSafeExecStat` checked owner but NOT permission bits — a foreign uid can overwrite a SELF-owned `0664/0666` script (uid unchanged) and the candidate was still accepted. Added `(stat.mode & 0o022) !== 0 → refuse` (POSIX-guarded). **Closes** the foreign-uid misconfigured-`$HOME` case (foreign-plant via uid + loose-perms-overwrite via mode); upgrades the framing from "defense-in-depth" to "closes the foreign-uid case." Canonical scripts ship 0644/0755 → no FP. +2 synthetic rows + a real `chmod 0o666` fixture.
- **CodeRabbit Major #2 (test robustness, folded)**: `runChild` replaced the whole child env (`{PATH, HOME}`) — drops `SystemRoot` etc. + doesn't isolate on Windows (`os.homedir()` reads `USERPROFILE`). Fixed to `{...process.env, HOME, USERPROFILE}` across all 3 resolver test files.
- Re-gate: safe-resolve 13/13 · symlink-hardening 6/6 · precompact 4/4 · kernel 59 files exit 0 · install 121/0 · contracts/doc-path/persona/signpost `--check` all clean · eslint clean.

## Post-build VALIDATE record

- **Why no structural close for the parent-dir-symlink HIGH**: `lstat` no-follows the final component only. A parent-dir symlink to an attacker dir is undetected — BUT to run attacker *code* through it the target file must contain attacker bytes, i.e. be attacker-written = foreign-owned (uid-check refuses) OR same-uid (the conceded full-breach, which needs no symlink). So the vector grants a foreign attacker nothing new; the defect was the *framing* ("eliminates passive partial-install exploitation"), now corrected. A realpath-under-base check would refuse a redirect *outside* `$HOME` that the uid-check already refuses (foreign target) and cannot stop a same-uid redirect *inside* `$HOME` — net-zero on POSIX, and it false-refuses legitimately symlinked homes. Deferred, not power-thru.
- **Residual same-uid + TOCTOU + Windows**: disclosed in the module header + threat block; ContainerAdapter/sandbox track.

## Out of Scope (Deferred)

- Same-uid full-$HOME-breach (needs sandbox/signature — ContainerAdapter track).
- The residual lstat→spawnSync TOCTOU window (narrowed; the M1 accepted note).
- Applying the check to non-script spawns elsewhere in the kernel (this wave is the two CLI-resolvers only).

## Drift Notes

- Reuses the #281 pattern (resolver + test seam) one PR later — confirms the "resolver candidates must be safe-resolved" shape is recurring; a future `_lib/safe-resolve` adoption sweep across other spawn sites may be warranted.
