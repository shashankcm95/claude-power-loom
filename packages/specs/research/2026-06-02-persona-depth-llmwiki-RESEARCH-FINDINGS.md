---
date: 2026-06-02
lifecycle: persistent
topic: "Companion raw research findings (verified against primary sources) for 2026-06-02-persona-depth-llmwiki-v6-hybrid.md"
status: evidence-artifact (per honesty-auditor HA-1 — makes the synthesis's VERIFIED tags independently re-checkable)
---

# Companion — Raw Verified Research Findings

> These are the three independent web-research agent outputs from the `gstack-llmwiki-v6-hybrid-research` workflow, verbatim. Each agent was instructed to verify claims against PRIMARY sources (not the prior internal doc) and to flag anything unverifiable. The synthesis doc's `Finding N` / `Finding A` citations resolve here. Committed per honesty-auditor HA-1 so a downstream reviewer can re-check the borrow-level VERIFIED tags rather than trust them sight-unseen.

---

## Finding set 1 — gstack persona-DEPTH (verify-and-extract)

I now have everything. One important correction to flag: the prior doc claimed gstack's ARCHITECTURE.md *self-states* "No transaction boundaries or rollback… No isolation guarantees between sessions" as a direct quote — but two independent fetches of the live ARCHITECTURE.md find **no such verbatim statement**. The absence of containment is real and verifiable by what the doc *does* describe (in-process daemon state, no self-heal, no rollback mechanism anywhere), but the specific self-stated quote in the prior doc appears to be a paraphrase presented as a quotation. That's a meaningful honesty nuance to surface.

Here is the final report.

---

# gstack Verification + Persona-Depth Extraction

Independent verification of garrytan/gstack against live sources (fetched 2026-06-02), plus a depth-focused investigation of how its skills/personas are constructed internally.

## Section 1 — Verification Table

| # | Claim (from prior doc) | Verdict | Source | Note |
|---|---|---|---|---|
| 1 | "23 opinionated tools/skills" spanning CEO / Designer / Eng Manager / Release Manager / Doc Engineer / QA | **VERIFIED** (with caveat) | [repo description (GH API)](https://github.com/garrytan/gstack); [docs/skills.md](https://github.com/garrytan/gstack/blob/main/docs/skills.md) | Tagline says exactly "23 opinionated tools that serve as CEO, Designer, Eng Manager, Release Manager, Doc Engineer, and QA." **Caveat:** the *marketing count* is 23, but `docs/skills.md` now lists **50+ slash commands** (incl. iOS QA, `/health`, `/context-save`, `/benchmark-models`). "23" is a branding number, not a literal skill count. Roles all confirmed. |
| 2 | "~66K GitHub stars, MIT license" | **REFUTED (stale) / PARTIAL** | [GH API `repos/garrytan/gstack`](https://github.com/garrytan/gstack) | License = **MIT: VERIFIED.** Stars = **106,230** live (forks 15,812; pushed 2026-06-01). "~66K" was accurate at the prior doc's authoring (2026-06-01 frontmatter says ~66K "in weeks"; third-party traced 66K→89.7K→now 106K). The number is **understated by ~60%** today — flag as stale, not wrong-at-origin. |
| 3 | "Skills are Markdown, template-generated from commands.ts at build time" | **VERIFIED** | [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md); [CONTRIBUTING.md](https://raw.githubusercontent.com/garrytan/gstack/main/CONTRIBUTING.md) | Confirmed exactly: `SKILL.md.tmpl` (human prose + placeholders) → `gen-skill-docs.ts` (reads source metadata) → committed `SKILL.md`. Commands extracted from `browse/src/commands.ts` at build time. `gen-skill-docs.ts` confirmed present in `scripts/`. Skills are plain Markdown ("no proprietary runtime"). |
| 4 | "One real runtime is a persistent Chromium daemon for browser QA (CLI → Bun HTTP server → Chromium via CDP)" | **VERIFIED** | [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md) | Verbatim flow: "CLI (compiled binary) reads state file, POSTs /command to localhost:PORT → Server (`Bun.serve`) dispatches command, talks to Chromium → Chromium (headless)." CDP confirmed (`$B cdp <Domain.method>`, allowlist `browse/src/cdp-allowlist.ts`). First call ~3s, subsequent ~100–200ms. 30-min idle timeout. |
| 5 | "No transaction boundaries / no rollback / no isolation guarantees between sessions (self-stated in ARCHITECTURE.md)" | **PARTIALLY REFUTED** — claim true, attribution overstated | [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md) | The *substance* is correct (no rollback/transaction/isolation mechanism exists; state is in-process until daemon shutdown; "server doesn't try to self-heal… exits immediately" on Chromium disconnect; CLI auto-restarts). **But** two independent fetches find **no verbatim self-statement** "No transaction boundaries or rollback… No isolation guarantees between sessions." The prior doc presents a **paraphrase as a direct quote**. The absence is verifiable by what's *missing*, not by a confession in the doc. |
| 6 | "6-layer prompt-injection defense (datamarking → hidden-element strip → ONNX BERT → Haiku classifier → canary → ≥2-classifier ensemble)" | **VERIFIED** | [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md) | All six confirmed verbatim. L1–L3 content-security (datamarking, hidden-element strip, ARIA regex, URL blocklist, trust-boundary envelope); **L4** = 22MB BERT-small **ONNX** int8 (TestSavantAI), local/no-network; **L4b** = Claude Haiku transcript classifier; **L5** = canary token in system prompt; **L6** = ensemble, BLOCK needs 2 classifiers ≥ 0.75. Minor add: opt-in 721MB **DeBERTa-v3** ensemble (`GSTACK_SECURITY_ENSEMBLE=deberta`) — prior doc's "ONNX BERT" is correct for the default. |
| 7 | "/codex provides an OpenAI cross-vendor second opinion" | **VERIFIED** | [docs/skills.md](https://github.com/garrytan/gstack/blob/main/docs/skills.md) | "`/codex` — Second opinion from OpenAI Codex with cross-model analysis." Also `/benchmark-models` (Claude vs GPT vs Gemini) and `/plan-eng-review`'s "Outside Voice" dispatching to Codex. |
| 8 | "think → plan → build → review → test → ship → reflect lifecycle" | **VERIFIED** | [repo README](https://github.com/garrytan/gstack) | Reproduced verbatim: "Think → Plan → Build → Review → Test → Ship → Reflect." |
| 9 | "GBrain persistent memory (internals undocumented)" | **VERIFIED** | [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md); [docs/skills.md](https://github.com/garrytan/gstack/blob/main/docs/skills.md) | GBrain = "persistent knowledge base for AI agents," wired via `/setup-gbrain` + `/sync-gbrain`, surfaced in templates as `{{GBRAIN_CONTEXT_LOAD}}`/`{{GBRAIN_SAVE_RESULTS}}` placeholders. **Internals genuinely undocumented** — no persistence/indexing mechanism in ARCHITECTURE.md. "Undocumented" verdict confirmed. |

**Net on prior-doc accuracy:** the claim set holds up well. Two corrections worth carrying forward — (a) **star count is stale** (66K → 106K), and (b) the **"self-stated in ARCHITECTURE.md" framing for the no-transaction claim is an overstatement** — gstack doesn't confess the gap in those words; it's inferred from absence. The "23 tools" number is marketing, not a literal command count (50+ commands now exist).

---

## Section 2 — Persona-Depth Findings (the new angle)

The prior doc filed "more gstack roles" under low-priority **breadth** (C5). Ignoring breadth, the **depth** investigation finds gstack skills are far more internally engineered than "rich role brief" implies. The richest evidence is the `/plan-eng-review` SKILL.md, which is a **structured multi-section state machine**, not a prose persona.

### How a single gstack skill is constructed (evidence: `/plan-eng-review`)

Internal structure ([SKILL.md extraction](https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md)):

- **Pre-Review Setup**: Design-doc check (offers `/office-hours` if missing), GBrain context load, prior-learnings search with confidence calibration.
- **Sequential numbered sections, each an explicit gate**: Section 0 Scope Challenge → 1 Architecture → 2 Code Quality → 3 Test → 4 Performance. Each issue triggers **one `AskUserQuestion` per finding (never batched)**.
- **Embedded deterministic triggers**: "Complexity Smell" = 8+ files or 2+ new classes → **STOP before Section 1**, force scope-reduction question. "REGRESSION RULE (mandatory)" = a diff breaking existing behavior adds a regression test **with no AskUserQuestion — non-negotiable.**
- **Pre-emit confidence gate**: every finding carries a 1–10 confidence; **unverified findings are forced to confidence 4–5 and suppressed from the main report** unless they quote specific code lines.
- **Cognitive-pattern framework**: 15 named "engineering leadership instincts" (blast-radius, reversibility-preference, boring-by-default, systems-over-heroes…).
- **State/telemetry**: writes a **test-plan artifact to `~/.gstack/projects/`**, logs to `~/.gstack/analytics/skill-usage.jsonl`, maintains a Review Readiness Dashboard with **7-day staleness detection**.

This is the load-bearing observation: **a gstack skill is a structured review protocol with embedded forcing-functions and a self-honesty gate** — which is conceptually the same thing Power Loom's HETS personas + JSON contracts are reaching for, but gstack ships it as one generated artifact per role.

### Borrowable depth-elements

Each: what it is | evidence | HETS-lens mapping | borrow-worthiness.

1. **Doc-generated-from-source + CI freshness gate.** `commands.ts` → `.tmpl` → `gen-skill-docs.ts` → committed `SKILL.md` for **8 hosts from one source of truth**; CI runs `gen:skill-docs --dry-run` + `git diff --exit-code` and **fails on drift**. Skill-parser tests extract every `$B` command from generated bash blocks and validate against the registry. — *Evidence: [ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md), [CONTRIBUTING.md](https://raw.githubusercontent.com/garrytan/gstack/main/CONTRIBUTING.md).* — **Maps to:** Power Loom's persona ↔ `*.contract.json` reconciliation validator (the existing build-time enforcement layer); directly addresses the #183/#184 doc-drift class. — **Borrow-worthiness: HIGH** (this is prior-doc C3; the depth lens *strengthens* it — gstack proves the round-trip-test pattern, not just the dry-run). PL has the validator culture but generates *nothing* from the contracts today.

2. **Per-finding confidence gate with forced suppression.** A finding must quote the specific code lines motivating it; if it can't, it's **capped at confidence 4–5 and dropped from the main report.** — *Evidence: [SKILL.md extraction](https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md): "Pre-emit gate requires quoting specific code lines… unverified findings forced to confidence 4-5 (suppressed)."* — **Maps to:** the `code-reviewer` / `hacker` / `honesty-auditor` lenses **and** the prior doc's own **grounding sanitizer** (Part B1) — this is the *same idea gstack already ships at the prompt level*: a finding without a resolvable code citation is downgraded. — **Borrow-worthiness: HIGH.** It's independent corroboration that the v6 grounding-as-sanitizer design is the right shape, and gstack's "force to low-confidence + suppress" is a softer, advisory-compatible variant worth encoding in the verification-persona contracts (an honest-self-grade floor per finding).

3. **Cross-section "scout, never auto-apply" outside-voice.** `/plan-eng-review`'s "Outside Voice" dispatches to Codex (or a Claude subagent) for an independent plan challenge and **"never auto-incorporates findings without explicit user approval,"** surfacing each via its own AskUserQuestion. — *Evidence: [SKILL.md extraction](https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md).* — **Maps to:** the `architect`/`honesty-auditor` review tier, and exactly validates the prior doc's **"a finding is a scout, not a gate"** invariant (Part B2). — **Borrow-worthiness: HIGH** for the *discipline* (advisory + explicit-approval), **but note** PL must keep the dispatch in Runtime per ADR-0012 / Axiom 2 — gstack's skill embeds the LLM call inline, which PL's layer rules forbid. Borrow the *contract*, not the placement.

4. **Deterministic forcing-functions embedded in the role (Complexity Smell, Regression Rule).** Hard structural triggers — "8+ files → STOP and ask"; "broke existing behavior → mandatory regression test, no negotiation" — baked into the skill, not left to model judgment. — *Evidence: [SKILL.md extraction](https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md).* — **Maps to:** the `code-reviewer` lens + the **`stakes-decide.js`** classifier the prior doc proposes (Part C2): a deterministic "is this load-bearing?" trigger is the same genus as "8+ files → escalate." — **Borrow-worthiness: MED-HIGH.** The *pattern* (deterministic escalation thresholds encoded into the lens contract) is borrowable and reinforces C2; the specific thresholds are gstack-tuned and not directly portable.

5. **Lifecycle handoff via shared state artifacts (no copy-paste).** `/plan-eng-review` writes a test-plan artifact to `~/.gstack/projects/`; `/qa` **auto-picks-it-up**. `/plan-ceo-review` "feeds directly into `/plan-eng-review`." `/autoplan` chains CEO → Design → Eng. — *Evidence: [docs/skills.md](https://github.com/garrytan/gstack/blob/main/docs/skills.md), [SKILL.md extraction](https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md).* — **Maps to:** Power Loom's **transaction-record envelope** as the inter-persona handoff medium (one persona's frozen output feeds the next), and the prior doc's `verification` envelope field. — **Borrow-worthiness: MED.** The *concept* (typed artifact handoff between lenses, not free-text) aligns with PL's envelope philosophy and is borrowable; gstack's loose `~/.gstack/projects/` JSON has **no transaction/provenance guarantee** — PL would do this *better* through the record-store, so it's inspiration, not a mechanism to copy.

6. **Templated single-source persona generation (the depth-multiplier).** Every skill's auto-generated sections come from `.tmpl` + source metadata; jargon glossing is baked from a curated `scripts/jargon-list.json` ("repo list is the source of truth, no runtime loading"). One template fans out to 8 host formats. — *Evidence: [CONTRIBUTING.md](https://raw.githubusercontent.com/garrytan/gstack/main/CONTRIBUTING.md).* — **Maps to:** generating the deterministic *scaffolding* of a HETS persona (capability table, tool list, contract-derived audit checklist) from the `.contract.json`, leaving only the cognitive brief hand-written. — **Borrow-worthiness: MED.** High-leverage for keeping persona.md ↔ contract in lockstep, but PL's 16 personas are fewer and more bespoke than gstack's templated fleet — the ROI is lower than gstack's (which targets 8 hosts × 50 skills).

### Depth that is NOT borrowable (and why)

- **`/careful` `/freeze` `/guard` discipline.** Confirmed **prompt-level only** — `/freeze` "restricts file edits to single directory," `/guard` = careful+freeze, mechanism "opaque/absent" per the third-party analysis ([Augment](https://www.augmentcode.com/learn/garry-tan-gstack-claude-code)). **No** — this is precisely the gap Power Loom's *mechanism-based* containment (static `tools:` + K9/K14 + reconciliation validator) already closes deterministically. Borrowing prompt-level guards would be a regression. **(Borrow-worthiness: No.)**

- **The 6-layer browser prompt-injection stack (datamark → BERT → Haiku → canary → ensemble).** Genuinely sophisticated, but it defends a **browser-sidebar runtime** PL deliberately doesn't have (B5 REJECTED a browser gate; Axiom 1/3a determinism). **No** for the kernel. **One transferable atom:** the **datamarking / trust-boundary-envelope** idea (L1–L3 — "treat untrusted bytes as data, never instructions") is exactly the prior doc's **T2 reviewer-injection defense** for the cross-model delta. That single layer is borrowable into the Runtime cross-model producer; the rest serves a delivery/runtime org, not a verification lens. **(Borrow-worthiness: No for the stack; HIGH for the datamarking primitive specifically — already captured as T2.)**

- **Delivery-org roles (`/ship`, `/canary`, `/land-and-deploy`, `/design-*`, `/office-hours`).** These are *delivery-org* lenses (move a product forward), not *verification* lenses (interrogate a delta). **No** — this is breadth (prior doc C5), explicitly out of the depth scope. They don't deepen any HETS verification lens.

**The load-bearing distinction:** gstack's borrowable depth is everything that makes a *review protocol* rigorous and self-honest — **structured sections, per-finding grounded-confidence gates, deterministic escalation triggers, scout-not-gate outside-voice, and generate-docs-from-one-source-with-CI-freshness.** These improve a *verification lens*. Everything tied to the *browser runtime* or the *ship pipeline* serves a *delivery org* and is either already mechanized better by PL (containment, capability) or deliberately out of scope (browser, deploy). The single most actionable cross-cutting finding: **gstack independently arrived at "a finding must cite resolvable code lines or be suppressed" (item 2) and "outside-voice is a scout requiring explicit approval" (item 3) — direct external corroboration of the prior doc's grounding-sanitizer + scout-not-gate invariants.**

---

## Sources

- gstack repo + live metadata (GH API: 106,230 stars / 15,812 forks / MIT / pushed 2026-06-01) — <https://github.com/garrytan/gstack>
- gstack `ARCHITECTURE.md` (daemon flow, 6-layer injection defense, templating, no-self-heal) — <https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md>
- gstack `docs/skills.md` (full ~50-command inventory + role mapping + per-skill structure) — <https://github.com/garrytan/gstack/blob/main/docs/skills.md>
- gstack `plan-eng-review/SKILL.md` (internal section structure, confidence gate, forcing-functions, state artifacts) — <https://raw.githubusercontent.com/garrytan/gstack/main/plan-eng-review/SKILL.md>
- gstack `CONTRIBUTING.md` (commands.ts → .tmpl → gen-skill-docs pipeline, CI `--dry-run` freshness, 8-host gen, jargon source-of-truth) — <https://raw.githubusercontent.com/garrytan/gstack/main/CONTRIBUTING.md>
- Third-party analysis (skills are Markdown / no proprietary runtime; `/autoplan` chaining; star-count progression 66K→89.7K) — <https://www.augmentcode.com/learn/garry-tan-gstack-claude-code> and <https://www.augmentcode.com/learn/garry-tan-gstack-hits-89.7K-stars>
- Prior internal doc under verification — `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/research/2026-06-01-gstack-comparison-and-cross-model-review.md`

**Unverifiable / flagged:** GBrain internals (item 9 — genuinely undocumented, confirmed). The prior doc's "self-stated in ARCHITECTURE.md" attribution for the no-transaction claim (item 5) could not be located as a verbatim quote in two independent fetches — substance is true by absence, attribution is overstated.

---

## Finding set 2 — Karpathy llm-wiki → memory

I now have everything I need. The primary gist content came back as a structured summary (WebFetch ran a model over the rendered gist page), but it is detailed and internally consistent — I'll flag the one place where I cannot independently verify a verbatim quote. I have the full v6 axiom/four-class/§5a.1 text and the complete v3.5 memory RFC. Let me write the analysis.

I have all the inputs. Producing the final report now.

---

# LLM Wiki (Karpathy) → Power Loom Memory: A Mapping Analysis

**Sourcing note up front.** The primary gist was fetched, but GitHub rendered it through WebFetch's summarizer rather than returning raw markdown, so the gist content below is a *high-fidelity paraphrase with embedded quotes* — I mark each quote `(gist, via WebFetch)` and flag that I could not re-verify the verbatim wording byte-for-byte. Where the gist and blog agree, confidence is high. The Power Loom citations are read directly from the RFC source files (exact line numbers given) and are verbatim-grounded.

---

## (A) Pattern Description — what an "LLM wiki" IS (primary-sourced)

**Core definition.** An LLM wiki is *"a persistent, incrementally-maintained knowledge base that sits between raw source documents and the user"* (gist, via WebFetch). It is explicitly **not a product** — *"It's a workflow pattern"* (the blog phrases the same point; gist frames it as intentionally abstract). The load-bearing idea: synthesis is a *"persistent, compounding artifact"* (gist quote, via WebFetch) — knowledge accumulates into the wiki rather than being re-derived from raw sources on every query.

**Structure (three layers).** The gist describes a three-tier architecture:
1. **Raw sources** — immutable input documents (articles, papers, images). *"The LLM reads but never modifies them."*
2. **The wiki** — a directory of **LLM-generated markdown files**: summary pages, entity pages, concept pages, cross-references.
3. **The schema** — a configuration/behavioral-protocol document (the gist cites `CLAUDE.md` as the example) that defines wiki structure, conventions, and the maintenance workflow. The gist calls this the thing that *"makes the LLM a disciplined wiki maintainer rather than a generic chatbot"* (gist, via WebFetch).

Plus two **special files**: `index.md` (a content-oriented catalog by category) and `log.md` (an **append-only** chronological record of ingests, queries, and maintenance passes).

**Who authors.** The **LLM owns the wiki entirely.** The human's role is *"source, direction, ask good questions, think about meaning"*; the LLM's role is *"everything else"* (gist, via WebFetch). Humans curate the raw sources and ask questions; the model does all the bookkeeping.

**Write discipline.** Writes are triggered three ways: (1) ingesting a new source — *"The LLM reads the source, discusses key takeaways with you, writes a summary page in the wiki, updates the index, updates relevant entity and concept pages"*; (2) a good Q&A answer gets *filed as a new wiki page*; (3) periodic lint/health passes. Critically, the write step **updates existing pages in place** — *"updating entity pages, revising topic summaries, noting where new data contradicts old claims"* (gist quote, via WebFetch). **This is in-place mutation of synthesized pages** — a fact that becomes the central tension in the mapping below.

**Read/retrieval discipline.** The LLM consults the wiki **in-context**: read `index.md` first to locate relevant pages, then drill into full pages. At moderate scale (*"~100 sources, ~hundreds of pages"*) this deliberately **avoids embedding-based RAG** — plain file reads suffice. Hybrid BM25/vector search is offered as an *optional* add-on for larger wikis only.

**Curation / freshness.** Lint passes detect contradictions, stale claims superseded by newer sources, orphan pages, missing cross-references, and data gaps. Versioning is **git**: *"The wiki is just a git repo of markdown files. You get version history, branching, and collaboration for free"* (gist quote, via WebFetch).

**Problem it SOLVES:** the knowledge-rediscovery burden (synthesis compounds), the maintenance cost that makes humans abandon wikis (the LLM does the bookkeeping), and cross-document synthesis (connections are pre-made).

**Problem it does NOT solve (gist explicit):** large-scale retrieval over millions of tokens (*RAG is required there*), and initial **framing/conceptual bias** at ingestion (*lint catches structural issues but not conceptual bias*).

---

## (B) Blog-vs-Gist Discrepancies (the gist wins)

The mindstudio blog is **largely faithful but lossy** — it reframes the gist as a personal-notes / PKM (Notion-replacement) workflow and drops the gist's most load-bearing properties. Discrepancies:

| # | Blog claim | Gist position | Verdict |
|---|---|---|---|
| B1 | Frames the wiki as *"your personal notes and documents… instead of scattering knowledge across Notion, Google Docs, browser bookmarks"* | Gist frames it as a **synthesis layer over raw source documents** (papers/articles/images), authored by the LLM — not a re-home for pre-existing human notes | **Reframe / narrowing.** Blog imports a PKM angle the gist does not lead with. Not a contradiction, but a shift of emphasis. |
| B2 | *"The model doesn't care about your folder hierarchy or tags. It reads text."* | Gist makes **structure load-bearing**: `index.md`, entity/concept pages, cross-references, and a **schema file** are the whole point; the schema is *"what makes the LLM a disciplined wiki maintainer."* | **Contradiction (emphasis-level).** Blog downplays structure; gist elevates it. Gist wins — structure is the mechanism. |
| B3 | Centers the workflow on **Claude Code specifically** (*"launch Claude Code, ask it a question"*; lists Claude Code's read/search/write/shell affordances) | Gist is **tool-agnostic** — *"Your LLM can figure out the rest"*; CLAUDE.md is cited as *an example* schema, not a requirement | **Over-specification.** Blog binds the pattern to one vendor tool; gist treats the tool as substitutable. |
| B4 | Emphasizes the **append-only / compounding** nature weakly; foregrounds note templates (summary line, tags, timestamps, related-links) | Gist foregrounds **`log.md` as append-only** and the wiki as a **compounding artifact**, and explicitly names **in-place revision of synthesis pages** | **Omission.** Blog omits the append-only-log + compounding framing — which is exactly the property most relevant to Power Loom. Gist wins. |
| B5 | Scaling: *"up to a few hundred notes"* direct reading works; beyond that *"add a semantic search layer"* | Gist: *"~100 sources, ~hundreds of pages"*, RAG optional/larger-scale | **Consistent.** Minor numeric rounding; no conflict. |
| B6 | Does **not** mention the gist's explicit non-goals (framing bias; million-token retrieval) | Gist states both non-goals explicitly | **Omission** of the honest-limits section. Gist wins. |

**Net:** No hard factual contradiction, but the blog (a) re-skins the pattern as personal-notes/PKM, (b) under-weights structure and the schema file, (c) over-binds to Claude Code, and (d) drops the append-only-log + compounding-artifact framing and the non-goals. For our purposes the gist's **append-only `log.md` + in-place-revised synthesis pages + LLM-as-sole-author** is the load-bearing shape; the blog obscures it.

---

## (C) Mapping onto Power Loom Memory

### C.0 The fundamental alignment (and the fundamental clash)

Power Loom's memory is, at its core, **the same architectural instinct as the LLM wiki — but inverted on the mutability axis and hardened on the trust axis.**

- **Shared instinct (strong):** Both treat memory as *append-and-synthesize, not overwrite-and-forget*. The wiki's `log.md` is *"an append-only chronological record"* (gist); Power Loom's entire substrate is an **append-only WAL** where *"the chain — not any in-place file contents — is the source of truth"* and *"in-place mutation of canonical state is forbidden"* (A8, `v6-substrate-synthesis.md:426`). Both also separate **immutable raw inputs** from **derived synthesis**: the wiki's "raw sources (LLM never modifies)" maps almost exactly onto Power Loom's **Axiom-class** ("Irreducible, deterministic inputs… immutable," `:508`), and the wiki's synthesis pages map onto Power Loom's **derived/Theorem + Stochastic** layers.

- **Fundamental clash (load-bearing):** The wiki's synthesis pages are **mutated in place** — *"updating entity pages, revising topic summaries"* (gist). Power Loom **A8 categorically forbids exactly this** for canonical state. So the wiki, taken literally, is an **A8 violator**. The reconciliation (C.2) is that a wiki entry can only live in Power Loom as a **derived VIEW over the immutable chain**, never as a canonical record.

### C.1 Four-class placement of a "wiki entry"

Power Loom's four classes (`v6-substrate-synthesis.md:506-511`) are: **Axioms** (immutable inputs), **Deterministic Theorems** (pure re-derivable functions of axioms), **Stochastic Samples** (LLM-derived, *"never authoritative"*), **Attestations** (action witnesses, the chain itself). A wiki "entry" is not one class — it **decomposes by sub-part**, and getting this decomposition right is the whole answer:

| Wiki construct | Power Loom class | Why |
|---|---|---|
| **Raw source document** | **Axiom** | Immutable input the LLM "reads but never modifies" = *"Irreducible, deterministic inputs… immutable per A8"* (`:508`). Clean 1:1. |
| **`log.md` (append-only ingest/query/maintenance record)** | **Attestation** | *"Action witnesses; verifiable proofs that something happened"* (`:511`). The log of "ingested source X at T" is exactly an attestation; the WAL is Power Loom's `log.md`. Clean 1:1. |
| **The synthesis *content* of an entity/concept page** (the LLM's prose claims) | **Stochastic Sample** | LLM-authored re-rendering. Per `:510`, stochastic samples are *"re-derived on demand; never authoritative."* This is the critical placement: **a wiki entry's body text is a Stochastic Sample, NOT an Axiom and NOT an Attestation.** Reading it back as ground truth is precisely the category error §0a.3.1 and A10 exist to prevent. |
| **The wiki page *as a materialized artifact*** (index.md, the rendered entity page you read) | **Deterministic Theorem (derived view)** — *if and only if* it is a pure, re-derivable projection over the chain | Per `:509`, theorems are *"pure functions of axioms… recoverable trivially on miss (re-derive from axioms)."* A wiki page that is **re-derivable by replaying the chain** is a legitimate derived view (like the `endorsement-view projection` listed at `:509`). A wiki page that is **hand-edited and not re-derivable** is NOT a theorem — it has no clean class and is forbidden as canonical. |
| **Cross-reference / "contradicts" link the LLM notes** | **Stochastic Sample** (content) + **Attestation** (the fact it was emitted) | This is *exactly* the v3.5 RFC's **semantic causal edge**: an *"LLM-asserted… canonical CREATE record… start `candidate`, carry stochastic-content tagging"* (`v3.5 RFC:225-226`). The wiki's contradiction-notes ARE Power Loom's semantic edges, and inherit the same `assertion_class=stochastic_sample` / `faithfulness_status=unvalidated` discipline. |

**The load-bearing placement verdict:** A wiki entry is **NOT Axiom-class** (it is not a durable input — the human source is). It is **NOT a free-standing Attestation** (the *emission event* is, but the *content* is not). Its content is a **Stochastic Sample**; its materialized page form is a **Deterministic-Theorem-class derived VIEW** — admissible **only** if re-derivable from the chain. This is the single most important honest finding: **Power Loom would refuse to store a Karpathy wiki page as canonical memory** — it would store the *evidence and transitions* in the chain (Axioms + Attestations) and **re-derive the wiki page as a cache.**

### C.2 The A8 conflict and its cleanest reconciliation

**The conflict is real and direct.** The wiki is *"incrementally-maintained"* with *"updating entity pages, revising topic summaries"* (gist) — **curated-in-place mutation.** A8 (`:426`) forbids in-place mutation of canonical state; A8's *Forbids* clause is explicit: *"in-place edits to canonical persona-memory records; treating any single file's current bytes as authoritative"* (`:428`). §5a.1 reinforces with *"no bare UPDATE"* (`:916`) and spells out the cost of violating it: *"(a) break A8… (b) make concurrent readers see inconsistent states, (c) eliminate the audit-trail property (history can be rewritten by mutating an entry)"* (`:926`).

**Cleanest reconciliation — the wiki is a DERIVED VIEW, never canonical state.** The wiki's own choice of substrate hands us the bridge: it is *"just a git repo of markdown files"* (gist). Git is itself a content-addressed, append-only object store with a mutable HEAD pointer — structurally the same shape as Power Loom's chain-plus-Memory-Root-Pointer. The reconciliation maps the wiki's "in-place edit" onto Power Loom's **SUPERSEDE-as-sibling-write**:

1. **Every wiki "edit" becomes a SUPERSEDE transaction**, not a byte-rewrite. §5a.1: *"SUPERSEDE writes a sibling record and references the predecessor by content-hash"* (`:916`); *"The predecessor is still in the WAL (immutable per A8) but is no longer canonical"* (`:922`). "Revising a topic summary" = append a SUPERSEDE record whose `affected_records` points at the prior summary's `transaction_id`. History is preserved; the wiki page is just the **latest non-superseded projection**.
2. **The rendered wiki page is a re-derivable projection** — a Deterministic-Theorem-class derived view computed by chain-replay (`walkChain` skipping `superseded`/`tombstoned`, `:568`, `:939`), governed by the **§0a.3.1 Derived-View No-Amplification Clause**. The lifecycle-state machinery (`active`/`superseded`/`tombstoned`, `:930-939`) is *already* a derived-view projection in Power Loom — the wiki page is the same kind of object, one level up.
3. **Cache invalidation already has a primitive:** `DERIVED-VIEW-INVALIDATE` (`:924`, `:538`) is the signal that "the wiki page cache must be recomputed." The wiki's "lint pass found a contradiction → re-render the page" maps onto invalidate-then-recompute.

**Verdict:** Adopting the wiki **does NOT require violating A8 — provided the wiki is implemented as a projection/cache over the immutable chain, re-derivable, never canonical, with edits expressed as SUPERSEDE.** If instead one implements the wiki "literally" (hand-edited canonical markdown files as the source of truth), it **directly violates A8/§5a.1** and forfeits the audit-trail, replay-determinism, and concurrent-reader-consistency properties that are Power Loom's entire reason to exist. The wiki's git-repo framing makes the compliant path natural; the wiki's "LLM revises pages in place" framing makes the non-compliant path tempting. **Choose SUPERSEDE + projection.**

### C.3 Does llm-wiki help the OQ-27 read-side gap?

**This is the most valuable part of the mapping, because the wiki lands squarely on Power Loom's admitted weak spot.**

Power Loom's own RFC concedes the read-side is under-built. The v3.5 memory RFC repeatedly names **OQ-27 / OQ-B** — *"The read-side traversal algorithm (OQ-27 — v6's 'deepest under-specified concern')"* (`v3.5 RFC:294`), and *"K4 tri-signal ranker is the v3.0-alpha starting point and addresses neither"* (`:316`). MEMORY.md echoes this: *"the READ-SIDE (called OQ-27 / OQ-B) is the admitted UNDER-BUILT part ('where value lives')."*

**The wiki is a READ-SIDE / context-assembly pattern.** Its entire mechanism — *"reads `index.md` first to locate relevant pages, then drills into full pages"* — is precisely **context assembly / retrieval**, i.e., the OQ-27 problem. So:

- **Relevance verdict: YES, meaningfully relevant to OQ-27 — as a *retrieval strategy*, not as a storage model.** The wiki's "index-first, then drill, synthesis-compounds-so-you-read-less" is a concrete, RAG-free read-side discipline that Power Loom currently lacks below the v3.5 line. Power Loom already has the **write-side** locked (A8/A9/A10, the WAL, the four classes); the wiki contributes nothing new there (Power Loom is strictly more rigorous). Where the wiki contributes is **read-side context assembly**, which is exactly the hole.

- **Hybrid, not alternative, vs. the causal-graph vision.** They compose rather than compete, because they operate on different axes:
  - The **v3.5 causal-graph** answers *"what is connected to what, and is the connection trustworthy?"* — a **typed-edge traversal** with a hard trust gate (R3: edges that are `unvalidated`/`surface_overlap_only` are *"AUDIT-ONLY — invisible to read-side context-assembly"*, `v3.5 RFC:128-139`).
  - The **wiki** answers *"how do I assemble a readable, pre-synthesized context window cheaply without embeddings?"* — an **index-and-summary-page** navigation strategy.
  - **The clean composition:** the wiki's **`index.md` + per-page summaries become the OQ-27 traversal's *seed-and-rank surface*** (the RFC explicitly flags the seed policy as open: *"OQ-B… read-side seed + edge-walk policy — still open"*, `:316`), while the wiki's **synthesis pages become Deterministic-Theorem derived views** that the causal-graph edges point into. The causal graph supplies the **trust gating and typed relations** the wiki entirely lacks (the wiki "notes contradictions" with zero trust model); the wiki supplies the **cheap, human-legible, compounding navigation surface** the causal graph lacks. **Adopt the wiki as the OQ-27 read-side *projection layer*; keep the causal graph as the trust-gated edge substrate underneath it.** This is a genuine hybrid and arguably the most promising concrete shape OQ-27 has been offered.

  One honest caveat: the wiki's RAG-free "just read the index and pages" claim holds at the wiki's stated scale (*~100 sources / hundreds of pages*). Power Loom's persona-memory chain at maturity may exceed that, at which point the wiki's own escape hatch (optional BM25/vector layer) re-introduces the embedding infrastructure the pattern claimed to avoid — and Power Loom's **OQ-24 compaction** lever (`v3.5 RFC:307`) becomes the relevant scaling concern. So the wiki helps OQ-27 *at moderate scale*; it does not retire the retrieval-at-scale question.

### C.4 Borrow / Reject list

**BORROW (compatible with the axioms, fills real gaps):**

1. **`index.md` as the OQ-27 seed/navigation surface** — a content-oriented catalog that the read-side walker consults first. Directly addresses the open OQ-B seed-policy question; implementable as a Deterministic-Theorem derived view (re-derivable from the chain, so A8-clean). **Strongest borrow.**
2. **Per-entry summary lines / entity-and-concept pages as derived views** — pre-synthesized, *re-derivable* projections that reduce read-time token cost (the wiki's "compounding synthesis" benefit). Must be Theorem-class projections, not stored canonical (C.2).
3. **`log.md` ≡ the WAL framing** — validates Power Loom's existing attestation-log design; borrow the *human-legible chronological-log view* over the WAL as a debugging/audit surface (a derived view of the chain). Power Loom already has the substance; the wiki contributes the *legible presentation*.
4. **The "schema file" / behavioral protocol** — the gist's insight that a config doc is *"what makes the LLM a disciplined wiki maintainer."* This maps onto Power Loom's **persona contracts** (Axiom-class, `:508`). Borrow the *discipline framing*; Power Loom already has the mechanism (contracts are content-hashed + semver-versioned), and it is strictly stronger than a single CLAUDE.md.
5. **Lint-pass *as advisory (A3b) dream-cycle*** — the wiki's contradiction/stale/orphan detection maps onto the v3.5 RFC's **stochastic-manage dream cycles** (`v3.5 RFC:50-56`). Borrow it **strictly as advisory** (non-blocking, audit-logged), which is exactly how the RFC already slots `flag-conflict`/`near-dup merge`.

**REJECT (would violate the axioms):**

1. **In-place mutation of synthesis pages as canonical** — *"updating entity pages, revising topic summaries"* (gist) as byte-rewrites. **Rejected: violates A8** (`:426-428`) and §5a.1 "no bare UPDATE" (`:916`). Replace with SUPERSEDE-as-sibling + projection (C.2). Non-negotiable.
2. **LLM-authored wiki prose read back as fact** — the wiki treats the LLM's synthesis pages as the thing you consult and trust. **Rejected: violates the §0a.3.1 no-amplification clause** and the four-class discipline that Stochastic Samples are *"never authoritative"* (`:510`). The wiki *content* must stay Stochastic-Sample-tagged; only its *evidence-linked, re-derivable projection* is consumable, and even then it *"MUST NOT enter as input to any state transition that writes a kernel-canonical record"* and *"MUST NOT be propagated as instruction-text into peer LLM contexts"* (§0a.3.1, `:175`).
3. **Unevidenced entries** — the wiki lets the LLM "file a good Q&A answer as a new page" with no evidence requirement. **Rejected: violates A10** — *"Every memory transaction MUST carry non-empty `evidence_refs` to kernel-emitted records that exist in the chain"* (`:455`). A wiki write in Power Loom must carry `evidence_refs` (or one of the three bootstrap sentinels, `:461-467`); a free-floating LLM-authored page with no evidence link is rejected at K9 pre-commit.
4. **The wiki's "contradiction notes" used to *suppress or gate* without a trust model** — the wiki has lint flag contradictions but applies no faithfulness gate before *relying* on a link. **Rejected as-is: violates R3** of the v3.5 RFC (`:128`) — semantic edges must be `advisory_llm_checked`+ before they are *"traversal-eligible"*; `surface_overlap_only` edges are AUDIT-ONLY. Borrow the contradiction-*detection*; reject the *unconditional reliance*. (And note the v3.5 RFC's R2-note: a flagged contradiction *"MUST NOT remove either record from the OQ-27 walk"* without kernel authority, `:194` — the wiki has no equivalent guardrail, so it would enable exactly the "spurious contradiction buries a legitimate record" failure the RFC closes.)
5. **"The model doesn't care about structure, it just reads text"** (the *blog's* framing, B2) — **Rejected** as incompatible with Power Loom's class-precise, evidence-linked, schema-validated discipline. Power Loom's entire value is that structure (the chain, the four classes, the contracts) IS load-bearing. This is the blog's framing, not the gist's; the gist actually agrees with Power Loom that the schema/structure is the mechanism.

---

## Bottom line

The LLM wiki and Power Loom's memory share one deep instinct — **append-and-synthesize over an immutable raw layer** — and Power Loom is the strictly more rigorous, write-side-hardened expression of it (content-addressed chain, two-phase commit, evidence-linked admission, four-class trust discipline). The wiki contributes **nothing new to Power Loom's write side** (which is already locked and stronger) but lands **directly on Power Loom's admitted read-side gap (OQ-27)**: its `index.md`-first, summary-page, RAG-free navigation is a concrete, borrowable **read-side projection layer** that composes with — rather than replaces — the v3.5 typed-causal-graph (which supplies the trust gating the wiki entirely lacks). The single hard constraint: **a wiki entry must be a re-derivable DERIVED VIEW (Theorem-class) over the chain with edits expressed as SUPERSEDE — never canonical in-place-mutated state — or it violates A8, A10, and §0a.3.1.** Borrow the index/summary/log *projections* and the schema-discipline framing; reject in-place canonical mutation, unevidenced writes, and reading LLM-authored prose back as fact.

---

## SOURCES

- **PRIMARY (gist):** Andrej Karpathy, "LLM Wiki" — https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f — fetched via WebFetch. **Caveat:** GitHub returned the rendered page through WebFetch's summarizer, not raw markdown; quoted fragments marked "(gist, via WebFetch)" are faithfully reported but I could not re-verify them byte-for-byte against the raw `.md`. The structural claims (three-layer raw/wiki/schema, `index.md`/`log.md`, LLM-as-sole-author, in-place revision, git-repo versioning, the two non-goals) are internally consistent and corroborated by the secondary source.
- **SECONDARY (blog):** MindStudio, "Andrej Karpathy LLM Wiki Knowledge Base Claude Code" — https://www.mindstudio.ai/blog/andrej-karpathy-llm-wiki-knowledge-base-claude-code — fetched via WebFetch. Treated as secondary; discrepancies enumerated in (B), gist given precedence.
- **POWER LOOM (read directly, verbatim-grounded):**
  - `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/rfcs/v6-substrate-synthesis.md` — A8 (line 424-434), A9 (436-451), A10 (453-492), §4.1 Four-Class State (500-524), §0a.3.1 Derived-View No-Amplification Clause (169-187), §5a.1 no-bare-UPDATE + lifecycle states (914-941), §4.2 transaction-record shape (526-572).
  - `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/packages/specs/rfcs/2026-05-30-v3.5-memory-manage-causal-graph-DRAFT.md` — manage-as-transactions + det/stochastic split (§1, lines 48-63), R1-R4 security spine (§2, 80-152), typed causal-edge schema + semantic-vs-provenance (§4, 217-261), OQ-27/OQ-B read-side gap (§6-§8, 282-348).

**Distinctions honored:** "the gist says X" (paraphrased from the WebFetch render, quotes flagged) vs. "I infer X" (the four-class decomposition, the SUPERSEDE reconciliation, the wiki-as-OQ-27-seed hybrid, and all borrow/reject judgments are my inference, explicitly reasoned from the cited axiom text). No fabrication; the one verification limit (raw-markdown vs. rendered gist) is disclosed above rather than papered over.

---

## Finding set 3 — similar-sources sweep

Triangulation sweep complete. Nine systems verified against primary or strong secondary sources. None fabricated; one family (Devin "Knowledge") is partially UNVERIFIED on internals and flagged as such.

---

# Triangulation Sweep — Comparable Systems for Power Loom

**Frame:** Power Loom's memory is content-addressed, append-only, two-phase-commit, replay-canonical (A8: in-place mutation forbidden), with a four-class epistemics split (attestation vs stochastic content, etc.) and 16 verification personas. I rank every system by **borrowability for OUR substrate**, not by general quality. The existing `gstack` doc is a design-synthesis artifact about a *generation* layer — none of these overlap it; this sweep is genuinely additive on the **memory read/write side**.

## Ranked table (strongest borrow first)

| # | System | Family | Core pattern (2-3 sentences) | Borrowable for PL | Conflict with our model | Rating | Source |
|---|---|---|---|---|---|---|---|
| 1 | **Anthropic multi-agent research system** | Persona-depth + memory | Orchestrator-worker: lead agent plans, records plan **to memory before context fills**, spins 3-5 parallel subagents that **write findings to a shared filesystem and return a lightweight reference** (not chat-returns). Separate CitationAgent pass. | **Memory:** the "externalize early + return a reference, don't pass content through chat" pattern is *exactly* PL's append-to-store + envelope-reference design — strongest external validation that our shape is right; directly informs the under-built v3.5 read side (return refs, materialize on demand). **Persona:** the dedicated CitationAgent = a single-purpose grounding lens, mirrors PL's grounding-sanitizer-as-a-role idea. | Minimal. It's filesystem-as-scratchpad (mutable), not content-addressed/replayable — but it's a *generation* externalization, not a canonical-state claim, so no A8 collision. | **High** | [anthropic.com — multi-agent research](https://www.anthropic.com/engineering/built-multi-agent-research-system) |
| 2 | **Zep / Graphiti** | Temporal knowledge graph | Bi-temporal KG: every edge carries validity intervals; conflicting facts are **invalidated (t_invalid / t_expired) but NOT discarded** — old facts are preserved, superseded-not-deleted. Episode→semantic→community subgraph hierarchy. | **Memory:** the **invalidate-don't-delete** discipline is the single most aligned external pattern to A8 append-only — it shows how to represent "this fact is no longer current" *without mutation*, which is precisely what PL's v3.5 typed causal-edge graph needs. The **typed edge + bi-temporal validity** is a concrete schema to borrow for the causal-edge layer. **Persona:** n/a. | Low. Graphiti uses an LLM to extract entities/edges at write time — in PL that extracted content is **stochastic, not fact** (four-class split), so it would be an advisory producer feeding the graph, never a kernel write. As long as the *edge-validity mechanics* are borrowed and the *LLM extraction* is quarantined to Runtime-advisory, no conflict. | **High** | [arXiv 2501.13956](https://arxiv.org/abs/2501.13956) |
| 3 | **Anthropic native memory tool** | Agent memory (Anthropic) | Client-side `/memories` file dir; Claude does view/create/str_replace/insert/delete/rename. Files persist across sessions; content is **model-authored notes, explicitly not asserted as fact**. ZDR-eligible. Ships with hard security guidance. | **Memory:** validates file-as-memory + just-in-time retrieval. The **security guidance is directly liftable**: docs *mandate* path-traversal validation ("Your implementation **MUST** validate all paths") and note Claude "will usually refuse to write sensitive information... you may want to implement stricter validation that strips" it — maps onto PL's pre-egress scrubber + the four-class "model-authored ≠ fact" stance. | Medium. `str_replace` / `insert` / `delete` are **in-place mutation primitives** — the entire op-set assumes mutable canonical files. PL cannot adopt the *write semantics* (A8); it can adopt the *retrieval interface + security envelope* over an append-log that projects a current view. | **High** | [docs.claude.com — memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) |
| 4 | **MemGPT / Letta (+ sleeptime)** | Agent memory | OS-inspired tiers: core (in-context), recall (searchable history), archival (tool-queried cold store); agent self-edits memory via tools. **Sleeptime** = a background agent that reflects on context and writes **"learned context"** to shared memory blocks asynchronously. | **Memory:** the **sleeptime "derive learned context offline, write it as explicitly-learned-not-truth"** pattern maps cleanly onto PL's deferred **"manage" layer** (v3.5) — and Letta is explicit that this content is *derived insight, not ground truth*, which **agrees with our four-class split**. The background-consolidator-as-separate-actor is a borrowable shape for PL's background materializer. **Persona:** the primary/sleeptime split = a clean two-role separation. | Medium-High. Sleeptime "**can modify the memory blocks of the primary agent**" — in-place block mutation, an A8 violation if taken literally. PL must implement the *intent* (offline consolidation) as **append a new derived-record + supersede edge**, never an in-place block rewrite. Memory-blocks-as-mutable-RAM is the core architectural disagreement. | **Med-High** | [Letta — sleeptime docs](https://docs.letta.com/guides/agents/architectures/sleeptime/) |
| 5 | **Cline Memory Bank** | Curated-wiki / docs-as-memory | A **methodology, not a feature**: a hierarchy of markdown files (`projectbrief` → `productContext`/`systemPatterns`/`techContext` → `activeContext`/`progress`) the agent reloads at every session start to rebuild project understanding; committed to git. | **Memory:** the **typed-file hierarchy with a strict load order** is a concrete, zero-infra template for PL's read-side surface (which is under-built) — a deterministic "what to load and in what dependency order" is exactly the projection layer PL lacks. Git-committed = provenance-friendly. The Karpathy-beyond, repo-level knowledge-file pattern the prompt asked for. | Low-Medium. The agent **rewrites these files in place** (e.g. `activeContext.md` churns every session) — mutation as the normal mode. Borrow the **schema/ontology of file types**, not the rewrite-in-place lifecycle. Treats the files as authoritative project truth, which collides with the four-class split unless they're tagged by provenance class. | **Med** | [docs.cline.bot — Memory Bank](https://docs.cline.bot/features/memory-bank) |
| 6 | **Memory-poisoning research (MINJA / A-MemGuard / Christian Schneider)** | Safety / threat-model | Injected instructions written into agent memory **persist across sessions and execute weeks later** ("injection in February, damage in April"); 95%+ injection success in studies; detectors miss ~66% because entries look benign in isolation. Defense = trust-scored input, sanitize-before-persist, provenance tagging, trust-aware retrieval. | **Memory (defensive):** this is the **threat model PL must adopt for v3.5**. The recommended defenses — **"every memory entry should be traceable to a clearly defined and trustworthy source," separate data from instructions, sanitize before persist** — are nearly a restatement of PL's content-addressing + provenance + four-class split. Borrow the **trust-scored retrieval + temporal-decay** ideas for the read side, and use this to harden the manage-layer write path. | None — it's a constraint, not a system. It *confirms* PL's append-only-with-provenance bet is the safety-correct direction. | **High** (as a safety lens) | [christian-schneider.net — persistent memory poisoning](https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/); [arXiv 2503.03704 (MINJA)](https://arxiv.org/abs/2503.03704) |
| 7 | **Claude Code subagents + Skills** | Persona / subagent-depth | Subagents = isolated Claude instances, own 200K context + own tools + own system prompt, return only a summary (Task tool). Skills = full content injected into context at startup via `skills:` frontmatter; markdown+YAML agent defs with tool restrictions. | **Persona:** this is **PL's own substrate** — confirms the static-capability model (ADR-0012: tools come from the agent def, not runtime injection). Borrowable refinement: the **`skills:` "inject full content at startup"** mechanism is a cleaner way to load a persona's KB than PL's current approach; the isolated-context-returns-a-summary is the same containment shape PL formalizes. | None (it's the platform PL builds on). Note: subagent context is ephemeral/mutable scratch — PL's value-add is *persisting* the summary into the append-log, which the platform doesn't do. | **Med** (mostly confirmatory) | [code.claude.com — subagents](https://code.claude.com/docs/en/sub-agents) |
| 8 | **CrewAI (role/goal/backstory) vs AutoGen (conversational)** | Persona / subagent-depth | CrewAI: declarative **role + goal + backstory**, top-down orchestration, ~34% fewer tokens on structured tasks. AutoGen/AG2: agents converse in group chat, **emergent** coordination, better for open-ended reasoning. | **Persona:** CrewAI's **role/goal/backstory triple** is a borrowable, compact persona-contract schema — PL's 16 personas could expose a similar declarative surface. The CrewAI-vs-AutoGen axis maps onto a real PL design choice: PL's verification board is **deterministic/top-down (CrewAI-like)**, and the data says that's the cheaper, more reliable mode for structured verification — a point in favor of PL's orchestration style over emergent chat. | Medium (AutoGen specifically). **Emergent conversational coordination conflicts with determinism/replay (Axiom 1/A6)** — agents "converse until resolved" is non-deterministic and un-replayable. Borrow CrewAI's *declarative roles*; **reject AutoGen's emergent-chat coordination** for anything in the gating path. | **Med** | [agent.nexus — AutoGen vs CrewAI](https://agent.nexus/blog/autogen-vs-crewai) |
| 9 | **LangMem / LangGraph store** | Agent memory | SDK giving agents **semantic / episodic / procedural** memory; two modes — **hot-path tools** (agent calls during convo) and **background memory managers** (async extract/consolidate, resolve contradictions). Pluggable store backend. | **Memory:** the **three-type taxonomy (semantic/episodic/procedural)** is a useful ontology for classifying what PL's memory holds; the **hot-path-vs-background** split mirrors PL's "manage layer is deferred/background." Episodic-as-few-shot-examples is a borrowable idea for replaying past verification outcomes. | Medium. The **background manager "merges related facts and resolves contradictions"** by overwriting/consolidating — contradiction-resolution-by-mutation is an A8 conflict. PL must resolve contradictions by **append + supersede-edge** (the Zep way), not by the LangMem consolidate-in-place way. | **Med** | [langchain.com — LangMem SDK](https://www.langchain.com/blog/langmem-sdk-launch) |

### Excluded / UNVERIFIED
- **Mem0** — verified to exist (hybrid vector+graph+KV, LLM fact-extraction, parallel multi-store write with a history-log audit trail). Its **history-log/audit-trail** is mildly borrowable, but its **"LLM extracts facts → stored as memory"** core treats LLM output as fact (four-class violation) and is a **memory-poisoning surface** (untrusted extraction written to canonical store). The widely-cited **"26% better than OpenAI / outperforms by X%"** numbers are **vendor-published marketing** (Mem0's own blog) — flagged as unverified hype; do not cite as fact. Net: **Low borrowability**, included here as a caution rather than a row.
- **Cognition / Devin "Knowledge"** — **UNVERIFIED internals.** Confirmed it exists ("a collection of tips/docs/instructions Devin knows across sessions"; "treats the filesystem as memory without prompting") but Cognition publishes **no architecture** for how Knowledge is stored, deduped, or trust-scoped — all sources are blog-level product description. The "filesystem-as-memory" point corroborates the convergent signal below, but I cannot evaluate borrowability of the mechanism. **Excluded from the ranked rows; mentioned as a weak corroborating data point only.**

---

## Convergent signals across sources (what multiple independent systems agree on)

1. **Externalize memory out of the context window and pass references, not content.** Anthropic's own multi-agent system, the native memory tool, MemGPT/Letta tiers, Cline, and Devin **all independently** converge on "context window is volatile scratch; durable knowledge lives in external files/stores you retrieve on demand." This is the single strongest validation that **Power Loom's append-to-store-and-reference shape is the field consensus** — and it pinpoints that PL's gap is the *read/projection* side, not the store.

2. **Supersede, don't destroy — the leading temporal-memory designs preserve history.** Zep/Graphiti's **invalidate-don't-delete** (validity intervals, never discard) is the most principled external memory system, and it is *closer to PL's A8 append-only than to the mutate-in-place systems*. Where systems mutate (Letta blocks, LangMem consolidation, Cline files, memory tool `str_replace`), the temporal-KG camp shows the superior alternative is **append + mark-superseded**. PL is on the right side of this; Zep gives it the concrete edge-schema.

3. **Background/offline consolidation as a separate actor is an emerging standard.** Letta sleeptime, LangMem background managers, and Mem0's async pipeline all separate "do the task" from "reflect and consolidate memory later." This **directly validates PL's deferred v3.5 'manage' layer + background materializer** — and notably, Letta is explicit that the consolidated output is **"learned context, not ground truth,"** which independently agrees with PL's four-class epistemic split.

4. **Declarative, top-down roles beat emergent chat for structured/verification work.** CrewAI (role/goal/backstory, top-down, cheaper) vs AutoGen (emergent conversation) — with the structured-task efficiency data favoring the declarative model — supports PL's **deterministic verification-board** design over conversational agent swarms. PL's persona model is the right shape for a *gating* board.

5. **Provenance + "memory content is untrusted by default" is the security consensus.** The memory-poisoning literature (MINJA, A-MemGuard, Schneider) and Anthropic's own memory-tool guidance independently land on: **trace every entry to a trusted source, separate data from instructions, sanitize before persist.** This is a near-verbatim external endorsement of PL's content-addressing + four-class split, and it converts PL's safety posture from "a design opinion" into "the empirically-recommended defense."

---

## Cautions (hype vs substance; unsafe-on-our-substrate flags)

- **In-place mutation is the default everywhere except the temporal-KG camp.** Letta memory blocks, LangMem consolidation, Cline file rewrites, and the memory tool's `str_replace`/`insert`/`delete` all assume **mutable canonical state**. Adopting any of their *write semantics* verbatim breaks A8. Borrow their *interfaces/ontologies*; re-implement writes as append+supersede.
- **LLM-extracted content stored as memory is a four-class violation AND a poisoning surface.** Mem0 and Graphiti both extract entities/facts via LLM at write time. On PL that extraction is **stochastic, not fact** — it must be a Runtime-advisory producer feeding the graph through the four-class gate, never a kernel-trusted write. Treating extracted memory as fact is exactly the MINJA attack class (95%+ injection success; detectors miss ~66%).
- **Marketing numbers to quarantine.** Mem0's "26% better than OpenAI," its "+X% accuracy," and Zep's "94.8% vs 93.4% DMR / +18.5% LongMemEval / -90% latency" are **vendor-published benchmarks on self-selected evals.** Zep's are at least in a peer-reviewable arXiv paper (more credible); Mem0's are blog-only. Cite as *claimed*, never as established. The *architectural patterns* are the borrow — not the leaderboard.
- **AutoGen-style emergent coordination is unsafe in any gating path.** "Agents converse until resolved" is non-deterministic and un-replayable — a direct Axiom 1 / A6 conflict. Fine for generation/brainstorm; never for the verification board.
- **Devin "Knowledge" is a black box.** Corroborates the externalize-memory signal but publishes no mechanism — do not design against assumed internals.
- **The memory tool's mutation op-set is platform-native but A8-hostile.** Even Anthropic's own first-party memory primitive is mutate-in-place. PL deliberately diverges here; that divergence is the moat, but it means PL cannot just wrap the memory tool — it must project an append-log into the tool's view-interface.

---

## SOURCES

- Anthropic multi-agent research system — https://www.anthropic.com/engineering/built-multi-agent-research-system (+ secondary: https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent)
- Zep / Graphiti temporal KG — https://arxiv.org/abs/2501.13956 ; Graphiti overview https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
- Anthropic native memory tool — https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- MemGPT / Letta + sleeptime — https://docs.letta.com/guides/agents/architectures/sleeptime/ ; https://www.letta.com/blog/sleep-time-compute ; https://www.letta.com/blog/agent-memory
- Cline Memory Bank — https://docs.cline.bot/features/memory-bank
- Memory poisoning — https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/ ; MINJA https://arxiv.org/abs/2503.03704 ; A-MemGuard https://arxiv.org/pdf/2510.02373
- Claude Code subagents + Skills — https://code.claude.com/docs/en/sub-agents
- CrewAI vs AutoGen — https://agent.nexus/blog/autogen-vs-crewai
- LangMem / LangGraph — https://www.langchain.com/blog/langmem-sdk-launch
- Mem0 (caution, unverified benchmarks) — https://mem0.ai/blog/long-term-memory-ai-agents
- Cognition / Devin Knowledge (UNVERIFIED internals) — https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges

**Top-3 to fold into the v3.5 memory vision:** (1) **Zep's invalidate-don't-delete edge schema** for the typed causal-edge graph; (2) **Anthropic's externalize-and-reference + Cline's typed-file load-order** for the under-built read side; (3) **the memory-poisoning defense triad (provenance / sanitize-before-persist / trust-scored retrieval)** as the security contract for the manage layer. Letta sleeptime is the model for the background "manage" actor, with writes re-expressed as append+supersede.
