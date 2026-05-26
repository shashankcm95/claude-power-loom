# Source Log

Tracks sources processed during KB authoring. Each source tagged with quality tier; tier influences how its citations weight in authored docs.

## Quality tiers

| Tier | Description | Authority weight | Examples |
|------|-------------|-----------------|----------|
| **1** | Canonical industry texts | Direct authority — cited in authored docs | Designing Data-Intensive Applications (Kleppmann); Clean Architecture (Martin); A Philosophy of Software Design (Ousterhout); Domain-Driven Design (Evans); Software Architecture: The Hard Parts (Ford / Richards / Sadalage / Dehghani); Code Complete (McConnell); The Pragmatic Programmer (Thomas / Hunt) |
| **2** | Respected modern guides | Direct authority for newer / specialized topics | Microservices Patterns (Richardson); Building Evolutionary Architectures (Ford / Parsons / Kua); Refactoring (Fowler); Patterns of Enterprise Application Architecture (Fowler); framework-authoritative documentation (PostgreSQL docs, AWS architecture guidance, etc.) |
| **3** | Community curated | Consensus signal only — not cited as authority | High-traffic GitHub awesome-lists; well-maintained learning-notes repositories (e.g., keyvanakbary/learning-notes); curated dev-resource indices |
| **4** | Trend-aware | Signal but not authority | Blog posts, Medium articles, Stack Overflow accepted answers — useful for spotting emerging patterns or modern interpretations, but not citable in authored docs |

## Tier weighting rules

- **Tier 1** + **Tier 2** count toward both **consensus detection** AND **direct citation** in authored docs
- **Tier 3** + **Tier 4** count toward **consensus detection only** — they help confirm a pattern is recognized but their content does not carry authority
- A pattern needs at least 2 Tier-1+2 source citations to ship as an authored doc
- A Tier-3+4-only pattern can be noted but cannot ship without a Tier-1+2 anchor

## Sources processed

