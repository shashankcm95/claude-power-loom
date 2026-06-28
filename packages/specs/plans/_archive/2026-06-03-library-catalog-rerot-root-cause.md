---
lifecycle: ephemeral
archive-after: 2026-07-03
---

# Library Catalog Re-Rot — Reconciliation Fix

**Goal:** stop `_catalog.json` from drifting stale after direct volume writes, so `library ls`/`read`/`daybook` recall stays accurate without a manual `reindex`.

> **Framing (honesty-auditor, folded):** this is a **reconciliation** fix, not a literal root-cause fix. The root cause is that the pre-compact `SAVE_PROMPT` (`pre-compact-save.js:167`) instructs a *direct* file-write that bypasses the catalog-updating `library write`. That instruction is left in place by design (Opt D — making the model use `library write` — was rejected as compliance-dependent). Instead we make the bypass *safe* deterministically: the catalog self-reconciles on every write. "Eliminates re-rot," not "removed the bypass."

**Context:** `/self-improve` 2026-06-03 found the session-snapshots catalog frozen at 2026-05-27 (and `agents/*` stacks stale too). I shipped `library reindex` (the manual broom) + repaired the live catalog (44 vols). This plan kills the *re-rot* so the broom isn't needed on a cadence.

## Runtime Probes (claims grounded against the repo, not prose)

| # | Claim | Probe | Result |
|---|---|---|---|
| P1 | Snapshots are written by the **model via direct file-write**, bypassing `library write` | `grep SAVE_PROMPT pre-compact-save.js:167` | SAVE_PROMPT instructs: "write a session snapshot to `…/volumes/<slug>.md`" — no `library write`. CONFIRMED |
| P2 | `library write` (`cmdWrite`) is the **only** path that calls `catalog.upsertEntry` from the CLI | `grep upsertEntry scripts/library.js` | Only `cmdWrite:304`. CONFIRMED |
| P3 | A **second** code writer (`persona-store.writePersonaVolume`) writes `agents/*` volumes via `writeAtomic`, **no catalog upsert** | `grep upsertEntry persona-store.js` → empty; `persona-store.js:110-114` | `writeAtomic(personaVolumePath…)`, no upsert. CONFIRMED (explains agents/identities 1→14, verdicts 1→17 rot) |
| P4 | The two writers use **different mechanisms** → no single-mechanism fix covers both | P1 = Write *tool* (model); P3 = Node `fs` (`writeAtomic`) | CONFIRMED — a PostToolUse:Write hook sees the model's Write tool, NOT Node-fs writes |
| P5 | hooks.json already has a **PostToolUse** array with 6 hooks (adding one is structurally consistent) | `node -e hooks.json` | PostToolUse: error-critic, network-egress-audit, kb-citation-gate, spawn-record, spawn-close-resolver, validate-plan-schema. CONFIRMED |
| P6 | `SessionStart` runs `session-reset.js` (a natural slot for a pre-read reindex) | hooks.json | SessionStart: session-reset.js. CONFIRMED |
| P7 | `cmdRead` THROWS if a volume isn't in the catalog (so staleness has a correctness impact, not just `ls` cosmetics) | `library.js:259-262` | `throw "volume not in catalog"`. CONFIRMED |
| P8 | `catalog.upsertEntry(section, stack, entry)` is lock-protected + idempotent (safe to call per-write) | `library-catalog.js:147-166` | read-modify-write under `withLock`, replace-by-`volume_id`. CONFIRMED |
| P9 | `reindex` (just built) rebuilds a whole stack deterministically from disk | Test 120 + live run | 44 vols/7 stacks. CONFIRMED |

## Design options (for architect pressure-test)

Two writer mechanisms (P4) ⇒ likely a two-pronged fix. Candidate primitives:

- **Opt A — at-source upsert (code writers) + PostToolUse:Write reconciler (model writes):**
  - `persona-store.writePersonaVolume` (+ `writeMetadata`?) calls `catalog.upsertEntry` after `writeAtomic` (deterministic, P8).
  - New `PostToolUse:Write` hook upserts when a Write tool targets `…/library/sections/*/stacks/*/volumes/*.{md,json}` (catches model snapshot writes deterministically; no prompt-compliance dependency). Covers `mempalace-fallback.md` via resolved path.
  - *Pro:* deterministic + instant (fixes P7 same-session reads). *Con:* two code sites + a new hook; the hook fires on every Write (cheap early-exit on path mismatch).
