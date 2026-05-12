---
kb_id: architecture/ai-systems/inference-cost-management
version: 1
tags:
  - ai-systems
  - cost-management
  - foundational
  - architecture
  - performance
  - economics
sources_consulted:
  - "AI Engineering (Chip Huyen, 2024) ch 5 (Prompt Engineering) + ch 6 (RAG and Agents) + ch 8 (Inference Optimization) — comprehensive coverage of inference cost levers + tradeoffs"
  - "Anthropic API documentation (docs.anthropic.com) — published pricing model + prompt caching mechanics + batch API capabilities"
  - "OpenAI Cookbook (cookbook.openai.com) — practical inference patterns + cost-optimization recipes"
  - "Karpathy, A., 'State of GPT' (Microsoft Build 2023) — inference-time compute as the new scaling lever; cost implications of agent loops vs single-shot generation"
related:
  - architecture/ai-systems/rag-anchoring
  - architecture/ai-systems/agent-design
  - architecture/crosscut/idempotency
  - architecture/discipline/trade-off-articulation
status: active+enforced
---

## Summary

**Principle**: Inference cost is the new database cost — it scales with usage, often dominates infra spend, and rewards intentional design. Treat tokens like dollars: budget them, cache them, batch them, route them.
**Five levers**: model selection / context management / prompt caching / batching / output control. Each lever has a different cost/quality tradeoff.
**Failure mode**: defaulting to the largest model on every call. Most tasks can use smaller models; many tasks benefit from cheaper-and-faster over bigger-and-smarter.
**Hidden cost**: agent loops multiply token usage — each step replays the accumulating history. Long loops amortize poorly.
**Sources**: AI Engineering (Huyen) + Anthropic API docs + OpenAI Cookbook + State of GPT (Karpathy).
**Substrate**: per-spawn budget tracking via `budget-tracker.js`; route-decide gates trivial tasks to root (avoids unnecessary spawn); ADR-0005 budgets prose authoring (avoid pseudo-prescriptive bloat).

## Quick Reference

**The five cost levers**:

| Lever | Mechanism | Typical savings | Quality impact |
|-------|-----------|-----------------|----------------|
| **Model selection** | Right-size model to task complexity | 5-20x | Variable; small models can match large for narrow tasks |
| **Context management** | Trim history; summarize old turns; RAG-replace context | 2-10x | Risk: relevant context dropped |
| **Prompt caching** | Reuse cached prefixes across calls | 50-90% on cacheable portion | None (correctness preserved) |
| **Batching** | Group requests for batch API discounts | 50% on supported APIs | Latency tradeoff (batch turnaround) |
| **Output control** | `max_tokens`, stop sequences, structured output | Variable | Risk: truncation; mitigated by good prompt design |

**Cost decomposition**:

- *Input tokens* (prompt + context): metered on every call; caching available
- *Output tokens* (model response): typically more expensive per-token than input; output is harder to compress
- *Cache reads* (if supported): cheaper than uncached input; substantial savings for repeated context

**Apply when**: designing any LLM-mediated product surface; reviewing infra spend; iterating on prompt + agent designs; comparing model versions; estimating budget for a new feature.

**Failure modes**:

- *Default-max-model*: using the largest available model for every request. Most calls don't need it.
- *Context bloat*: stuffing the prompt with "just in case" content. Each unused token costs across every call.
- *Loop amortization*: agent loops replay accumulating history on each step. Long loops scale tokens super-linearly.
- *Output sprawl*: model generates verbose responses by default. Per-token output cost > input cost.

**Substrate examples**:

- `budget-tracker.js` — per-spawn token + cost accounting
- `route-decide.js` — workflow-vs-agent gate; routes trivial tasks to root, avoiding spawn cost
- KB-resolver content-addressing — caches resolved KB content across spawns
- ADR-0005 slopfiles discipline — directly addresses output sprawl in authored prose

## Intent

Inference is the production cost of LLM systems. Unlike training (one-time + capitalizable), inference is per-request, scales with usage, and accrues continuously. At scale, inference often becomes the dominant infrastructure line item — comparable in importance to database cost for traditional SaaS.

