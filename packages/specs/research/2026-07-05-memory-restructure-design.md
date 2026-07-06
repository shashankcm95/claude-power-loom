# Design: Session-Scoped, Hierarchical, Block-Addressable Memory (v2 of the memory system)

> **Folded into [ADR-0018 — the canonical memory architecture](../adrs/0018-memory-architecture.md) (2026-07-06).**
> This is a superseded design note; its router / episodic / semantic tiers are Substrate 1 in the ADR. Per the
> supersede-not-fork discipline, a memory-design change supersedes that ADR, never this note. (Its Phases 0-2 remain the
> live migration checklist until complete.)

Status: DESIGN / proposal — awaiting USER approval before any migration. Supersedes the curation-policy half of
`2026-06-25-tiered-memory-demotion-design.md` (which shipped the demote-by-score *policy* but deferred session-scoping,
block-addressing, arc-size management, and the deterministic helper — the exact gaps this design closes).

Grounded in: a 6-agent recon of the live memory system (2026-07-05) + a web-research refresh (episodic/semantic
separation + the index/router ceiling) + the REUSED 2026-06-25 consensus (MemGPT/Letta tiers, Anthropic just-in-time,
Generative-Agents recency+importance+relevance, hybrid-not-binary). Author intent (USER, 2026-07-05): repo/workstream
session memory must be **distinct** and only **referenced hierarchically** from a thin `MEMORY.md`; sessions must not
mash; scars/references need a **caching mechanism** (cold-fetched from a dedicated file with **exact block pointers**,
LRU-like). "High chance of missing important data" → the migration is surgical + data-preserving (move, never delete).

## 1. Diagnosis — what is actually wrong (evidence)

The memory dir is **38 files / ~3,015 lines / ~319 KB**. Three structural failures, all confirmed against the files:

1. **`MEMORY.md` mashes concurrent workstreams.** The `## Current status — START HERE` block interleaves three
   *independent* streams — Toolkit (Gap-7/9 #514), PACT (P2 sigma-root #64), Phase-3.2 (spec-kitty#2137) — under bullet
   markers with **no scope headers**. A stale 2026-07-02 PACT claim sits three lines below a fresh 2026-07-05 toolkit
   claim; lineage is implicit and a reader must infer date→stream. This is the "mix of all session content" the USER named.
2. **Unbounded ARC accretion.** Four "arc" topic files are multi-month, multi-wave accretion logs with no version-lock:
   `weight-gate-rfc-arc` **108 KB (772 lines)**, `gin-lessons-ledger-design-arc` 38 KB, `phase-3.2-live-beta-arc`
   33 KB, `ghost-heartbeat-arc` 25 KB = **~179 KB (56 % of the whole memory system)**. Stale inline claims shadow fresh
   ones (`phase-3.2-live-beta-arc` opens with a "read this first, 3.2.4+ merged" CORRECTION because its body is stale).
3. **The scars file is a flat, un-scoped, un-addressable blob.** `scars-graduate-candidates.md` (33 KB) mixes
   Toolkit, PACT, and Embers scars with **no origin field**, has a **duplicate ID `24.`** (two list entries both numbered `24.`) (two distinct scars), no block
   anchors, and no cache: the router *claims* "freshest two stay in Current-status" but #34/#35 are omitted — the
   surface pointer already **skews** from the backing file. A toolkit `/self-improve` triage can't tell a PACT-method
   scar (#31/#32) from a toolkit rule.

Two deeper root causes the prior design missed:

- **The prior fix treated `MEMORY.md` as ONE hot blob.** It shipped the demote-by-score *policy* (in
  `rules/core/self-improvement.md` + the `pre-compact-save.js` SAVE_PROMPT) but never introduced **session-scoping**,
  **block-level addressing**, or **arc-size management**, and the deterministic `memory demote` helper was deferred and
  never built. Curation stayed manual + lossy-in-the-index (I just spent this session hand-trimming 20.2 KB → 17.1 KB).
- **Separation without consolidation just moves the mash.** PACT's `_SESSION-RESUME.md` — the model the USER likes —
  is *itself* **841 lines** of reverse-chron dated blocks (`latest-8`, `latest-7`, …). A per-repo resume file is
  necessary but **not sufficient**: without a periodic **episodic→semantic consolidation** pass, any session store
  accretes. The accretion, not the co-location, is the disease.

### What already exists (and is reusable)

- **The episodic tier is already there but disconnected.** `~/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/`
  holds **115+ per-session snapshots** (time-stamped, topic-tagged, hashed, `_catalog.json`) — genuinely session-distinct.
  They are written by the pre-compact SAVE_PROMPT but **nothing in `MEMORY.md` references them hierarchically**. They
  are an orphaned Tier-1.
- **`MEMORY.md` is loaded by the HARNESS, not toolkit code** (the pre-compact hook only *instructs* an update; the
  "compact to under 17.1 KB" reminder is a harness memory hook). `[[wikilinks]]` are a **human/agent convention with no
  resolver code**. Cold retrieval today is `library daybook` / `loom-recall` (partly deferred). So block-addressing +
  an LRU cache require *building a resolver* — there is none.

## 2. Research grounding (reuse + refresh; cited)

REUSED from the 2026-06-25 deep-research (unchanged consensus): OS-style hot/warm/cold tiering (MemGPT/Letta virtual
context mgmt); Anthropic "just-in-time" memory (keep identifiers in-context, load full data at runtime); maximize-recall-
first (aggressive summarization loses subtle context); hybrid summarize-*and*-archive (never lossy-only); recency +
importance + relevance scoring with **importance as the staleness-eviction protector** (Generative Agents).

REFRESHED (2026-07-05) on the new angles:

- **Episodic vs semantic is a HARD, time-scoped split.** Episodic = single-shot / instance-specific ("what happened in
  THIS session"); semantic = generalized, timestamp-stripped facts/rules. Frameworks keep them in **distinct stores**;
  consolidation runs as a **periodic REFLECTION pass** (end-of-session and/or importance-threshold), is **lossy-by-design**
  (abstract + generalize), and **reconciles — updates/invalidates — rather than appends** (LangMem; the "Episodic Memory
  is the Missing Piece for Long-Term LLM Agents" position paper; Generative Agents reflection).
- **The hot index has a HARD size ceiling.** Claude Code's official memory guidance: keep the root index **"small and
  stable… under 200 lines"** (20-80 small / 80-200 typical); it should be a **navigation hub that indexes detail files,
  explicitly NOT a comprehensive reference**. Auto-memory topic files are **truly lazy** (read on demand, cold); the
  index holds high-level state + constraints + decision-altering patterns, everything else behind pointers.
- **Block-addressing + LRU (from first principles + Letta "memory blocks"):** a memory *block* is an independently
  addressable unit (Letta's editable core-memory blocks). A stable anchor per block + a resolver gives exact-pointer
  retrieval; an **LRU hot-cache** keeps the N most-recently-referenced blocks inline and cold-fetches the rest on a miss.
  Pure LRU (recency only) is the simple form; **recency+importance+relevance** (already in our rules) is the richer form
  that *pins* high-importance blocks against eviction — the correct variant for scars (a load-bearing scar must not age out).

## 3. Target architecture — a router over episodic + two semantic sub-tiers

```
TIER 0  ROUTER      MEMORY.md            thin, ≤200 lines / ≤~18 KB, ALWAYS loaded (harness)
                                         → scope-partitioned pointers only; DEFERS phase status to docs/
TIER 1  EPISODIC    library snapshots    per-SESSION, per-workstream, time-scoped, verbatim
                    (already exist!)      → referenced BY the router; one pointer per live workstream
TIER 2a DURABLE     docs/ (PRD/phases/    per-PHASE, git-tracked, ANTI-DRIFT-looped ANCHOR — the single
        ANCHOR      ADRs) + specs/        source of truth for what/why/decisions/PHASE-status
TIER 2b LESSONS     topic + scar files    operating-discipline semantic memory; block-addressable;
                    + ~/.claude/rules     invariants/canonical/scars/rules; reconcile-not-append
```

The split of Tier 2 is the load-bearing fold (§3.6): the **durable anchor** (`docs/`) already exists per-repo with
its own **anti-drift loop**, and today FOUR surfaces each claim "where are we" (PRD §5, `docs/ROADMAP.md`,
`docs/phases/` status board, and MEMORY's START-HERE) — which is exactly how they drift. The redesign makes each
concern have ONE home and bridges them with ONE reflection loop.

### 3.1 TIER 0 — the ROUTER (`MEMORY.md`, ≤200 lines)

A thin navigation hub. It holds ONLY: (a) the canonical/invariant **pointers** (load-bearing, protected from eviction);
(b) a **per-workstream status router** — one line per live stream, each a pointer to that stream's latest episodic file;
(c) the **scar hot-cache** (LRU, §3.3); (d) the one-line topic-file index. It contains **no multi-line session prose**.

```markdown
## Workstreams (status = a POINTER to the latest episodic file, never inline prose)
- **Toolkit** → [[episodic/2026-07-05-gap7b-gap9]] — Gap-7B+Gap-9 SHIPPED #514; NEXT = Gap-8 review-loop
- **PACT** → PACT owns its scope (`~/Documents/PACT/_SESSION-RESUME.md`); latest: P2 sigma-root W1 #64
- **Phase-3.2** → [[phase-3.2-live-beta-arc#charter]] — LIVE-BETA; item-8 Part-B HELD
- **Embers** → [[gin-lessons-ledger-design-arc#charter]] — P0-P6 done; RESUME = OPERATOR/HARDEN
```

Each workstream is **one line**. Its detail lives in ONE episodic file; the router never inlines two streams' prose
together. This is the surgical de-mash.

### 3.2 TIER 1 — EPISODIC (reuse the library snapshots, wired hierarchically)

Do NOT invent a new store — the **115+ library session-snapshots already ARE the episodic tier**. The one change: wire
them **hierarchically from the router** (the per-workstream pointer in §3.1 targets the latest snapshot for that stream),
and add a **`workstream:` tag** to each snapshot's frontmatter so the router can resolve "latest Toolkit snapshot" vs
"latest Embers snapshot." Episodic files are **append-mostly, verbatim, time-scoped** — never trimmed (they are the cold
verbatim record; recall-first).

### 3.3 TIER 2 — SEMANTIC (block-addressable + the scar LRU cache)

The durable tier: invariant/canonical topic files, the rules, and the **scars file, re-shaped for block addressing**:

- **Stable block anchors.** Each scar becomes an anchored block: `### SCAR-33 — CodeRabbit false-green` (a heading is a
  stable markdown anchor). Referenced by **exact pointer** `[[scars-toolkit#scar-33]]`. Fix the duplicate `#24`
  (renumber to a unique id) and stop reusing numbers.
- **Split by ORIGIN.** Partition the scars file into `scars-toolkit.md` / `scars-pact.md` / `scars-embers.md` (or one
  file with a hard `origin:` field per block). A toolkit `/self-improve` triage then never sees PACT-method scars.
- **The LRU hot-cache (the USER's ask).** The router holds a bounded **hot-cache of ~5 scar one-liners** — the
  most-recently-**referenced** blocks — each a pointer `[[scars-toolkit#scar-NN]]`. On a miss, the block is **cold-fetched
  by anchor** (a `memory recall` resolver extracts the `### SCAR-NN` block). Eviction = **LRU**, but **importance pins**
  a graduate-candidate scar against eviction (the recency+importance protector). A tiny sidecar
  (`scars-heat.json`: `{scar-33: {last_ref: <iso>, refs: N}}`) tracks the heat; the cache = top-N by recency, minus pinned.

### 3.4 Consolidation — the missing discipline (episodic → semantic), folded to the anti-drift loop

Consolidation is a REFLECTION pass (not continuous), run at **two grains** that are the SAME loop (§3.6):

- **Session-close (every session, frequent):** (1) write the session's **episodic** snapshot (verbatim, Tier-1);
  (2) **consolidate** durable learnings into the Tier-2b **lessons** (scars/topic) — **reconcile, don't append**
  (update/invalidate a stale rule; keep a `[[link]]` back to the episode for provenance); (3) **roll the router** —
  update each workstream's one-line pointer, refresh the scar LRU cache, demote what fell out of the hot set (the
  demote-by-score policy, now *enforced* by the §4 helper).
- **Phase-close (at a phase boundary, coarse):** the EXISTING `/phase-close` reconciliation — the integrated phase vs
  the PRD exit criteria — updates the Tier-2a **durable anchor** (`docs/phases/` + `ROADMAP.md` + a dated accretion in
  `PRD §5` if reality diverged; record/fold an ADR).

The two grains are **one loop**: session consolidations *accumulate the evidence* that phase-close reconciles against
the anchor. So the episodic → lessons → durable-anchor chain is unbroken — nothing becomes a second source of truth,
and accretion is bounded at both grains (the gap the prior design left).

**Honest framing (2026-07-05 review board):** §3.4 is a curator-run DISCIPLINE, not an enforced mechanism. The ONLY
automatic forcing function is the router ceiling (`memory check` back-pressures the session-close roll); nothing detects
a session that writes an episodic snapshot but skips the Tier-2b consolidation, so the scar/topic files CAN re-accrete
(PACT `_SESSION-RESUME.md` reached 841 lines under exactly this gap). Minimal viable detector, deferred as YAGNI for a
single-curator system: a `memory check` over the episodic/scar files too (not just the router), mirroring
`scan-stale-artifacts.js`.

### 3.5 ARC-file decomposition (the 179 KB problem)

Each ARC → a **CHARTER** (the ratified design, immutable once merged, with a `#charter` anchor the router targets) +
per-wave **episodic snapshots** (dated, frozen after the wave). The router points to the charter + names the latest
wave. Version-lockdown: **freeze an ARC section after its wave merges** (no retroactive edits; new state → a new dated
block or a snapshot). This is the riskiest / largest surgery → **phased last, and optional** (§5).

### 3.6 Folding the `docs/` anchor + the anti-drift loop into the resume cycle (per-repo continuity)

Each repo (toolkit, PACT, Embers) now carries the **project-docs convention** — `docs/PRD.md` (anchor → north-star
RFC), `docs/phases/` (implementation hub + the 4-step anti-drift loop: Scope → Work → Close+reconcile → Re-evaluate),
`docs/ADRs/` (decisions, bridging `specs/adrs` + `rfcs` + `research`). The resume memory system must **defer to and
feed** this layer, not duplicate it — that is how continuity is preserved.

**One source of truth per concern (this ends the four-surfaces drift):**

| Concern | Home (single source of truth) | The router does |
|---|---|---|
| what / why / principles / phase-order | `docs/PRD.md` → north-star RFC | POINT (never duplicate) |
| PHASE status (durable, phase-grain) | `docs/ROADMAP.md` + `docs/phases/` | POINT (never inline the phase board) |
| decisions | `docs/ADRs/` + `specs/adrs` | POINT |
| SESSION status (operating, session-grain) | the router + Tier-1 episodic snapshots | HOLD (a thin per-workstream pointer) |
| lessons | Tier-2b scars/topic (block-addressable) | HOT-CACHE (LRU) + POINT |

**The router line resolves THROUGH `docs/`** — it carries the *session* grain and defers the *phase* grain:

```markdown
- **Toolkit** → phase [[docs/ROADMAP#current]] · session [[episodic/2026-07-05-gap7b-gap9]] · decisions [[docs/ADRs]]
```

**Per-repo wiring:** each repo's in-repo RESUME references ITS OWN `docs/` (toolkit RESUME → toolkit `docs/`; PACT's
`_SESSION-RESUME.md` → PACT `docs/` + `PACT-NORTH-STAR.md`; Embers RESUME → Embers `docs/phases/`). The toolkit
`MEMORY.md` router's per-workstream lines are the **cross-repo bridge** — one line per repo, each pointing at that
repo's RESUME + `docs/` anchor. Continuity is preserved because: (a) by CONVENTION the router holds only a session-grain pointer + verb, never phase-status words
(SHIPPED/RELEASED/HISTORICAL live in `docs/ROADMAP`), so it never restates a drifting slice of the phase board; (b) the session-close consolidation feeds the phase-close reconciliation that updates
the anchor; (c) every episodic snapshot links forward to the `docs/` phase it advanced, and a phase-close links back
to the episodes it integrated — a bidirectional provenance chain across the two grains.

**Honest framing (2026-07-05 review board):** (a) and (c) are DISCIPLINES, not enforced mechanisms — nothing yet
checks that a router line is pointer-only or that the forward/back links exist. The §3.1 example lines that carry
phase adjectives (`SHIPPED #514`, `LIVE-BETA`, `HELD`) are the ANTIPATTERN being removed; the enforced shape is the
§3.6 line (`phase [[docs/ROADMAP#current]] · session [[episodic/...]]`). A `memory check` warn on a phase-token in a
router line is a noted follow-up. Do not read the four-surfaces drift as eliminated by construction — it is reduced to
a convention plus the ceiling forcing function.

## 4. Tooling — build the deferred helper (deterministic, human-in-the-loop)

The prior design's deferred `memory` helper, built + hardened (2026-07-05 review board) as `scripts/memory.js`
(mirrors `scan-stale-artifacts.js`). AS-BUILT surface (all file args are WITHIN-ROOT contained — the kernel's
symlink-resolving `checkWithinRoot`; recall cannot read and demote cannot write outside the memory root):

- `memory check` — read `MEMORY.md`, report byte/line count vs the ≤200-line/≤18 KB ceiling + the **lowest-score
  demote-candidates** (importance-class THEN byte-size, section-inferred; invariant-protected). Deterministic;
  the curator confirms the move. Wired into the pre-compact hook + a `--check` for session-close.
- `memory recall '[[file#anchor]]'` — the **block resolver** (parse `[[file#anchor]]`, extract the `### anchor` block,
  bump its heat in the sidecar). This is the exact-pointer cold-fetch the USER asked for; it also unblocks the
  demote-to-topical pattern (currently a human convention with no resolver).
- `memory demote --file S --anchor A --to D [--level N]` — ATOMIC block MOVE (stage both files, temp-file + fsync +
  rename, roll the dest back on a src-write fault; a COLLISION guard refuses a duplicate anchor in dest). Leaves a
  one-line pointer; never deletes; never duplicates.
- `memory blocks <file> [--check-unique]` — list a file's blocks / assert every anchor is unique (Phase-2 gate).
- `memory verify-preserved --backup B --against f1,f2 [--section H]` — the Phase-1 data-safety GATE: assert every
  substantive line of the pre-migration source appears verbatim in the after-set; exit 2 (and name each unaccounted
  line) otherwise. This is the diff-audit, made runnable.
- Fence-aware parsing: a heading-shaped line inside a ``` code fence is content, not a block boundary.

No embeddings, no vector DB — the structured-linked file store is a consensus-valid modality (token-level retrieval) and
better for a curated, human-auditable substrate.

## 5. Migration plan — surgical, phased, data-preserving (move, never delete)

Each phase is a separate reviewable PR; nothing is deleted (content MOVES to a tier, git preserves history).

- **Phase 0 — tooling + doc (non-destructive).** Build `scripts/memory.js` (check/recall/demote + the `[[file#anchor]]`
  resolver). Write the memory-architecture doc + update `rules/core/self-improvement.md` with the tier model +
  consolidation discipline. Nothing in the memory dir moves yet. *Validates the mechanism before touching data.*
- **Phase 1 — de-mash the router + fold in `docs/` (the USER's core ask + the continuity fold, §3.6).** Rewrite
  `MEMORY.md` into the ≤200-line scope-partitioned router. Each per-workstream line resolves THROUGH the repo's
  `docs/` anchor — `phase [[docs/ROADMAP#current]] · session [[episodic/…]] · decisions [[docs/ADRs]]` — so the router
  holds the SESSION grain only and DEFERS the PHASE grain to `docs/` (ends the four-surfaces drift). MOVE each mashed
  workstream's START-HERE prose into its episodic file (reuse the latest library snapshot; add the `workstream:` tag);
  create the toolkit in-repo RESUME that links its episodic snapshots to `docs/phases/`. PACT's line becomes a pure
  pointer to `_SESSION-RESUME.md` + PACT `docs/`. Add the reciprocal wiring: each episodic snapshot links forward to
  the `docs/` phase it advanced; `docs/phases/` "Status at a glance" points back to the router (bidirectional
  provenance). *Verify (RUNNABLE gate, not prose): the byte-identical `memory-backup-2026-07-05/` is the rollback; run
  `memory verify-preserved --backup <pre-migration MEMORY.md> --against <episodic files> --section "Current status"`
  and resolve every surfaced line (reworded/intentionally-dropped is fine; a silent drop is NOT) before the PR merges.*
- **Phase 2 — scar block-cache.** Add `### SCAR-NN` anchors; fix the dup `24.`; split by origin (toolkit/pact/embers);
  build the `scars-heat.json` LRU sidecar; wire the ~5-item hot-cache into the router. *Verify: `memory blocks <scars-file> --check-unique` passes on each origin file (every anchor unique, the dup `24.`
  renumbered); `memory verify-preserved` accounts for every line across the split. Heat hygiene: `demote` drops the
  moved anchor's stale heat key and `heat` filters the hot-set to anchors that still resolve, so the cache never
  surfaces a dead pointer.*
- **Phase 3 — ARC decomposition (optional / deferred).** Charter + wave-snapshots for the 108 KB weight-gate arc first
  (highest leverage), then the others. Version-lockdown convention. *Highest risk → do last, or defer if Phases 0-2
  suffice.* This one is a candidate to leave as a follow-up.

## 6. What this REUSES vs what's NEW

- **REUSE (unchanged, load-bearing — must not break):** the hot/warm/cold tiering; recency+importance+relevance scoring;
  hybrid summary-in-index + verbatim-in-store; **protect-invariant from staleness eviction**; demote-never-delete.
- **NEW (the gaps the prior design left):** session-scoping (episodic tier *wired* to the router); block-addressing +
  the LRU scar hot-cache with exact-pointer cold-fetch; the ≤200-line router ceiling as a forcing function; ARC
  decomposition + version-lockdown; the **episodic→semantic consolidation reflection pass**; the deterministic helper built;
  and (§3.6) the **fold of the per-repo `docs/` anchor + its anti-drift loop into the resume cycle** — one source of
  truth per concern, the router deferring PHASE status to `docs/`, session-close consolidation feeding phase-close
  reconciliation (the continuity the USER asked to preserve).

## 7. Open questions (for the USER before build)

1. **Episodic home:** reuse the existing library session-snapshots wired to the router (recommended — 115+ already
   exist), or a new in-repo `.claude/RESUME.md` (PACT-style)? Trade-off: library = already-there + searchable but
   `~/.claude`-global; in-repo = git-visible + portable but a new store to maintain.
2. **Scar split:** three origin files (`scars-toolkit/pact/embers.md`) vs one file with an `origin:` field? (Recommended:
   split — clean triage scoping.)
3. **Automation depth:** ship the `memory` CLI (deterministic check/recall/demote), or keep it agent-driven with better
   conventions + the ceiling as the only forcing function? (Recommended: build the CLI — enforcement is the gap.)
4. **Scope of the first pass:** Phases 0-2 now (router + scars + tooling), defer Phase 3 (ARC decomposition)? (Recommended:
   yes — Phases 0-2 deliver the USER's asks; Phase 3 is the risky 179 KB surgery, best as a follow-up.)

## 8. Review-board verification (2026-07-05) — before Phase 1

A 4-lens read-only board (architect / code-reviewer / hacker / honesty-auditor) reviewed this plan and the Phase-0 CLI
before any live-memory surgery. Consensus: the **design direction is sound** (all four confirmed the diagnosis + the
3-tier model), but the **Phase-0 CLI had to be hardened before it runs over the live memory dir** — which is exactly the
USER's stated fear. Verdicts: architect `CLOSEABLE-WITH-NITS`; code-reviewer / hacker / honesty-auditor `NEEDS-REVISION`.
All blocking findings were resolved in the same session (tests s12-s19 lock each as a regression).

| # | Lens | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | hacker | CRITICAL | `demote` wrote dest BEFORE rewriting src -> a src-write fault DUPLICATES the block (inverts never-delete) | Two-phase atomic move: stage both, temp-file + fsync + rename, roll the dest back on a src fault (test s14) |
| 2 | hacker | HIGH | `resolveFile` had no containment -> recall READ / demote WRITE any file via `..`, absolute, or symlink-escape | Reuse the kernel `checkWithinRoot` (symlink-resolving CWE-22) + `isSafePathSegment` for bare slugs (test s13) |
| 3 | hacker | HIGH | symlink write-through on `--to` | Closed by the same containment gate (realpath rejects an escaping link) + rename-not-write on the final component |
| 4 | code-reviewer | HIGH | `parseBlocks` split on a `###`-shaped line inside a code fence -> block corruption | Fence-tracking in `parseBlocks` (test s12) |
| 5 | code-reviewer | HIGH | `demote` had no collision guard -> a duplicate anchor in dest is unreachable via recall | Refuse a colliding anchor before the move (test s15) |
| 6 | honesty-auditor + architect | HIGH | the Phase-1 "diff-audit" preservation promise was asserted, not tooled | Built `memory verify-preserved` (a runnable gate) + wired the byte-identical backup as rollback (test s18; §4/§5) |
| 7 | honesty-auditor | MEDIUM | figures off: weight-gate "~1,500 lines" (actual 772); `#24` token shape is a bare `24.` | Corrected in §1/§3.3/§5 (verified via `wc`); the "38 files" figure was CORRECT (the auditor's 37 was the miscount) |
| 8 | code-reviewer | MEDIUM | `check` line count off-by-one (trailing newline) | `countLines` = `wc -l` for newline-terminated files, logical count otherwise (test s16) |
| 9 | code-reviewer | MEDIUM | recall / blocks / heat wrappers untested | Coverage added (test s17) |
| 10 | architect | MEDIUM | §3.4 / §3.6 anti-drift claims are convention, not enforced mechanism | Reframed honestly in §3.4 / §3.6 (named as disciplines; the router ceiling is the only forcing function) |
| 11 | hacker LOW / architect NIT | LOW | slugify anchor collisions; heat sidecar orphan keys | `blocks --check-unique` (test s19); `demote` drops the moved anchor's heat key + `heat` filters to live anchors (test s22) |
| 12 | code-reviewer | LOW | `demote --to` into a missing parent dir threw a raw ENOENT | Clean `fail()` on a missing dest directory |

Not changed (accepted as-is): the LRU heat sidecar is warranted (35 churning scars, not ~5 — a static pin list would
not suffice); Phase 3 (ARC decomposition) stays deferred (highest-risk 179 KB surgery); the `memory` CLI reuses the
kernel path guard rather than re-rolling containment (DRY, already hardened for the #215 raw-segment trap).


### 8.1 VALIDATE board (2026-07-05) — adversarial re-probe of the BUILT hardening

The hardened CLI is a security + data-mutation change over the live memory dir, so a second board re-probed the
BUILT code (a green suite is a hypothesis, not proof). All three lenses FAIL-ed on the first hardening pass and found
real gaps the 19 tests could not see. All were fixed; tests s20-s24 (and strengthened s11/s16/s18) lock them.

| # | Lens | Severity | Finding (firsthand-probed) | Resolution |
|---|---|---|---|---|
| V1 | hacker | HIGH | heat-sidecar write-through: `bumpHeat`/`dropHeat` wrote a DERIVED path (`file+.heat.json`) never re-gated -> a symlinked sidecar clobbers a file outside root (the original attack I wrongly claimed closed) | `writeHeatSafe` lstat-refuses a symlinked sidecar + emits an observable stderr refusal (test re-probed CLOSED) |
| V2 | hacker | HIGH | TOCTOU: `resolveFile` canonicalizes at check-time, the read/write follows the path STRING later (CWE-367) | `withinRootPlain` adds a final-component symlink refusal (closes the pre-planted symlink); the pure timing-race by a local in-root writer is a DOCUMENTED residual (that writer can corrupt memory directly) |
| V3 | code-reviewer | HIGH | sequential-demote pointer absorption: the in-place pointer is absorbed into the PRECEDING block's body; a later demote carries it into a third file (corrupts recall; Phase 1 does sequential demotes) | pointers now go to a dedicated `## Demoted` section, a hard boundary no sibling block can absorb (test s20) |
| V4 | honesty + code-reviewer | HIGH | `verify-preserved` over-claimed: a >12-char filter silently skipped terse lines (`K3 dropped`) and `.includes()` substring-matched | shape-based filter (>=3 chars, not length) + WHOLE-LINE set membership; honest docstring on what it does/does not guarantee (tests s18, s24) |
| V5 | hacker | MEDIUM | the first dest-write sat OUTSIDE the rollback try/catch -> a leftover `.tmp` (EEXIST) crashed with a raw stack | wrap the dest-write in a clean `fail()`; `atomicWrite` unlinks a stale temp and retries once (still `wx`, never follows) |
| V6 | hacker | MEDIUM | "never duplicate" was FALSE on a double I/O fault (loud reconcile, block in both files) | corrected the docstring/comments to "never duplicate SILENTLY; a rare double-fault is reported loudly for manual reconcile" |
| V7 | honesty | HIGH | s14 tested only the new-dest (unlink) rollback, not the restore-existing-dest branch | added s21 (pre-populated dest, forced src fault, asserts dest restored to original bytes) |
| V8 | honesty | MEDIUM | `check` ranking claimed recency+importance+relevance but implements importance+bytes | corrected the scoring comment + §4 to "importance-class then byte-size" |
| V9 | honesty | LOW | §8 row 8/11 + "matches wc -l" over-cited / over-claimed | corrected rows 8/11 above; s16 renamed to the conditional claim |
| V10 | code-reviewer | LOW | an indented (4+ space) fence could swallow a following heading (no live file triggers it) | fence regex restricted to CommonMark's 0-3 leading spaces |
| V11 | hacker | LOW | `demote --to MEMORY.md` appends INTO the hot index (in-root, not an escape) | refuse unless `--force` (test s23) |

Residual, documented (not closed): the pure check->use TOCTOU timing race (V2) by a concurrent local writer already
inside the memory root. Accepted for a single-user, human-in-the-loop curation CLI — such a writer can corrupt the
memory directly, so the race grants no additional capability. The lstat-reject closes the realistic pre-planted case.


## Citations

- MemGPT (virtual context mgmt): arxiv.org/abs/2310.08560 · Letta agent-memory (tiers, self-editing, memory blocks): letta.com/blog/agent-memory
- Generative Agents (recency+importance+relevance, reflection): arxiv.org/abs/2304.03442
- Anthropic effective context engineering (just-in-time, maximize-recall-first): anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic context editing + memory tool (evict-from-view, keep-full-history): platform.claude.com/docs/en/build-with-claude/context-editing
- Claude Code memory (≤200-line index, nav-hub-not-reference, lazy topic files): code.claude.com/docs (memory) + the auto-memory deep-dive
- "Episodic Memory is the Missing Piece for Long-Term LLM Agents" (episodic vs semantic, consolidation) · LangMem (reconcile-not-append)
- Prior in-repo design: `packages/specs/research/2026-06-25-tiered-memory-demotion-design.md`
