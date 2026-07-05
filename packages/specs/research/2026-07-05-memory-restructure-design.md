# Design: Session-Scoped, Hierarchical, Block-Addressable Memory (v2 of the memory system)

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
   `weight-gate-rfc-arc` **108 KB (~1,500 lines)**, `gin-lessons-ledger-design-arc` 38 KB, `phase-3.2-live-beta-arc`
   33 KB, `ghost-heartbeat-arc` 25 KB = **~179 KB (56 % of the whole memory system)**. Stale inline claims shadow fresh
   ones (`phase-3.2-live-beta-arc` opens with a "read this first, 3.2.4+ merged" CORRECTION because its body is stale).
3. **The scars file is a flat, un-scoped, un-addressable blob.** `scars-graduate-candidates.md` (33 KB) mixes
   Toolkit, PACT, and Embers scars with **no origin field**, has a **duplicate ID `#24`** (two distinct scars), no block
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

## 3. Target architecture — three tiers + a router

```
TIER 0  ROUTER      MEMORY.md            thin, ≤200 lines / ≤~18 KB, ALWAYS loaded (harness)
                                         → scope-partitioned pointers only, NO session prose
TIER 1  EPISODIC    library snapshots    per-session, per-workstream, time-scoped, verbatim
                    (already exist!)      → referenced BY the router, one pointer per live workstream
TIER 2  SEMANTIC    topic + scar files   durable, consolidated, block-addressable
                    + ~/.claude/rules     → invariants/canonical/scars/rules; reconcile-not-append
```

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

### 3.4 Consolidation — the missing discipline (episodic → semantic)

At **session-close / pre-compact** (a REFLECTION pass, not continuous): (1) write/append the session's **episodic**
snapshot (verbatim, Tier-1); (2) **consolidate** durable learnings into the **semantic** topic files —
**reconcile, don't append** (update/invalidate a stale rule; keep a `[[link]]` back to the originating episode for
provenance); (3) **roll the router** — update each workstream's one-line pointer, refresh the scar LRU cache, and demote
anything that fell out of the hot set to its topic file (the already-shipped demote-by-score policy, now *enforced* by
the helper in §4). This pass is what stops the accretion the prior design left unaddressed.

### 3.5 ARC-file decomposition (the 179 KB problem)

Each ARC → a **CHARTER** (the ratified design, immutable once merged, with a `#charter` anchor the router targets) +
per-wave **episodic snapshots** (dated, frozen after the wave). The router points to the charter + names the latest
wave. Version-lockdown: **freeze an ARC section after its wave merges** (no retroactive edits; new state → a new dated
block or a snapshot). This is the riskiest / largest surgery → **phased last, and optional** (§5).

## 4. Tooling — build the deferred helper (deterministic, human-in-the-loop)

The prior design's deferred `memory` helper, finally built as `scripts/memory.js` (mirrors `scan-stale-artifacts.js`):

- `memory check` — read `MEMORY.md`, report byte/line count vs the ≤200-line/≤18 KB ceiling + the **lowest-score
  demote-candidates** (recency+importance+relevance, section-inferred importance, invariant-protected). Deterministic;
  the curator confirms the move. Wired into the pre-compact hook + a `--check` for session-close.
- `memory recall '[[file#anchor]]'` — the **block resolver** (parse `[[file#anchor]]`, extract the `### anchor` block,
  bump its heat in the sidecar). This is the exact-pointer cold-fetch the USER asked for; it also unblocks the
  demote-to-topical pattern (currently a human convention with no resolver).
- `memory demote --id <slug>` — move a block to its topic file, leave the one-line pointer, re-check the budget.

No embeddings, no vector DB — the structured-linked file store is a consensus-valid modality (token-level retrieval) and
better for a curated, human-auditable substrate.

## 5. Migration plan — surgical, phased, data-preserving (move, never delete)

Each phase is a separate reviewable PR; nothing is deleted (content MOVES to a tier, git preserves history).

- **Phase 0 — tooling + doc (non-destructive).** Build `scripts/memory.js` (check/recall/demote + the `[[file#anchor]]`
  resolver). Write the memory-architecture doc + update `rules/core/self-improvement.md` with the tier model +
  consolidation discipline. Nothing in the memory dir moves yet. *Validates the mechanism before touching data.*
- **Phase 1 — de-mash the router (the USER's core ask).** Rewrite `MEMORY.md` into the ≤200-line scope-partitioned
  router (§3.1). MOVE each mashed workstream's START-HERE prose into its episodic file (reuse the latest library
  snapshot; add the `workstream:` tag). PACT's line becomes a pure pointer to `_SESSION-RESUME.md` (PACT owns its scope).
  *Verify: every claim in the old START-HERE is preserved in an episodic file the router points to (a diff-audit).*
- **Phase 2 — scar block-cache.** Add `### SCAR-NN` anchors; fix the dup #24; split by origin (toolkit/pact/embers);
  build the `scars-heat.json` LRU sidecar; wire the ~5-item hot-cache into the router. *Verify: every existing scar
  survives with a unique anchor; the origin split loses none.*
- **Phase 3 — ARC decomposition (optional / deferred).** Charter + wave-snapshots for the 108 KB weight-gate arc first
  (highest leverage), then the others. Version-lockdown convention. *Highest risk → do last, or defer if Phases 0-2
  suffice.* This one is a candidate to leave as a follow-up.

## 6. What this REUSES vs what's NEW

- **REUSE (unchanged, load-bearing — must not break):** the hot/warm/cold tiering; recency+importance+relevance scoring;
  hybrid summary-in-index + verbatim-in-store; **protect-invariant from staleness eviction**; demote-never-delete.
- **NEW (the gaps the prior design left):** session-scoping (episodic tier *wired* to the router); block-addressing +
  the LRU scar hot-cache with exact-pointer cold-fetch; the ≤200-line router ceiling as a forcing function; ARC
  decomposition + version-lockdown; the **episodic→semantic consolidation reflection pass**; the deterministic helper built.

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

## Citations

- MemGPT (virtual context mgmt): arxiv.org/abs/2310.08560 · Letta agent-memory (tiers, self-editing, memory blocks): letta.com/blog/agent-memory
- Generative Agents (recency+importance+relevance, reflection): arxiv.org/abs/2304.03442
- Anthropic effective context engineering (just-in-time, maximize-recall-first): anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic context editing + memory tool (evict-from-view, keep-full-history): platform.claude.com/docs/en/build-with-claude/context-editing
- Claude Code memory (≤200-line index, nav-hub-not-reference, lazy topic files): code.claude.com/docs (memory) + the auto-memory deep-dive
- "Episodic Memory is the Missing Piece for Long-Term LLM Agents" (episodic vs semantic, consolidation) · LangMem (reconcile-not-append)
- Prior in-repo design: `packages/specs/research/2026-06-25-tiered-memory-demotion-design.md`