Per Karpathy (State of GPT): inference-time compute is the new scaling lever. Agent loops, reasoning, multi-shot generation all multiply per-task token usage. The cost arithmetic shifts from "API call once" to "API call N times across the loop" — and N can be large for complex tasks.

The intent of cost management discipline is to make inference economics intentional rather than incidental:

- *Intentional*: each request uses the cheapest model that meets quality requirements; context is trimmed; caching is leveraged
- *Incidental*: every request defaults to the most expensive model; full conversation history is replayed; nothing is cached

Without discipline, costs grow uncorrelated with value delivered. With discipline, costs grow with usage — but quality and budget remain bounded.

## The five levers

### Lever 1: Model selection

Match model capability to task complexity. The largest model is usually overkill for narrow tasks.

- **Routing**: classify the task upfront; route to a small model for trivial tasks, a large model for complex ones
- **Cascading**: try the small model first; escalate to the large model only if quality is insufficient
- **Specialization**: use task-specific smaller models where they match larger models' quality on the narrow domain

Per AI Engineering (Huyen ch 8): the cost ratio between flagship and smaller models in the same family is often 5-20x. For tasks where both produce equivalent output (extraction, classification, simple summarization), defaulting to the flagship is a 5-20x avoidable cost.

**Practical pattern**: maintain a model-routing table in your system; default to the cheapest-acceptable model; escalate only when quality eval indicates need.

### Lever 2: Context management

The prompt is metered per-token on every call. Strategies to reduce context cost:

**Trim history**: in multi-turn systems, drop older turns that aren't relevant to the current task. Risk: drop relevant context.

**Summarize old turns**: replace older turns with model-generated summaries. The summary is shorter; preserves key information. Cost: summarization itself.

**RAG over stuffing**: instead of including reference material in every call's prompt, retrieve relevant chunks per-query. The retrieved chunks scale with query complexity, not with the full corpus. See `kb:architecture/ai-systems/rag-anchoring` for the depth treatment.

**Trim retrieved context**: even with RAG, retrieved chunks may include irrelevant content. Re-rank + filter before stuffing into the prompt.

Each technique trades context budget against potentially-lost information. Pair with eval: measure quality before + after trimming.

### Lever 3: Prompt caching

For prompts with stable prefixes (system prompt, persona scaffolding, retrieved context), prompt caching lets the provider reuse cached state across calls. Typical savings: 50-90% on the cached portion.

**When applicable**:

- System prompt that doesn't change across requests
- Persona scaffolding shared across actors
- Document context reused across multiple queries about the same document
- Long static instructions reused across calls

**Anthropic prompt caching** (per Anthropic API docs): mark cacheable prefix segments; cached reads are cheaper than fresh input tokens; cache TTL is provider-dependent.

**Practical pattern**: structure prompts with the *stable* content first (system instructions, persona context) + the *variable* content last (user query, current step). The stable prefix is cacheable; the variable suffix isn't.

### Lever 4: Batching

Process multiple requests together for batch API discounts.

**Anthropic Message Batches API** (per Anthropic API docs): batch processing offers ~50% cost reduction vs individual real-time calls. Latency tradeoff: batches process asynchronously (typical turnaround in minutes-to-hours).

**When applicable**:

- Bulk processing where latency isn't user-facing (overnight pipeline runs, eval suites)
- Offline analytics over large input sets
- Re-running an eval set across multiple model versions

**Not applicable for**:

- Real-time user-facing requests (latency too high)
- Interactive multi-turn dialog
- Agent loops where each step depends on the previous

### Lever 5: Output control

Output tokens are typically more expensive per-token than input. Strategies to reduce output cost:

- **`max_tokens` cap**: prevents runaway generation; sized to expected output length + buffer
- **Stop sequences**: terminate generation when a marker is seen (e.g., `</answer>` or `---`)
- **Structured output**: ask for JSON or constrained format; verbose prose tends toward more tokens than structured equivalents
- **Prompt-driven concision**: "Answer in 2 sentences" vs "Answer thoroughly" — prompts can shift output length

