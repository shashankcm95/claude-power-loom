# Plan — Phase-2 scar materialization (the data half)

/ lifecycle: persistent (living plan; accretes VERIFY / VALIDATE / result sections) /

## Context

Phase-2's **tooling half** shipped (#515 `memory` CLI + #521 weight-aware `scoredHotSet`), but its **data half** never started: the live `scars-graduate-candidates.md` is a flat numbered list with **zero `### SCAR-NN` anchors**, so `memory blocks` returns 0 blocks and `scoredHotSet` has never scored a real block (built-but-dark, firsthand-verified 2026-07-07 by a 3-lens board). This slice materializes the data per `design:252`: anchor the scars as `### SCAR-NN`, fix the **live dup-24**, split by origin into `scars-{toolkit,pact,embers}.md`, seed the heat sidecar, and wire a curated ~5-item hot-scars pointer into the `MEMORY.md` router — turning #521 from dark into load-bearing. The USER ratified Open-Question-#2 (scar split shape) = **three origin files**.

## Routing Decision

Verbatim `route-decide.js` output (a data migration; the memory/scar tokens miss the stakes lexicon → `root`, as with the #519/#521 slices):

```json
{
  "task": "Phase-2 scar materialization: convert scars-graduate-candidates.md numbered list to ### SCAR-NN blocks, fix the live dup-24, split by origin into scars-toolkit/pact/embers.md, seed heat sidecars, wire a hot-scars pointer into MEMORY.md; verify with blocks --check-unique + verify-preserved",
  "recommendation": "root",
  "confidence": 0.4,
  "score_total": 0,
  "weights_version": "v1.1-context-aware-2026-05-07"
}
```

## HETS Spawn Plan

**N/A — single-perspective sufficient per route-decide `root`.** Per the USER's explicit choice, a focused **2-lens pre-build VERIFY board** ran against this plan (architect + code-reviewer, both read-only, firsthand-probed). Both returned **PROCEED-WITH-FOLDS**; folds are incorporated below and recorded in `## Pre-Approval Verification`.

## Runtime Probes

Firsthand-verified claims this plan rests on (probed 2026-07-07; the `#24` row CORRECTED by the VERIFY board):

| Claim | Probe → observed |
|---|---|
| Scars file has zero `### SCAR-NN` anchors (so #521 is dark) | `grep -c '^### ' scars-graduate-candidates.md` → **0** |
| The dup-24 is a LIVE data defect (not stale/dropped) | two `24.` list items: `slice.call` (L48) + `cwd-DRIFT` (L50) |
| Scars cross-reference each other BY NUMBER (renumber would break them) | cross-ref graph (board-built): SCAR-15→#11, 18→#16, 20→#18, 21→#20, 23→#20/#19, 24→#20/#23, 28→#22, 29→#20/#18/#11, 33→#29, **36→#16/#29/#33/#20/#23/#24/#3** — a full renumber breaks all of these; a global shared SCAR-NN space preserves them |
| The `#24` cross-ref (CORRECTED — the board's highest catch) | SCAR-36 (L74) DOES cite `#24`; it denotes the **slice.call** scar (L48, "Extends #20/#23 async-bot streak"), NOT cwd-DRIFT → so **slice.call MUST keep 24; cwd-DRIFT → 37** (the chosen direction, now for the correct reason) |
| Nothing cross-refs `#6` or `#8` (safe to fold 6 into SCAR-05 / keep 8 out-of-order) | grep: no `#6`/`#8` scar cross-ref (the `#439` in SCAR-11 is a PR, not scar-8) |
| Target filenames free | `ls scars-{toolkit,pact,embers}.md` → No such file (all 3 free) |
| No existing heat sidecar | `ls *.heat.json` in memory dir → none |
| References a split would break | `MEMORY.md:56` (topic pointer), `MEMORY.md:20` (re-scope line), `weight-gate-rfc-arc.md:198` (`[[scars-graduate-candidates]]` BARE wikilink — resolves to file, no anchor) |
| The migration touches ZERO repo code | all scar files live in `~/.claude/projects/<hash>/memory/`; `scripts/memory.js` reads them but hardcodes no scar filename |

**CLI-signature ground truth (board-probed firsthand — the plan's probes use these exact forms):**

- `memory verify-preserved --backup <f> --against "<a>,<b>,<c>"` — `--against` is **ONE comma-joined token** (`args.against.split(',')`), NOT space-separated. Space-separated silently audits only the first file.
- `memory blocks <file> --check-unique` — exists; exit **2** + `DUPLICATE anchors` on a shortAnchor collision; exit 0 + `all H3 anchors unique` otherwise. Does NOT print a count (run plain `blocks <file>` for the `N blocks (H3)` count).
- `memory heat <file> --bump <shortAnchor>` — key is `slugify(anchor)` verbatim (no `scar-` prefixing); a **bare number `33` writes a dead orphan key**, use `scar-33`. Creates `<file>.heat.json` on first bump. Bumps the **passed file's** sidecar only.
- `memory heat <file> --scored` — builds candidates from the file's BLOCKS, so it is **never empty** even fully unseeded (all 0-scored → alpha order). To prove seeding worked use `memory heat <file> --top 5` (filters to bumped+live anchors; legitimately empty pre-seed).
- **`memDir()` derives the root from `__dirname`**, not cwd → **run every `memory.js` command from the MAIN checkout** (`/Users/.../Documents/claude-toolkit`), or `export LOOM_MEMORY_DIR=~/.claude/projects/-Users-shashankchandrashekarmurigappa-Documents-claude-toolkit/memory`. Running from the `scar-mat` worktree computes a non-existent root and every probe errors "outside memory root".

## Anchor convention (board-resolved)

**Non-zero-padded**: `### SCAR-7`, `### SCAR-24`, `### SCAR-37` → shortAnchors `scar-7`, `scar-24`, `scar-37`. Chosen (over two-digit padding) to match the existing prose cross-refs (`#3`, `#7`, `#20`) and ease the deferred `#20 → [[…#scar-20]]` conversion. **Headings and every `[[…#scar-N]]` pointer MUST use this identical non-padded form** (`slugify('scar-7') !== slugify('scar-07')` — a mismatch is a silent dead pointer).

## Design decisions (VERIFY-board-confirmed)

**D1 — one GLOBAL SCAR-NN space across the 3 files, not per-file 1..N.** CONFIRMED (architect §1). Numbers stay globally unique (SCAR-1..SCAR-37), so by-number cross-refs keep resolving across files (SCAR-36 in `pact` → scar-16/29/33 in `toolkit`). Per-file renumbering would break every cross-ref. Index preamble carries the rule "next global number = max across all 3 files + 1" (F10).

**D2 — preserve existing numbers; the dup-24's SECOND item (`cwd-DRIFT`) → SCAR-37** (next free after 36). First 24 (`slice.call`) stays SCAR-24 — REQUIRED because SCAR-36's `#24` cross-ref denotes it (fold C). "5. + (6)" stays one block **SCAR-05** (no `#6` cross-ref). Out-of-order "8" keeps **SCAR-08**, placed in numeric order (anchors order-independent). Net: 1-37 minus 6 = 36 unique blocks.

**D3 — origin mapping** (36 scars; explicit "PACT arc" / "Embers" tags route; else toolkit). SCAR-37 (`cwd-DRIFT`) → **toolkit** (board F9: a toolkit-harness-general cwd discipline; low-stakes since D1 means a mis-file breaks no cross-ref):

| Origin | SCAR numbers | Count |
|---|---|---|
| **toolkit** | 1,2,3,4,5,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,28,29,30,33,34,35,37 | 28 |
| **pact** | 23, 24, 31, 32, 36 | 5 |
| **embers** | 25, 26, 27 | 3 |

**D4 — `scars-graduate-candidates.md` becomes a thin INDEX** (preamble + 3 pointers + the "next global number" note), NOT retired — preserves the well-known name + the `weight-gate-rfc-arc.md:198` bare wikilink. Grep the whole memory dir for ANCHORED refs (`scars-graduate-candidates#…`) before finalizing (F8): an anchored `#scar-20` would break (scar-20 moved to an origin file); a bare `[[scars-graduate-candidates]]` is fine.

**D5 — split MECHANISM = hand-authored verbatim block moves, gated by a SCRIPTED per-scar content check** (`verify-preserved` is the coarse first pass, not the real gate — fold B). `demote` can't perform the list→heading reshape (Phase 1) and would leave 36 `## Demoted` pointers, so it's not used here. Because there is **no PR review for this auto-memory migration**, the data-safety gate is explicit (Verification Probes #4b).

**D6 — hot-cache wiring = a CURATED ~5-item pointer block in `MEMORY.md`, not an auto-injector** (ADR-0018:129 = CLI human-invoked; auto-injector deferred). Seed each scar's heat into **its own origin file** (fold D): `heat scars-toolkit --bump scar-33`, `heat scars-embers --bump scar-27`, etc. Then prove with `heat <f> --top` (fold G), and hand-place the ~5 as `[[scars-<origin>#scar-N]]` pointers.

## Files To Modify

| Path | Store | Action | Risk | Notes |
|---|---|---|---|---|
| `…/memory/scars-graduate-candidates.md` | auto-memory | rewrite → thin index | **high** | source of truth; back up byte-identical FIRST |
| `…/memory/scars-toolkit.md` | auto-memory | create | med | 28 blocks + adapted header |
| `…/memory/scars-pact.md` | auto-memory | create | med | 5 blocks |
| `…/memory/scars-embers.md` | auto-memory | create | med | 3 blocks |
| `…/memory/scars-{toolkit,pact,embers}.md.heat.json` | auto-memory | create (seed) | low | via `heat --bump scar-N`; generated |
| `…/memory/MEMORY.md` | auto-memory | edit L56 + hot-scars block + L20 | med | back up first (no git); quantify byte delta (F7) |
| `packages/specs/plans/2026-07-07-scar-materialization.md` | **repo** | this plan | low | durable record |
| `docs/FORKS.md` | **repo** | FORK-2 ▶UPDATE | low | Phase-2 data branch resolved |

The auto-memory files are **not** a repo PR (the USER's memory store, curated in place). The repo PR = the plan + the FORKS ▶UPDATE only.

## Phases

> **All `memory.js` invocations run from the MAIN checkout** (`/Users/.../Documents/claude-toolkit`) or with `LOOM_MEMORY_DIR` exported — never the worktree (fold F).

#### Phase 1 — Backup + anchor (Risk: high — content integrity)
1. **Back up BOTH** `scars-graduate-candidates.md` → `…backup-2026-07-07.md` AND `MEMORY.md` → `MEMORY.backup-2026-07-07.md` (byte-identical; auto-memory has no git safety net — F11). Probe: `diff` each backup vs original → identical.
2. **Anchor in a working copy**: convert each `N. **title** body` → `### SCAR-N — <short title>` + body (non-padded), preserving every content line. Fix dup-24 (2nd → SCAR-37). Do NOT split yet.
   - Probe (fast feedback, F11): plain `memory blocks <working>` → `36 blocks (H3)`; then `memory blocks <working> --check-unique` → `all H3 anchors unique`, exit 0 (was 0 blocks).

#### Phase 2 — Split by origin (Risk: high)
3. **Author the 3 origin files** from the anchored working copy: each gets an adapted header + its assigned `### SCAR-N` blocks (D3), verbatim.
   - Probe: per file `memory blocks scars-<origin>` (counts sum to 28+5+3=36) + `--check-unique` (0 collisions each).
4. **Rewrite** `scars-graduate-candidates.md` → thin index (preamble + 3 pointers + "next number" note) — do this **before** verify-preserved so the preamble/`Related:` lines are accounted for (F6).
5. **Content-safety gate (the REAL gate — fold B):**
   - 5a. Coarse: `memory verify-preserved --backup <backup> --against "scars-toolkit.md,scars-pact.md,scars-embers.md,scars-graduate-candidates.md"` — **exit 2 with ~36 surfaced reshaped lines is EXPECTED** (whole-line match; the stripped `N.` marker + rewritten headers never match verbatim). Not a pass/fail by itself.
   - 5b. Real: a scripted per-scar check — for each backup scar, strip the leading `N.` list-marker (and `**…**` if needed) and confirm the exact remaining body text appears in **exactly one** origin file (a small node/grep loop over the 36). PASS = all 36 bodies present-and-unique; FAIL = any body absent or duplicated.
   - 5c. Cross-file uniqueness (F5): `grep -h '^### SCAR-' scars-{toolkit,pact,embers}.md | sort | uniq -d` → **empty**, AND the 3 per-file block counts sum to 36.

#### Phase 3 — Sidecar + router wiring (Risk: low)
6. **Seed heat** into each anchor's OWN origin file (fold D): `memory heat scars-<origin> --bump scar-N` for the ~5 freshest/load-bearing scars (e.g. `scar-33`,`scar-34`,`scar-35` in toolkit; `scar-36` in pact; `scar-27` in embers).
   - Probe (fold G): `memory heat scars-toolkit --top 5` → returns ONLY the bumped+live anchors (empty pre-seed, non-empty post-seed); `.heat.json` sidecars exist.
7. **Wire the router**: update `MEMORY.md:56` pointer → the index (which points to the 3 files); add a curated `Hot scars` block (~5 `[[scars-<origin>#scar-N]]` pointers, non-padded); refresh L20.
   - Probe: pointers resolve (`memory recall 'scars-toolkit#scar-33'` prints the block); `weight-gate-rfc-arc.md:198` `[[scars-graduate-candidates]]` still resolves.
   - Byte budget (F7): before/after `node scripts/memory.js check MEMORY.md --level 2`; quantify the delta. If the OVER-budget worsens, demote one compensating low-score block (the demote-by-score discipline — "Still planned" is the flagged candidate) so the ≤200-line ceiling this system enforces is not silently violated.

#### Phase 4 — Repo artifacts (Risk: low)
8. **FORK-2 ▶UPDATE** in `docs/FORKS.md`: Phase-2 data branch RESOLVED (materialized + split 28/5/3); note the dup-24-was-live correction (the 3rd decayed premise).
9. **Repo pre-push gate** on the worktree: `bash install.sh --hooks --test` + `node scripts/validate-doc-paths.js` + markdownlint (plan + FORKS are new/edited `.md`).

## Verification Probes

| # | Probe | Pass criterion |
|---|---|---|
| 1 | `diff` each backup vs original (scars + MEMORY.md) | byte-identical before any edit |
| 2 | plain `memory blocks scars-<origin>` ×3 | counts print; sum = 28+5+3 = 36 |
| 3 | `memory blocks scars-<origin> --check-unique` ×3 | exit 0 each; no per-file dup shortAnchors |
| 3b | `grep -h '^### SCAR-' scars-{toolkit,pact,embers}.md \| sort \| uniq -d` | **empty** (global union unique; scar-24 + scar-37 distinct) |
| 4a | `verify-preserved --backup … --against "<4 comma-joined files>"` | exit 2 + ~36 surfaced reshaped lines = EXPECTED (coarse pass) |
| 4b | **scripted per-scar content check (the real gate)** | all 36 scar bodies present in exactly one origin file; zero genuine drops |
| 5 | `memory heat scars-<origin> --top 5` post-seed | non-empty, only bumped+live anchors; `.heat.json` exists |
| 6 | `MEMORY.md` pointers + `weight-gate-rfc-arc.md:198` | index + hot-scars `[[…#scar-N]]` + bare wikilink all resolve |
| 7 | `memory check MEMORY.md --level 2` before/after | byte delta quantified; OVER-budget not worsened (or compensated by a demote) |
| 8 | repo gate | `install.sh --hooks --test` green; doc-paths clean; markdownlint 0 |

## Out of Scope (Deferred)

- **Automated MEMORY.md hot-set injector** — ADR-0018:129 frames the CLI as human-invoked; auto-injection is a separate open design question.
- **Deferred cross-file `memory check`** (ADR-0018:137) — gated on "a second curator / shared operating-memory".
- **Portability / `memory init` bootstrap** (FORK-2 Q2/Q3) — the separate branch; gated on "structure proven on the toolkit repo, then generalize to PACT + Embers".
- **Converting prose cross-refs (`#20`) to `[[…#scar-20]]` wikilinks** — content-preserving as-is; the non-padded anchors make this a clean later polish.
- **fork#3 (rule-vs-gated-recall)** — orthogonal lab trust-ceiling decision; does not gate this.

## Drift Notes

- **Drift-1**: the arc's **third decayed-premise** — "dup 24. was stale/dropped" (my MEMORY.md line) was a status-decay overclaim; the dup is a live data defect, exactly what `--check-unique` exists to catch. Reinforces the runtime-claim-probe discipline (already codified).
- **Drift-2**: route-decide returns `root` for memory-substrate data work (lexicon miss); the 3rd such case (#519/#521/this). The gate correctly says "no full team"; the user-chosen 2-lens VERIFY was the right altitude and caught 2 required + several should folds.
- **Drift-3**: a "split by origin" that reads as portability was correctly disambiguated by the honesty lens — partitioning THIS repo's mashed scars (Phase-2 data) is distinct from `memory init` (Q2/Q3 portability). Same word, different branch — the fork-ledger's value.
- **Drift-4 (VERIFY-caught)**: my "no `#24` cross-ref" Runtime Probe was itself a decayed claim — SCAR-36 cites `#24`. Both lenses caught it independently. A Runtime Probe is not exempt from being wrong; the board is the probe-of-the-probe.

## References / reuse (not modifying)

- `scripts/memory.js` — `blocks --check-unique`, `verify-preserved`, `heat --bump/--scored/--top`, `resolveFile`, `memDir` (the verify + move tools; unchanged).
- `packages/specs/adrs/0018-memory-architecture.md` — Phase-2 scope (`:76`), CLI-human-invoked (`:129`), deferred cross-file check (`:137`).
- `packages/specs/research/2026-07-05-memory-restructure-design.md:252-278` — Phase-2 exit criteria + Open-Question-#2 (split, ratified).
- `tasks/w6zge4ok8.output` — the 3-lens re-scope verdict this plan implements.

---

## Pre-Approval Verification (2026-07-07)

Two-lens VERIFY board (architect + code-reviewer, read-only, firsthand-probed the real CLI on `/tmp` copies — the live store was never mutated). Both: **PROCEED-WITH-FOLDS**. The core design (D1-D6) confirmed sound; every fold is a probe/mechanism correction, incorporated above.

**REQUIRED folds (reference-integrity + gate-correctness; no PR safety net):**
- **C / F1** (both lenses) — the "no `#24` cross-ref" probe was FALSE (SCAR-36 → #24 = slice.call); pinned slice.call=24, cwd-DRIFT=37 with the corrected reason. *Highest-value catch.*
- **B / F2** (both) — `verify-preserved` is whole-line, so ~36 reshaped scars surface as "missing" (exit 2 by design); added the scripted per-scar content check (Probe 4b) as the real data-safety gate.
- **A** (code-reviewer) — `--against "A,B,C"` is comma-joined ONE token, not space-separated (the space form silently audits only file A).
- **D / F3** (both) — seed each `heat --bump scar-N` into the anchor's OWN origin file; full anchor, not bare number.
- **E / F4** (both) — non-padded anchors (`scar-7`), headings + pointers identical (`slugify('scar-7')≠slugify('scar-07')`).
- **F** (code-reviewer) — `memDir()` keys off `__dirname`; run `memory.js` from the main checkout / `LOOM_MEMORY_DIR`, never the worktree.
- **G** (code-reviewer) — `heat --scored` never empty (weak check) → use `heat --top` to prove seeding.

**SHOULD folds (med):** F5 cross-file union mechanism (Probe 3b); F6 index-before-verify-preserved; F7 MEMORY.md byte-budget quantify-and-compensate.

**NITS (low):** F8 grep anchored refs + reconcile all MEMORY.md scar mentions; F9 SCAR-37→toolkit (28/5/3); F10 "next global number" note in the index; F11 MEMORY.md backup + Phase-1 fast-feedback count.

Full verdicts: `tasks/aa5e4d1d3f6ead153.output` (architect), `tasks/a238e8e4534ade32c.output` (code-reviewer).
