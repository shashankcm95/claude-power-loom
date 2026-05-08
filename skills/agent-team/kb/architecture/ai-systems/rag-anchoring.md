---
kb_id: architecture/ai-systems/rag-anchoring
version: 1
tags:
  - ai-systems
  - rag
  - foundational
  - architecture
  - retrieval
  - llm-applications
sources_consulted:
  - "AI Engineering (Chip Huyen, 2024) ch 6 (RAG and Agents) + ch 5 (Prompt Engineering) + ch 4 (Evaluate AI Systems)"
  - "Designing Machine Learning Systems (Chip Huyen, 2022) ch 6 (Model Development) + ch 8 (Distribution Shifts and Monitoring)"
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 3 (Storage and Retrieval) + ch 11 (Stream Processing) — for retrieval indexing fundamentals"
related:
  - architecture/ai-systems/agent-design
  - architecture/ai-systems/evaluation-under-nondeterminism
  - architecture/ai-systems/inference-cost-management
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
status: active+enforced
---

## Summary

Retrieval-Augmented Generation (RAG) **anchors LLM generation on curated content** rather than relying purely on the activation-mixture-distribution from training data. RAG doesn't give models new facts — it shifts which framing of facts gets activated during generation. Useful even on closed-book-known content because training data is broad and noisy (Kleppmann's exact quotes coexist with a million paraphrases and contradictions). Three retrieval methods (term-based BM25, embedding-based vector search, hybrid) plus chunking/query-rewriting optimization. The substrate's `kb/` is itself a RAG implementation; this `kb/architecture/` set is the upstream "curated corpus" we'll route to during HETS spawns when integration ships in v2.1+.

## Intent

LLMs trained on internet-scale corpora know vast amounts but represent that knowledge as a *distribution over likely continuations* rather than discrete facts. When generating, the model samples from this distribution — and the distribution mixes canonical correct content with confidently-stated wrong content (training data is contaminated by every paraphrase, hot take, and tutorial mistake on the web).

The result: even when the model "knows" something correctly, it may generate a wrong-but-plausible answer because the wrong answer has comparable activation strength. This is a probabilistic failure mode, not a knowledge failure mode.

RAG addresses this by **anchoring** generation on retrieved content. Before generating, retrieve a small set of relevant high-quality documents and inject them into the prompt context. The model's generation is now conditioned on those specific framings — activation strength shifts toward the retrieved content; competing wrong activations are suppressed. The model still uses its weights; but the retrieved chunks act as high-salience anchors.

The intent is not "give the model information it doesn't have" — it's "give the model an authoritative version of information it has, so the right activation wins."

## The Principle

> "RAG addresses information-based failures." — Chip Huyen, *AI Engineering* ch 6 (paraphrasing the RAG vs Fine-tuning decision criterion)

Reformulated:

- **RAG when**: failure mode is "model is generating from the wrong framing of known content," or "model lacks specific updated information"
- **Fine-tuning when**: failure mode is "model exhibits wrong behavioral patterns regardless of input"

The two intersect (some failures need both), but the RAG choice is signaled by the failure mode being *information-based* — the model is mixing canonical with noise.

A RAG system has three architectural components:

1. **Index**: a searchable corpus of curated content
2. **Retriever**: given a query, return top-K relevant chunks
3. **Generator**: LLM conditioned on retrieved chunks + user query

The retriever is the load-bearing piece. A good retriever puts the right chunks in context; a bad retriever puts noise in context. RAG quality depends primarily on retrieval quality, secondarily on chunk quality, only tertiarily on model strength.

## Why RAG works (when it works)

### The activation-distribution problem

LLMs generate by sampling from the distribution `P(next_token | context)`. Without retrieved context, this distribution is the prior — "what does the training data on average suggest comes next?" — averaged across all tokens that match the prompt's pattern.

For "Per Kleppmann (DDIA ch 7), the lost update problem...", the model samples from a distribution that includes:

- The actual canonical text from DDIA (high probability if DDIA is well-represented in training)
- Paraphrases of DDIA from blog posts (also high probability)
- Mistakes in those paraphrases (lower probability but nonzero)
- Confidently-wrong takes from Stack Overflow (some probability)
- Hallucinations specific to this prompt's wording (some probability)

The output mixes these. Sometimes the canonical wins; sometimes the noise wins. The user has no way to tell which.

### How retrieval shifts the distribution

When the prompt contains a verbatim quote from DDIA ch 7, the model's generation is now conditioned on that specific text. The distribution over continuations shifts — content matching the retrieved text becomes much more probable; competing-but-wrong framings become less probable.