**Failure mode**: too-aggressive `max_tokens` truncates valid outputs; mid-response truncation produces malformed results. Pair `max_tokens` with prompt-level guidance ("answer concisely; if you need more space, prioritize the most important points first").

## Hidden cost: agent loop amortization

Agent loops (per `kb:architecture/ai-systems/agent-design`) replay the accumulating history on each iteration. Per-step token usage grows with loop length.

**Naive cost arithmetic**: N loop steps × per-step tokens = total tokens.

**Realistic cost arithmetic**:

```
Step 1: process(prompt + tools_schema)              — ~K tokens
Step 2: process(prompt + tools_schema + step_1_history)  — ~K + ~step_1_size
Step 3: process(prompt + tools_schema + step_1_2_history) — ~K + ~steps_1_2_size
...
```

Total tokens grows roughly quadratically with loop depth. A 20-step loop is dramatically more expensive than 20 independent calls.

### Mitigations

- **Step budgets**: cap loop iterations; force termination with partial-result return
- **History compression**: summarize older steps; replace verbose history with summary in the next prompt
- **Working memory**: instead of replaying full history, maintain a structured "memory" object that summarizes prior steps + current state
- **Two-tier loops**: outer loop with broad strokes; inner mini-loops with compressed context

Per Anthropic agent guidance: well-designed agents use compressed context after a few steps. Naive full-history replay is a substantial production-cost trap.

## Default-max-model anti-pattern

The most common cost-management failure: defaulting to the largest model in the family for every request.

**Why it happens**:

- Quality variance across model sizes is real but easy to over-correct for
- Switching models requires eval + verification; default-flagship is the path of least resistance
- "Big model = better answer" intuition is correct on average but wrong frequently

**Mitigation**:

- Task taxonomy: classify the requests in your system; benchmark each task class on small + large models; route accordingly
- Eval pairs: for any new task class, eval on small + large model; if quality parity, default to small
- Monitor cost-per-request over time; flag when expensive-model usage doesn't correlate with quality wins

## Context bloat anti-pattern

The second-most-common failure: stuffing the prompt with "just in case" content.

**Why it happens**:

- Better-safe-than-sorry instinct
- Hard to evaluate which context is load-bearing without eval
- System prompts accrue clauses over time; few are removed

**Mitigation**:

- Treat the system prompt like code — review additions; periodically prune
- Eval-driven trimming: remove a clause; re-run eval; if quality holds, the clause was bloat
- RAG-replace: retrieved context is variable-by-query; static "include in every call" content is per-call cost

## Apply when

- **Designing a new LLM feature**: budget the inference cost upfront; identify which levers apply; eval cost-vs-quality tradeoffs
- **Reviewing infrastructure spend**: decompose inference cost across calls + tokens + models; identify the biggest cost lines; apply levers
- **Iterating on prompts / system prompts**: every clause added is a per-call permanent cost; periodically eval-driven prune
- **Comparing models**: don't just compare quality — compare cost-per-quality (eval pass rate / dollar)
- **Building agent loops**: budget step count + context size; mitigate quadratic-amortization with compression

## When NOT to use this principle (or apply with caveat)

**Don't apply when**:

- **Prototyping phase** — premature cost optimization in a pre-PMF prototype trades correctness for savings on the wrong axis. Defer cost-management until the loop shape stabilizes (post-MVP, when token-burn-per-feature is measurable).
- **Correctness-critical paths where lever trade-offs degrade quality** — model downsize on a regulatory-compliance check, prompt truncation on a legal-summarization task, retrieval-only on a multi-hop reasoning chain. The cost saved is worth less than the correctness lost.
- **Single-call workflows where amortization doesn't apply** — the agent-loop amortization lever requires multi-step loops to recover its inference investment. A one-shot call has nothing to amortize.

**Apply with caveat when**:

- **Latency-bound paths** — cost-optimization via model downsize often also reduces latency (smaller model = faster inference). Verify the cost/quality trade-off doesn't break the latency SLO before applying.
- **Multi-tenant systems** — per-tenant cost shaping (different model tiers, different cache hit rates) requires routing logic that itself adds cost. Profile before adding the routing layer.

