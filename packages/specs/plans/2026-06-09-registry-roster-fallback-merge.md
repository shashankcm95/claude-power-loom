---
status: complete
research_artifact: null
lifecycle: ephemeral
---

# Plan — identity-registry roster-fallback merge (skills-audit research #33)

## Context

The 2026-06-09 skills audit (finding #33) surfaced a CODE bug: `agent-identity.js assign --persona 14-codebase-locator` fails with `No roster for persona: 14-codebase-locator` on any install whose identity store was initialized BEFORE the HT.1.6 roster expansion added personas 14-16. The store's `rosters`/`nextIndex` maps are frozen at init time; every read path uses `meta.rosters || { ...DEFAULT_ROSTERS }`-style fallbacks that only fire when the map is entirely ABSENT — a stale-but-present map wins and the new personas never appear. The error message compounds it ("Add one to DEFAULT_ROSTERS" — persona 14 IS in `DEFAULT_ROSTERS`).

## Routing Decision

```json
{ "recommendation": "root", "score_total": 0, "note": "stakes-lexicon miss on substrate work (known); escalated by judgment to a right-sized wave: plan + architect VERIFY + TDD + code-reviewer VALIDATE. No team spawn." }
```

## HETS Spawn Plan

- VERIFY (pre-build): `architect` (read-only) pressure-tests this plan.
- VALIDATE (post-build): `code-reviewer` (read-only) on the diff. Single lens — contained read-path fix; not kernel/auth (the 3-lens tier is not triggered), but the diff sits on the `readStore()` chokepoint, hence the architect pass.

## Runtime Probes

- Probe 1 (REPRO): legacy-mode store written with 13 personas (pre-HT.1.6 shape), then `HETS_IDENTITY_STORE=<tmp> node agent-identity.js assign --persona 14-codebase-locator` → `No roster for persona: 14-codebase-locator. Add one to DEFAULT_ROSTERS or store.rosters.` (observed 2026-06-09, this session).
- Probe 2 (root cause): `registry.js:180-181` — `rosters: meta.rosters || { ...DEFAULT_ROSTERS }`; `||` fires only when the key is absent entirely. Same class at `_readStoreLegacy` (returns parsed file verbatim, `:139`) and `_readStoreConsolidated` (`:152`).
- Probe 3 (blast radius): `lifecycle-spawn.js:105,389` gate on `store.rosters[args.persona]`; both reached via `readStore()` (`lifecycle-spawn.js:104`). `_h70-test.js:59` builds fixtures with the FULL `{ ...ai.DEFAULT_ROSTERS }` so the merge is a no-op there.
- Probe 4 (write round-trip): cold-path mutators (`cmdAssign` under `withLock`, `cmdPrune --auto`, `cmdUnretire`) do `readStore()` → mutate → `writeStore(store)`; a read-time merge therefore PERSISTS on the next RMW (self-healing, intended; documented below).

## Files To Modify

| File | Change | Risk |
|---|---|---|
| `packages/runtime/orchestration/identity/registry.js` | Add pure `_mergeRosterDefaults(store)`; apply at the `readStore()` chokepoint (all 3 modes) | medium (every identity op flows through it) |
| `tests/unit/runtime/identity/registry-roster-fallback.test.js` | NEW — red-first TDD test | low |

## Design

One pure function, applied once at the single read chokepoint:

```js
function _mergeRosterDefaults(store) {
  // per-key: STORED entries win (custom rosters / index positions preserved);
  // keys missing from an older-init store are filled from DEFAULT_ROSTERS.
  return {
    ...store,
    rosters: { ...DEFAULT_ROSTERS, ...(store.rosters || {}) },
    nextIndex: {
      ...Object.fromEntries(Object.keys(DEFAULT_ROSTERS).map((k) => [k, 0])),
      ...(store.nextIndex || {}),
    },
  };
}
```

`readStore()` returns `_mergeRosterDefaults(<mode-specific read>)`. New objects only (immutability rule); `nextChallengerIndex` and `identities` pass through untouched.

## Phases

- [x] 1. RED: write the test. Cases (expanded per VERIFY Findings 2+5): (a) legacy-mode old-13 store → `readStore().rosters['14-codebase-locator']` present + `nextIndex['14-codebase-locator']===0`; (b) **partitioned mode** — old-13 `_metadata.json` under an active bulkhead sentinel (child-process with `CLAUDE_LIBRARY_ROOT`=tmpdir) → same asserts; (c) stored custom roster entry wins over default; (d) stored `nextIndex` position preserved; (e) `identities` pass through untouched; (f) `nextChallengerIndex` survives the merge untouched; (g) `readPersona('14-codebase-locator')` on an old store returns `{identities:{}, version:1}` (persona path unaffected — Finding 1). RED observed: (a)/(b)/(h end-to-end) FAIL on the pre-fix impl; (g) passes (preservation case).
- [x] 2. GREEN: implement `_mergeRosterDefaults` + wire into `readStore()`; export for tests. Load-bearing comments at `_mergeRosterDefaults` + `readPersona` (merge lives at the readStore layer; readPersona is identities-only by design). All new tests pass (5/5).
- [x] 3. Regression: `_h70-test.js` 73/0, kernel suite exit 0, `bash install.sh --hooks --test` 121/0 (incl. bulkhead smoke tests 111-113), runtime/scripts unit suites clean. Smoke-test grep (Finding 7): Test 112 asserts identity COUNTS (3), not roster keys — unaffected.
- [x] 4. Live re-probe: folded as test case (h) — replays Probe 1 end-to-end; assign succeeds with a `14-codebase-locator.*` identity AND the merged roster persists on the RMW round-trip (self-heal verified).
- [x] 5. VALIDATE: code-reviewer on the diff → **APPROVE** (0 CRITICAL/HIGH; spread order, 3-branch wiring, readPersona hot-path exemption, fresh-store no-op, falsy guards, ASCII/lint all confirmed). Folded its 2 MED coverage gaps (partitioned `nextChallengerIndex` assert + the fresh-store no-op unit test) and the LOW try/finally tmpdir cleanup before commit.

## Pre-Approval Verification

Architect VERIFY (2026-06-09): **PROCEED** — design structurally sound; `readStore()` confirmed as the correct single chokepoint (the only bypass, `readPersona`, is identities-only and benign); merge is idempotent so RMW round-trip persistence is convergent self-heal, not drift; `nextIndex` zero-seed byte-identical to `emptyStore()`. Folds applied: partitioned-mode + challenger-index + readPersona RED tests (Findings 2/5/1), load-bearing comments, smoke-test count grep (Finding 7), migration-tooling scope note (Finding 6).

## Verification Probes (aggregate)

Probe 1 re-run green is the acceptance signal; full gates per Phase 3.

## Out of Scope (Deferred)

- Roster-REMOVAL support (no CLI exists to remove a roster; the merge resurrects a hand-deleted default key on next read — acceptable; the alternative is the live bug).
- The misleading error message in `lifecycle-spawn.js` (becomes unreachable for default-roster personas after the fix; message text untouched).
- pre-compact-save.js stale store-path resolver (separate chip, task_a59e44a1).
- Partition migration tooling (`library-migrate.js`) reads raw `cons.rosters` directly (not via `readStore()`) and so partitions possibly-stale rosters — pre-existing behavior; the first post-partition `readStore()` merge backfills (VERIFY Finding 6).

## Drift Notes

- route-decide scored 0 (`root`) on a store-chokepoint change — the known stakes-lexicon gap on substrate work; judgment-escalated per MEMORY guidance.