- **Opt B — SessionStart reindex:** `session-reset.js` runs `reindex` (all stacks) at session start, before daybook/cold-read reads. *Pro:* one site, covers ALL writers + future ones (P9). *Con:* re-hashes ~44+ files every session start (cost); still a lag — a volume written *this* session isn't readable until *next* session start (P7 same-session read still fails).
- **Opt C — pre-compact reindex:** `pre-compact-save.js` reindexes before emitting SAVE_PROMPT. *Con:* worst timing — reindex runs BEFORE the model writes the snapshot, so snapshot N is indexed only at compaction N+1 → MISSED at session N+1 cold-read. REJECT for snapshots.
- **Opt D — change SAVE_PROMPT to use `library write`:** model pipes content via `library write … <<EOF`. *Con:* behavioral (model may not comply); `library write` reads stdin — awkward to instruct reliably. Weak.

**Recommendation to test:** Opt A (deterministic, instant, fixes P7) — possibly with Opt B as a cheap self-healing backstop (drift-guarded: only reindex a stack if on-disk volume count ≠ catalog entry count, to avoid re-hashing every start). Architect to rule on A vs A+B and on whether the PostToolUse hook should also match Edit.

## Test plan (TDD)

1. **Red first:** unit test — `writePersonaVolume` leaves catalog stale (current behavior) → will flip to "catalog has the entry."
2. PostToolUse:Write reconciler: unit test the path-match + upsert (model-write simulation: write a file into a volumes/ dir, invoke the hook with a Write payload, assert catalog upserted). Negative: a Write OUTSIDE volumes/ is a no-op.
3. Idempotency: re-running the reconciler on the same write doesn't duplicate (P8 replace-by-id).
4. Regression: existing library smoke (105, 116–120) + reindex Test 120 stay green.
5. Hook-smoke: hooks.json still valid JSON; new hook registered.

## Risks / unknowns (for architect)

- R1: PostToolUse:Write fires on EVERY Write — confirm early-exit cost is negligible + it never blocks (advisory, never throws to the pipeline).
- R2: does the model ever write snapshots via `Edit` (not `Write`) or via the `!`-bash `library write`? If so the hook misses it — Opt B backstop covers that.
- R3: `persona-store` upsert needs topic/entities extraction for JSON (schematic) — `extractFromJson` exists; confirm the agents JSON shape yields sane topic/entities (not secrets).
- R4: scope creep — should `pattern-recorder.js` / `registry.js` consolidated writes also upsert? Enumerate ALL `personaVolumePath`/`writeAtomic`-into-volumes sites so we don't fix 2 of 3.

## HETS Spawn Plan

- **Pre-build verify:** 1 architect (read-only) — rule on Opt A vs A+B, the Edit-match question, and R1–R4. Honesty lens folded into the architect ask (is "deterministic" actually true given P4?).
- **Build:** single coupled change (persona-store upsert + reconciler hook share the catalog-upsert contract) — one node-backend builder, TDD.
- **Post-build validate:** 3-lens parallel tier (kernel/data-mutation review) — `code-reviewer` (correctness/idempotency/fd-leaks) + `hacker` (can a crafted volume path or JSON poison the catalog / path-escape the volumes/ matcher?) + `honesty-auditor` (does it actually fix re-rot for BOTH writers, or just snapshots?).

Routing note: `route-decide` returned `root` (score 0.2) — the known `stakes`-lexicon false-negative (drift-note P3-2: kernel-hook + real-state writes carry no stakes token). Escalated by judgment per `route-decide.js` load-bearing comment.

## Pre-Approval Verification (architect, 2026-06-03)

**VERDICT: APPROVE-WITH-CHANGES.** Diagnosis + two-mechanism analysis sound; Opt A+B chosen (USER). Folded changes:

**BLOCKING (resolved):**
- **B1 — R4 incompleteness:** two unenumerated writers — `registry._writeStoreConsolidated` (`registry.js:164`) + `pattern-recorder._saveStoreConsolidated` (`pattern-recorder.js:117`) write `consolidated.json` directly via `writeAtomicShared`, bypassing `writePersonaVolume`. At-source upsert in the primitive does NOT catch them. **Decision: covered by Opt B (SessionStart drift-reindex), NOT at-source** (they're the non-bulkhead/upgrade path, not steady-state — YAGNI boundary). Enumerated, not silent.
- **B2 — `writeMetadata` EXCLUDE:** writes `_metadata.json` at `stackPath` (OUTSIDE `volumes/`, `library-paths.js:182`). Upserting it = bogus catalog entry. Do NOT add upsert there. (reindex/Opt B already skip it — only scans `volumesDir`.)
- **B3 — symlink realpath:** the reconciler must `fs.realpathSync` the Write `file_path` before the volumes-glob test, else `mempalace-fallback.md` (written at `~/.claude/checkpoints/…`, symlinked into the library) is missed. Named test case.

**Folded recommendations:**
- At-source upsert lives ONLY in `persona-store.writePersonaVolume` (one chokepoint for bulkhead writers #2–5); pass explicit `topic:[stackId,persona], entities:[]` (R3 safety, not `extractFromJson`); `content_hash = hashContent(JSON.stringify(data,null,2))` (match `writeAtomic` bytes).
- **Invariants to preserve (comment + test):** (i) acyclic — new edge `persona-store → library-catalog → library-paths`, no cycle; (ii) lock ordering — caller holds persona-lock, then upsert takes catalog-lock = `persona→catalog`, consistent everywhere (no path takes catalog→persona), no deadlock; (iii) all 3 mechanisms agree `volume_id = persona`.
- Reconciler matches **Write AND Edit**; fail-soft + exit 0 (ADR-0001, matches `error-critic.js` precedent); never blocks the pipeline.
- Opt B drift guard = `onDiskCount ≠ catalogCount` **OR** `max(mtime) > last_rebuilt` (count-alone misses in-place Edits). Runs as a **separate SessionStart hook** (NOT inlined into `session-reset.js` — SRP + the 3s timeout is already contended) with its own timeout, fail-soft.
- "deterministic" is qualified: true for the 3 hooked mechanisms (in-process code upsert; PostToolUse Write/Edit) + Opt B backstop for the residual (bash-heredoc/MultiEdit/consolidated.json).

**Build shape:** new shared module `packages/kernel/_lib/library-reconcile.js` (single source of truth: `extractCatalogMetadata` moved here; `buildEntryFromFile`, `reindexStack`, `stackHasDrift`) consumed by `cmdReindex` (refactor), the reconciler hook, the SessionStart hook; at-source upsert in `persona-store`. TDD; then 3-lens validate (code-reviewer + hacker + honesty-auditor).

## Post-Build Validation (3-lens tier, 2026-06-03)

Validated the built diff with a parallel `code-reviewer` + `hacker` + `honesty-auditor` tier. All material findings folded BEFORE commit:

**code-reviewer (HIGH):** `cmdReindex` (no-arg) + `buildEntryFromFile` lacked the per-stack/per-file resilience the SessionStart hook has → one unreadable file aborts the whole repair. **Fixed:** per-target try/catch in `cmdReindex`; `readFileSync` folded into the guarded try in `buildEntryFromFile`; per-file try/catch in `reindexStack`.

**hacker (CRITICAL C1 + HIGH H1/H2 + MEDIUM M2):**
- C1 — model-written volume content was hoisted UNSANITIZED into `topic`/`entities` → rendered into the daybook briefing the agent reads (injection/secret-leak channel that auto-indexing widens). **Fixed:** `_sanitizeTags` strips control chars + caps count/length at the upsert boundary (single chokepoint, so the catalog is always clean).
- H1 — the persona leak-guard (`entities:[]`) was bypassed on the direct-Write path (extraction leaked persona JSON values) AND the two writers disagreed on `topic`. **Fixed:** `_entryMetadata` applies the agents-section policy (`topic:[stackId,id], entities:[]`) for ALL paths, matching persona-store at-source exactly (convergence tested — `persona-store-catalog-upsert.test.js` P5).
- H2 — a >512MB file (`ERR_STRING_TOO_LONG`) poison-pill permanently re-failed every SessionStart. **Fixed:** `MAX_VOLUME_BYTES` size gate in the shared `_isIndexableVolume` predicate (used by BOTH index + drift-count, so no perpetual drift).
- M2 — `locateVolume` returned `dir` from the non-realpathed arg (latent cross-tree read). **Fixed:** `dir` derived from the realpathed target.
- M1 (TOCTOU symlink swap) — **accepted/documented** as a known limitation (semi-trusted local model, sub-ms window, display-only tag; fd-handle refactor low-ROI). See module header.

**honesty-auditor (OVERCLAIMS-PRESENT, all corrected):**
- "root-cause fix" relabel → **done** (this section's framing note).
- `f(f(x))` topic-divergence overclaim (falsified by live catalog) → **fixed** (convergence) + **tested** (P5).
- `consolidated.json` indexed as a recallable volume (diverged from `listPersonaVolumes`) → **fixed** (excluded in `_isIndexableVolume`; live reindex confirms agents/identities 14→13).
- H4 test name overclaimed its body → **fixed** (now exercises the agents/consolidated path).

**Gate:** repo eslint 0; kernel suite 49/0; library smokes 16/0; new tests — `library-reconcile` R1–R9, `persona-store-catalog-upsert` P1–P5, `catalog-reconcile-hooks` H1–H4.