| Date | Source | Tier | URL/path | Sections covered | Notes |
|------|--------|------|----------|------------------|-------|
| 2026-05-08 | charlax/professional-programming/antipatterns | 3 (high end) | github.com/charlax/professional-programming/tree/master/antipatterns | code, error-handling, mvcs, tests, scalability, database (skipped sqlalchemy: lang-specific) | Original synthesis; ~15 patterns extracted; cites DDD/Fowler/ESR internally. Good for `discipline/` slot. |
| 2026-05-08 | charlax/professional-programming/cheatsheets | 1 (PDFs) | github.com/charlax/professional-programming/tree/master/cheatsheets | Clean-Architecture-V1.0.pdf, Clean-Code-V2.4.pdf | Tier-1 PDFs deferred to focused authoring sessions; 596KB+589KB. Surgical chapter reads when authoring. |
| 2026-05-08 | DevBooks/data | 3 (catalog) | github.com/devtoolsd/DevBooks/tree/main/data | architecture, databases, distributed-systems, system-design, software-engineering, testing, security, devops, computer-science, data-engineering, functional-programming, frontend, monitoring, mobile, apis | Catalog of paywalled book recommendations. Validates Tier-1 source list. Added 5 candidates: Release It!, Working Effectively w/ Legacy Code, SE@Google, Threat Modeling, Implementing DDD. |
| 2026-05-08 | EbookFoundation/free-programming-books | 3 (catalog) | github.com/EbookFoundation/free-programming-books/tree/main/books | subjects.md (Software Architecture, Database, Algorithms, OOP, Operating Systems, Professional Development, Programming Paradigms, Security, Prompt Engineering, Computer Science) | Catalog of FREE books. Surfaces 5-7 free Tier-1+2 candidates: Fielding's REST dissertation, Building Secure & Reliable Systems (Google), OSTEP, Tao of Unix Programming, DDD Reference (free Evans), Architectural Metapatterns. |
| 2026-05-08 | manjunath5496/Computer-Science-Reference-Books | 3 (PDF catalog) | github.com/manjunath5496/Computer-Science-Reference-Books | 501 PDFs; filtered to Tier-1 candidates: Refactoring, Clean Code, TDD-by-Beck, Mythical Man-Month, Java Concurrency in Practice, Programming Pearls, AIMA, Effective Java, Site Reliability Workbook | Goldmine for chapter-level surgical reads at authoring time; missing modern canon (no DDIA/Clean Arch/Ousterhout/Hard Parts). 2000-2015-era collection. |
| 2026-05-08 | ahmedhammad97/Designing-Data-Intensive-Applications-Notes | 3 (notes on T1) | github.com/ahmedhammad97/Designing-Data-Intensive-Applications-Notes | All 12 chapters; 80KB | DDIA full chapter notes. Tier-1-quality content via Tier-3 channel. Feeds essentially all `data/*/` slots. |
| 2026-05-08 | ahmedhammad97/Clean-Code-Do-And-Dont | 3 (notes on T1) | github.com/ahmedhammad97/Clean-Code-Do-And-Dont | ~100 concrete rules; 5KB | Compact distillation of Clean Code. Good for `discipline/clean-code-essentials.md`. |
| 2026-05-08 | ahmedhammad97/Software-Architecture-Patterns-Notes | 3 (notes on Mark Richards' free O'Reilly report) | github.com/ahmedhammad97/Software-Architecture-Patterns-Notes | 5 patterns: Layered, Event-driven (Mediator+Broker), Microkernel, Microservices, Space-based; 9KB | Fills NEW `architecture-styles/` branch directly. Sink-hole anti-pattern named. |
| 2026-05-08 | ahmedhammad97/Principles-of-Package-Design-Reading-Notes | 3 (notes on T1) | github.com/ahmedhammad97/Principles-of-Package-Design-Reading-Notes | SOLID + 6 package principles + I-metric + A-metric; 16KB | Most actionable source. Feeds 6+ new `crosscut/` package-design slots. Quantitative metrics rare in our other sources. |
| 2026-05-08 | pkardas/notes/books | 3 (notes on T1, multi-book) | github.com/pkardas/notes/tree/master/books | DDIA (67KB), DDD (31KB), Refactoring (35KB), Release It! (67KB), Pragmatic Programmer (42KB), Fundamentals of Architecture (78KB!), Clean Code (15KB), Code Complete (23KB), Hands-On ML (5KB), Tidy First (9KB), Clean Agile (39KB), Peopleware (35KB) | The mother lode. Covers 7+ of our 14 foundation books in distilled form. |
| 2026-05-08 | aza0092/Clean-Code-Notes | 3 (notes on T1) | github.com/aza0092/Clean-Code-Notes | Clean Code (Martin), 39KB | Supplementary to Clean Code Do/Don't. |
| 2026-05-08 | aza0092/Clean-Architecture-Notes | 3 (notes on T1) | github.com/aza0092/Clean-Architecture-Notes | Clean Architecture (Martin), 33KB | Fills the Clean Architecture gap. |
| 2026-05-08 | alysivji/notes/software-engineering/philosophy_of_software_design.md | 3 (notes on T1) | github.com/alysivji/notes/blob/main/software-engineering/philosophy_of_software_design.md | All 20 chapters of A Philosophy of Software Design (Ousterhout); 807 lines | EXCELLENT — model of distilled-pattern shape. Fills the Ousterhout gap (the Tier-1 counterpoint to Clean Code). |
| 2026-05-08 | danlebrero blog: Hard Parts summary | 3 (blog summary of T1) | danlebrero.com/2022/03/30/software-architecture-the-hard-parts-book-summary/ | All 15 chapters of Software Architecture: The Hard Parts | Captures named taxonomies: Architecture Quantum, Static/Dynamic Coupling, Tactical Forking, 7 Saga types (Epic, Phone Tag, Fairy Tale, Fantasy Fiction, Horror Story, Parallel, Anthology), Data Disintegrators vs Integrators, Granularity Disintegrators vs Integrators. |
| 2026-05-08 | serodriguez68/designing-ml-systems-summary | 3 (notes on T1) | github.com/serodriguez68/designing-ml-systems-summary | 11 chapter files (~230KB total): overview, project objectives, data engineering, training data, feature engineering, model dev/eval, deployment, distribution shifts/monitoring, continual learning, MLOps infra, human side | Comprehensive. Feeds NEW `ai-systems/` branch (drift detection, training-serving skew, MLOps). |
| 2026-05-08 | softwarephilosopher/AI-Engineering-reading-notes | 3 (blog notes on T1) | softwarephilosopher.com/2025/12/27/ai-engineering-my-reading-notes/ | All 10 chapters of AI Engineering (Huyen): foundations, models, evaluation methodology, evaluating AI systems, prompt engineering, RAG+agents, fine-tuning, dataset engineering, inference optimization, architecture+feedback | MOST substrate-relevant single source. RAG, agents, evaluation under non-determinism, prompt defenses, LLM-app architecture all covered. Feeds substantial `ai-systems/` content. |

## 14-Book Foundation — Notes Coverage Status