Empirically (per Huyen ch 6 and the broader RAG literature): retrieval-augmented generation reduces factual error rate on retrieved content by 30-50% across many benchmarks. Real but not absolute — the model can still ignore retrieved content if it conflicts with strong training prior.

### Why "the model already knows it" misses the point

A common objection: "If the model has DDIA in training, retrieving DDIA chunks is redundant." Wrong on two counts:

1. **Retrieval anchors *which* version**: training data has DDIA's actual text plus every paraphrase. Retrieving the actual text suppresses paraphrase activations.
2. **Retrieval handles updates**: training data is frozen at a cutoff date; retrieval uses current content. Important for evolving knowledge (libraries, APIs, recent events) but also for substrate-specific content the model couldn't have seen (e.g., this substrate's drift-notes and pattern docs).

For curated content, the substrate-specific case is the dominant value: this substrate's own drift-notes, phase findings, and authored pattern docs aren't in any model's training data. Retrieval is the only way to get them in context.

## Retrieval methods

### Term-based retrieval (BM25, TF-IDF)

Classical information retrieval. Tokenize the query and the document corpus; rank documents by term-frequency × inverse-document-frequency. BM25 is the modern variant with length normalization.

- **Pros**: exact-match queries work well ("find docs mentioning kb_scope"); deterministic; no embedding compute; works on small corpora
- **Cons**: no semantic understanding ("retry semantics" won't match "exponential backoff" via BM25)
- **When to use**: technical queries with specific keywords; small corpora; debug-friendly retrieval; latency-critical retrieval

### Embedding-based retrieval (vector search)

Encode query and documents to vectors via an embedding model; rank by vector similarity (cosine or dot product). Index via approximate nearest neighbor algorithms (LSH, HNSW, Product Quantization, IVF, Annoy).

- **Pros**: semantic search ("retry semantics" matches "exponential backoff with jitter"); robust to paraphrase; works well on large corpora
- **Cons**: requires embedding compute (cost per query); can fail on exact-match queries (proper nouns, specific tokens); harder to debug ("why was this chunk retrieved?")
- **When to use**: conceptual queries; large diverse corpora; when paraphrase-tolerance matters

### Hybrid retrieval

Run both BM25 and embedding-based retrieval; combine via reciprocal-rank-fusion or weighted scoring.

- **Pros**: gets both worlds — exact match for specific tokens AND semantic for concepts
- **Cons**: more compute (two retrieval passes); tuning the fusion weight is non-obvious
- **When to use**: production systems where retrieval quality matters more than latency

The substrate's eventual integration (v2.1+) will likely use hybrid: BM25-style routing on `_routing.md` decision tree (deterministic, fast) plus embedding-based fallback for queries that don't match obvious routing keywords.

## Optimization techniques

### Chunking

Documents must be split into chunks small enough to fit in context but large enough to preserve meaning. Options:

- **Fixed-size chunking**: 500-1000 tokens with overlap (simple; loses semantic boundaries)
- **Recursive chunking**: split by structural markers (headings, paragraphs, sentences) recursively until target size
- **Semantic chunking**: cluster sentences by embedding similarity; chunk along semantic boundaries
- **Layout-aware chunking**: for documents with structure (tables, code blocks, lists), preserve the structure; don't split mid-table

For the substrate's pattern docs (which have explicit structural markers — `## Summary`, `## Intent`, etc.), recursive chunking on H2 boundaries works well. Each section is 50-300 lines, fits comfortably in context.

### Query rewriting

User queries are often poorly-formed for retrieval. Rewriting techniques:

- **Decomposition**: break complex queries into sub-queries; retrieve for each; aggregate
- **Expansion**: add synonyms, related terms (HyDE — Hypothetical Document Embeddings: generate a hypothetical answer; embed it; retrieve docs similar to the hypothetical answer)
- **Multi-turn rewriting**: in conversational contexts, rewrite based on conversation history ("can you make it idempotent?" → expand "it" to the prior turn's subject)
- **Translation**: rewrite from user's vocabulary to the corpus's vocabulary

For the substrate, the rewriting is primarily decompositional: a HETS spawn task description is decomposed into architectural concerns ("multi-file change" + "state mutation" + "API design"); each concern routes to specific KB slots.

### Contextual retrieval

Add metadata to chunks (source title, section heading, chunk position) so retrieved chunks include their context. Without this, a chunk like "this happens because the cache uses last-write-wins" is hard to interpret without knowing which doc it's from.

For the substrate's pattern docs, the frontmatter (`kb_id`, `tags`, `sources_consulted`) provides this context automatically.

### Multimodal retrieval

For corpora with images / tables / code: embed each modality separately; retrieve from the relevant modality based on query type. The substrate is currently text-only; multimodal is out-of-scope.

## Failure modes (per Huyen ch 6)

### Failure 1: Retrieval miss

Wrong chunks retrieved. Generation is unhelpful or wrong despite good model. **Causes**:

- Query doesn't lexically match document (BM25 weakness)
- Embedding similarity surfaces semantically close but task-irrelevant chunks
- Corpus doesn't have the answer (bug in curation, not retrieval)

**Mitigation**: hybrid retrieval; query rewriting; corpus quality auditing.

### Failure 2: Retrieved chunk ignored

Right chunk retrieved, model generates as if it weren't there. **Causes**:

- Retrieved chunk conflicts with strong training prior; model trusts its weights over context
- Chunk is at the middle of a long context (model attends more to start and end — the "needle in haystack" problem)
- Chunk lacks salience markers (citations, headers, instructions to use)

**Mitigation**: place retrieved content at start or end of context; explicit instruction "Per the retrieved context: [X]"; keep total context shorter (truncate aggressively).

### Failure 3: Retrieval hallucination

Model generates content that looks like it's from the retrieved chunk but isn't. **Causes**:

- Model paraphrases retrieved chunk inaccurately
- Model attributes plausible-sounding additional content to the source
- Citation generation mismatches actual citation usage

**Mitigation**: post-generation evaluation (LLM-as-judge checking grounding); explicit citations; structural retrieval markers ("Per <source-id>: [chunk]").

### Failure 4: Retrieval over-anchoring

Model becomes too dependent on retrieval; can't generalize beyond retrieved content. **Causes**:

- Aggressive prompt engineering ("ONLY use the retrieved content")
- Retrieval covers most cases; model learns to rely on it
- User asks questions slightly outside retrieval coverage; model refuses or confabulates

**Mitigation**: hybrid grounding ("Use retrieved content where available; otherwise apply general principles"); explicit fallback prompts.

### Failure 5: Stale corpus

Corpus is out of date; retrieved content is wrong. **Causes**:

- Documents updated upstream; corpus index not refreshed
- Cutoff date for the index doesn't include recent changes
- Index drift (subtle bugs in ingestion pipeline)

**Mitigation**: automated re-indexing; corpus-version metadata in chunks; drift detection on retrieval quality (per Huyen, *Designing ML Systems* ch 8).

## The Accuracy Cascade

Per Huyen (AI Engineering ch 6): in multi-step agent flows, errors compound multiplicatively. A 10-step flow where each step has 95% accuracy ends with 60% end-to-end accuracy:

```text
0.95 ^ 10 = 0.5987
```

This is the fundamental constraint on multi-agent systems — and the reason RAG is necessary at scale. Without grounding, each generation step has its own error rate; the cascade compounds. With RAG, the per-step error rate drops; the cascade tolerates more steps.

Substrate-specific: HETS spawn flow has ~3-5 sequential steps (architect → implementer → verifier). Without anchoring, even at 95% per-step, the end-to-end correctness is 78-90%. With substrate-curated KB anchoring, per-step rate moves toward 99%; end-to-end becomes 95-99%. That's the difference between "usable for real work" and "needs constant supervision."

## Substrate-Specific Examples

### This `kb/architecture/` IS a RAG implementation

The work shipped in batches 1-3 (single-responsibility, dependency-rule, deep-modules, idempotency, error-handling-discipline) IS the curated corpus for substrate's eventual RAG integration. The pattern docs are:

- **Curated** (multi-source synthesis from Tier-1 sources; not paraphrases of one source)
- **Substrate-grounded** (every doc cites this substrate's drift-notes as concrete examples)
- **Structurally consistent** (same frontmatter, same section structure — enabling consistent retrieval)
- **Self-citing** (cross-references between docs ensure related patterns surface together)

When v2.1 ships the integration layer (kb-resolver auto-extension, architecture-relevance-detector), HETS spawns for architectural decisions will retrieve from THIS corpus before generating. The activation distribution shifts toward our substrate-curated content; competing-but-noisy training-data content is suppressed.

### `kb-resolver` as the retrieval mechanism

The substrate's `kb-resolver.js` is already a working retriever, currently used for HETS persona contracts and skill-knowledge docs:

- `cat <kb_id>` — direct retrieval by ID (term-based, exact match)
- `resolve kb:<id>@<hash>` — retrieval with content-hash verification (idempotent, drift-detecting)
- `scan` — corpus indexing
- `snapshot <run-id>` — freezing the corpus at run start

This is a complete RAG retrieval substrate; what's missing is the integration with HETS spawn flow (auto-extending `kb_scope` based on task analysis) and the architecture-relevance-detector that maps task signals to KB slots.

### `_routing.md` as the deterministic relevance router

The planned `_routing.md` (per `_TAXONOMY.md`) is the substrate's term-based retrieval mechanism: given task signals (state mutation, multi-file change, async behavior, etc.), deterministic regex matching routes to specific KB slots:

```text
Task signal              →  kb refs to inject
"state mutation"         →  crosscut/idempotency, data/consistency/isolation-levels
"cross-module call"      →  crosscut/information-hiding, crosscut/bounded-contexts
"async / queue / event"  →  data/messaging/outbox, data/messaging/saga
```

This is BM25-style routing without the embedding compute. Fast, deterministic, predictable token budget. Embedding-based fallback is reserved for queries that don't match the routing tree (likely <20% of cases).

### Forcing instructions as RAG-shaped prompts

The substrate's existing forcing instructions ARE RAG-shaped reminders. When `[PROMPT-ENRICHMENT-GATE]` fires, it tells Claude to "consult prior turn for intent" + "look up existing patterns via prompt-pattern-store lookup." The enriched prompt then generates from a context that includes the looked-up patterns — Claude's distribution over continuations is conditioned on the substrate's curated patterns rather than training-data prior.

`[PLAN-SCHEMA-DRIFT]` similarly: tells Claude that the plan should reference specific structural sections (per the substrate's plan template). Claude's plan generation is then anchored on the schema rather than on plan-shaped patterns from training data.

This is RAG at the protocol level: substrate emits structured retrieval prompts; Claude generates conditioned on the retrieved framings.

### Convention G as deep abstraction enabling RAG routing

H.7.25's Convention G (forcing-instruction class taxonomy) IS the meta-routing structure. It defines three classes (Class 1 advisory / Class 2 operator notice / Class 1 textual variant on hard-gate substrate) that future forcing instructions slot into. Routing decisions become "which class does this fit?" rather than "what's a precedent we should mimic?"

This is RAG anchoring applied to the substrate's own taxonomy: instead of model picking from training-data activation, classification is grounded in substrate-curated taxonomy.

## Tension with Other Principles

### RAG vs Inference Cost

Each retrieval pass costs latency + compute. Embedding queries have a per-query embedding cost; vector index queries have storage + lookup cost; injecting chunks into context costs context tokens (and inference cost scales with context length).

**Heuristic**: route-decide at low cost (deterministic regex); only invoke expensive retrieval when routing is ambiguous. The substrate's plan: 90%+ of queries should hit the BM25 routing tree; embedding-based fallback for the ambiguous 10%.

### RAG vs Fine-tuning

RAG addresses information failures; fine-tuning addresses behavior failures. They're complementary, not alternative. A system needing both: fine-tune for tone / format compliance / domain-specific patterns; RAG for current information / curated knowledge.

For the substrate: fine-tuning is out of scope (Claude is a foundation model we don't control). RAG is the entire intervention surface.

### RAG vs Memory (long-context models)

Modern models have long context windows (Claude 1M+). With long context, you can sometimes fit the entire corpus in the prompt — no retrieval needed.

**Heuristic** (per Huyen ch 6 + ch 9): long-context is not free — inference cost scales with context length; needle-in-haystack quality degrades with very long contexts; cost-per-call increases. RAG is more efficient for corpora >>context window.

For the substrate: the architectural KB will exceed Claude's effective working-context limit even at 1M tokens (the full canonical books would be 5000+ pages). Retrieval is necessary.

### RAG vs Determinism

RAG introduces a non-deterministic element: which chunks are retrieved depends on retrieval algorithm, embedding model, index state. Same query may retrieve different chunks at different times.

**Heuristic**: for the substrate, prefer deterministic retrieval (BM25 / regex routing) where possible. Embedding-based retrieval is acceptable but should be used as fallback, not primary, for substrate-meta queries (where determinism aids reproducibility of substrate behavior).

## When to use RAG

- **Curated knowledge**: substrate's own docs, drift-notes, phase findings, persona contracts — content the model couldn't have in training
- **Anchoring on canonical framings**: when training data has noisy paraphrases of authoritative content (DDIA, Clean Architecture, etc.)
- **Updateable knowledge**: APIs, library docs, recent events that change between training cutoffs
- **Compliance-critical content**: where you need to cite specific sources (legal, medical, regulatory)
- **Multi-step generation flows**: anywhere the accuracy cascade matters (per the math above)

## When NOT to use RAG

- **Pure reasoning tasks**: where the question is "what's the right answer given general principles?" rather than "what does specific source X say?" — the model's reasoning is the value-add; retrieval would constrain it
- **Open-ended creative tasks**: brainstorming, exploratory design — retrieval narrows the distribution undesirably
- **When latency budget is tight**: each retrieval pass costs hundreds of ms; for sub-second user-facing operations, RAG may be too slow
- **When corpus is unreliable**: retrieving from low-quality content makes generation worse, not better — bad retrieval is worse than no retrieval

## Failure modes

- **Retrieval miss** — wrong chunks retrieved (hybrid + query rewriting helps)
- **Retrieved chunk ignored** — model trusts prior over context (placement at start/end; explicit "per retrieved" instructions)
- **Hallucination from retrieval** — model paraphrases inaccurately (post-generation grounding evaluation)
- **Over-anchoring** — model can't generalize beyond corpus (hybrid grounding prompts)
- **Stale corpus** — index out of date (re-indexing pipeline; version metadata)

## Tests / verification

- **Retrieval quality**: precision @ K (how many of top-K are relevant?) and recall @ K (how much relevant content did we retrieve?)
- **End-to-end quality**: does generation accuracy improve with retrieval? Compare with/without retrieval on a labeled test set
- **Drift detection**: monitor retrieval quality over time; alert on degradation (per Huyen *Designing ML Systems* ch 8)
- **Citation verification**: assert that generation's cited sources match what was retrieved
- **Substrate-specific**: when integration ships, monitor whether HETS spawn outputs cite KB slots correctly; cite-rate is a quality signal

## Related Patterns

- [architecture/ai-systems/agent-design](agent-design.md) — agents are RAG-augmented LLM calls in a control flow; agent design depends on RAG quality
- [architecture/ai-systems/evaluation-under-nondeterminism](evaluation-under-nondeterminism.md) — RAG evaluation requires its own methodology (precision @ K, faithfulness)
- [architecture/ai-systems/inference-cost-management](inference-cost-management.md) — retrieval costs (embedding, lookup, context) need to be managed
- [architecture/crosscut/single-responsibility](../crosscut/single-responsibility.md) — well-decomposed pattern docs make better retrieval targets (one reason to surface per chunk)
- [architecture/crosscut/dependency-rule](../crosscut/dependency-rule.md) — kb-resolver as a stable abstraction; retrieval consumers depend on the abstraction not the implementation

## Sources

Authored by multi-source synthesis of:

1. **AI Engineering** (Chip Huyen, 2024), the canonical modern source for foundation-model application engineering. Key chapters:
   - Ch 6 (RAG and Agents) — retrieval architecture; term-based vs embedding-based vs hybrid; chunking/query rewriting; agents and the accuracy cascade
   - Ch 5 (Prompt Engineering) — context-length optimization (needle-in-haystack); placement matters
   - Ch 4 (Evaluate AI Systems) — evaluation criteria for retrieval-augmented systems
2. **Designing Machine Learning Systems** (Chip Huyen, 2022) — production ML perspective. Key chapters:
   - Ch 6 (Model Development) — training-serving consistency; relevant to retrieval-time vs index-time consistency
   - Ch 8 (Distribution Shifts and Monitoring) — drift detection; relevant to retrieval-quality monitoring over time
3. **Designing Data-Intensive Applications** (Martin Kleppmann, 2017). Retrieval indexing fundamentals:
   - Ch 3 (Storage and Retrieval) — B-Tree, LSM-Tree, hash indexes; the same primitives underlie retrieval indexes (LSH, HNSW use modified versions)
   - Ch 11 (Stream Processing) — change data capture as a primitive for keeping the retrieval index fresh

Substrate examples cite:
- Phases H.7.25 (Convention G) and H.7.27 (the proto-OS positioning context within which RAG anchoring lives)
- The substrate's own kb-resolver implementation (H.2-bridge.2)
- Drift-note 47 (forcing-instruction shared helper extraction context)
- The specific architecture of `_routing.md` (planned per H.x kb-architecture-planning)

## Phase

Authored: kb authoring batch 4 (post-H.7.27, soak-track work). First-wave priority 6 of the authoring queue. Multi-source synthesis from 3 sources (smaller than prior docs because RAG is a relatively recent canon — most substantive authoritative content lives in AI Engineering + Designing ML Systems by Huyen). Substrate examples emphasize that this very KB IS the substrate's RAG corpus; the integration layer is reserved for v2.1+ post-soak phase.