**Cross-reference**: `agent-design` treats agent loops as the highest-leverage cost amortization mechanism — but defaulted-max-agent is also the most expensive anti-pattern. The agent vs workflow decision IS the cost decision in most LLM systems.

## Substrate applications

### `budget-tracker.js` per-spawn accounting

The substrate tracks per-spawn token + cost usage via `scripts/agent-team/budget-tracker.js`. Each HETS actor spawn records input + output tokens; aggregation across spawns + persona ladders gives per-task cost visibility.

This is the substrate's cost-observability surface — substrate users can see what HETS runs actually cost; cost trends across runs are visible.

### `route-decide.js` as workflow-vs-agent cost gate

Per `kb:architecture/ai-systems/agent-design`, the workflow-vs-agent distinction is the load-bearing reliability axis. It's *also* the load-bearing cost axis.

`route-decide.js` returns `root` (handle inline; cheap) or `route` (spawn team; expensive). Routing trivial tasks to `root` avoids the substantial cost of multi-actor HETS runs.

The gate's threshold tuning is partly a cost question: lower the bar for `route` and you pay more in spawns; raise it and you may handle complex tasks too cheaply. Per H.7.5 calibration: the gate is recalibrated periodically based on observed pass rates at different threshold cutoffs.

### KB-resolver content-addressing

`kb-resolver.js` (per substrate kb-system) caches resolved KB content. Multiple spawns referencing the same `kb_id` get cache hits; the KB content isn't re-fetched + re-tokenized.

This is substrate-level RAG cost optimization: the resolved content can be cached across spawns + sessions; the resolution is fast + cheap; the cached content is reusable.

### ADR-0005 slopfiles discipline as output-cost discipline

ADR-0005 addresses pseudo-prescriptive prose (`<important if>` blocks) — content that takes tokens but doesn't deliver value. The discipline is directly an output-cost concern: bloated documentation pays per-load tokens forever.

The substrate's authoring discipline trades author convenience for sustained inference-cost reduction. KB docs (this one + siblings) are sized for substantive content + nothing more.

## Tensions

### Cost vs latency

Lowest cost (e.g., batch API) is highest latency. Lowest latency (real-time flagship) is highest cost. Each use case has its own balance:

- User-facing chat: latency matters; cost less so. Acceptable to default to a mid-tier model.
- Background pipelines: latency doesn't matter; cost matters. Default to batch API + smaller models.
- Eval suites: cost matters but moderately; pin models for comparability.

### Cost vs quality

Cheaper models cost less per token but may need more tokens (longer context, more attempts) for equivalent quality. The cost-per-quality calculation isn't just dollars-per-call; it's dollars-per-correct-output.

Per Huyen (AI Engineering ch 8): periodically re-run cost-vs-quality eval as model families update. Yesterday's right answer (e.g., "default to flagship for legal-domain reasoning") may shift as smaller models close the gap.

### Cost vs control

Caching, batching, and structured output add operational complexity. Each lever requires eval + monitoring to ensure quality isn't degraded.

- Aggressive caching can mask stale-result bugs
- Aggressive batching can delay user-facing feedback
- Aggressive output capping can truncate valid responses

Apply each lever where the cost savings justify the operational overhead.

## History

Authored: kb authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup). Closes the `## Related KB docs (planned)` forward-reference from `rag-anchoring.md` for inference-cost-management. Pairs with rag-anchoring (RAG is one of the major cost levers via context-management), agent-design (agent loops are the major cost amplifier), and idempotency (cacheable calls require idempotent semantics on the substrate side).

## Phase

Authored: H.9.3 KB authoring batch — sibling format-discipline trajectory under H.9.x. Fifth and final of 5 unauthored planned KBs (per HT.1.12-followup BACKLOG entry). AI-systems cost discipline closes the most-cited forward-reference cluster from rag-anchoring + completes the AI-systems KB sub-tree (3 docs: rag-anchoring + agent-design + evaluation-under-nondeterminism + inference-cost-management = 4 active AI-systems KBs).