The opinionated foundational reading list (per session brainstorm). Each book owns a unique slice of the architectural/AI concern space; anything else is inferrable.

| # | Book | Tier | Notes status | Primary source |
|---|------|------|--------------|----------------|
| 1 | Designing Data-Intensive Applications (Kleppmann) | 1 | ✓✓ Comprehensive | ahmedhammad97 + pkardas (67KB) |
| 2 | Clean Architecture (Martin) | 1 | ✓ Acquired | aza0092/Clean-Architecture-Notes (33KB) + charlax cheatsheet PDF |
| 3 | A Philosophy of Software Design (Ousterhout) | 1 | ✓ Comprehensive | alysivji notes (807 lines, all 20 chapters) |
| 4 | Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani) | 1 | ✓ Acquired | danlebrero blog (15 chapters, named taxonomies preserved) |
| 5 | Domain-Driven Design (Evans) | 1 | ✓ Have | pkardas (31KB) |
| 6 | Release It! (Nygard) | 1 | ✓ Have | pkardas (67KB) |
| 7 | Site Reliability Engineering (Beyer et al.) | 1 (free book) | ✓ (book itself free) | sre.google/books |
| 8 | The Pragmatic Programmer (Hunt/Thomas) | 1 | ✓ Have | pkardas (42KB) |
| 9 | Refactoring (Fowler) | 1 | ✓ Have | pkardas (35KB) |
| 10 | Fundamentals of Software Architecture (Richards/Ford) | 1 | ✓ Have | pkardas (78KB) |
| 11 | AI: A Modern Approach (Russell/Norvig) | 1 | ✗ Soft gap | manjunath PDF + Stanford CS221 / Berkeley CS188 course notes; defer until AIMA chapter actually needed |
| 12 | Hands-On Machine Learning (Géron) | 1 | ✓ Light | pkardas (5KB only — may need supplementary) |
| 13 | Designing Machine Learning Systems (Huyen) | 1 | ✓✓ Comprehensive | serodriguez68 (11 chapter files, 230KB total) |
| 14 | AI Engineering (Huyen) | 1 | ✓ Comprehensive | softwarephilosopher blog (all 10 chapters) |

**Coverage: 13/14 with notes (only AIMA is open).** AIMA is a soft gap — university course notes available; AI Engineering (Huyen) covers the practical agent territory most relevant to the substrate.

## Bonus content beyond the 14-book foundation

These sources brought in supplementary content not on the canon list:

- **Software Architecture Patterns** (Mark Richards' free O'Reilly report) — 5 named architecture styles. Fills NEW `architecture-styles/` branch.
- **Principles of Package Design** (Noback) — SOLID + 6 package principles with I-metric / A-metric. Quantitative actionability rare elsewhere.
- **Clean Code** (Martin) — supplementary to PoSD; available via aza0092 + ahmedhammad97 + pkardas. Cut from foundation but useful citation.
- **Code Complete** (McConnell) — pkardas (23KB). Cut from foundation but available if needed.
- **Tidy First, Clean Agile, Peopleware** — pkardas has notes; out of foundation scope.

## Source queue (user-supplied; awaiting processing)

Patterns the user has flagged for ingestion in upcoming sessions. Currently empty — we're moving to authoring. New URLs go here when surfaced.

| Date added | URL / path | Tier estimate | User notes / focus area |
|------------|-----------|---------------|------------------------|
| (queue empty) | - | - | - |

## Source-quality calibration log

Track how sources actually behaved vs initial tier estimate. If a source consistently surfaces noise / unverified claims / pop-engineering content, downgrade its tier or exclude.

| Source | Initial tier | Adjusted tier | Reason for adjustment |
|--------|--------------|---------------|----------------------|
| (none yet) | - | - | - |

## Excluded sources

Sources reviewed and rejected. Captured here so we don't re-evaluate them.

| Source | Reason for exclusion |
|--------|---------------------|
| (none yet) | - |

## Tips for efficient ingestion

(notes for the user on how to make source-passing efficient)

- **Specific URLs > whole repos**: passing `github.com/X/Y/blob/main/specific-chapter.md` costs much less than "look at repo X." Per-file granularity reduces fetch overhead and keeps me focused.
- **Pre-flag chapters/sections**: "Read Ousterhout chapters 4-6" beats "read Philosophy of Software Design." Saves session budget.
- **Pasted excerpts when feasible**: for sources where copy-paste is fine, that's the most efficient path. Reading text in conversation is faster than fetching URLs.
- **Tier estimate optional**: I can assess tier from source itself; user-supplied estimate is helpful but not required.
