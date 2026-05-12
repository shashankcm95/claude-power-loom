---
kb_id: architecture/ai-systems/agent-design
version: 1
tags:
  - ai-systems
  - agents
  - foundational
  - architecture
  - tool-use
  - planning
sources_consulted:
  - "Yao, S. et al, 'ReAct: Synergizing Reasoning and Acting in Language Models', arXiv:2210.03629 (2022) — canonical interleaved-reasoning-and-acting paradigm for tool-using agents"
  - "Schick, T. et al, 'Toolformer: Language Models Can Teach Themselves to Use Tools', arXiv:2302.04761 (2023) — model-self-augmentation framing for tool use"
  - "AI Engineering (Chip Huyen, 2024) ch 6 (RAG and Agents) — practical agent architectures + failure modes + deployment patterns"
  - "Karpathy, A., 'State of GPT' (Microsoft Build 2023) — agent loops as the inference-time compute scaling lever"
  - "Anthropic, 'Building Effective Agents' (anthropic.com/engineering, 2024) — Workflow vs Agent distinction; agentic patterns catalog"
related:
  - architecture/ai-systems/rag-anchoring
  - architecture/discipline/refusal-patterns
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/deep-modules
  - architecture/ai-systems/inference-cost-management
status: active+enforced
---

## Summary

**Principle**: An agent is an LLM + a loop + tools, where the model decides what to do next based on prior steps' results. The loop is the load-bearing primitive.
**Workflow vs Agent (Anthropic 2024)**: workflows have predetermined paths; agents choose paths. Use workflows for known control flow; use agents only when the next step depends on the prior step's result.
**Canonical pattern (ReAct)**: interleave Thought / Action / Observation steps. Reasoning between actions improves tool-use accuracy + reduces wasted calls.
**Failure modes**: looping (repeated identical actions); hallucinated tool calls; budget exhaustion (too many steps); over-confident planning (the model commits to a wrong plan early).
**Sources**: ReAct (Yao 2022) + Toolformer (Schick 2023) + AI Engineering (Huyen) + State of GPT (Karpathy) + Anthropic agent guidance.
**Substrate**: HETS as the agent-team pattern; persona contracts as agent-scope declarations; route-decide as the workflow-vs-agent gate.

## Quick Reference

**The agent loop primitive**:

```
while not done:
    thought = model.reason(history)
    action = model.choose_action(thought, available_tools)
    observation = execute(action)
    history.append(thought, action, observation)
    done = is_complete(history) or budget_exhausted(history)
```

**Workflow vs Agent (Anthropic distinction)**:

| Property | Workflow | Agent |
|----------|----------|-------|
| Control flow | Pre-determined | Model-decided |
| Steps | Known at design time | Unknown until run-time |
| Use when | The task has a stable shape | The task's shape depends on intermediate results |
| Cost | Predictable | Variable (loop steps, branch decisions) |
| Reliability | High (deterministic paths) | Lower (model can mis-plan) |
| Debugging | Easier (fixed paths) | Harder (run-dependent paths) |

**ReAct pattern (Yao 2022)**: interleave reasoning with action.

```
Thought: I need to find the user's recent purchases. The CRM tool can do this.
Action: crm.search(user_id="123", since="2024-01-01")
Observation: {orders: [...], total: 4 orders}
Thought: 4 orders found. Now I need to check return policy for the most recent one.
Action: policy.lookup(order_id="...", topic="returns")
Observation: ...
```

The Thought step is the load-bearing component — it gives the model space to plan before committing to an action.

**Tool-use design principles**:

- Tools should be deep modules (per `kb:architecture/crosscut/deep-modules`) — narrow interface, rich functionality
- Tool descriptions are part of the prompt — they must be accurate + concise
- Failure modes should be returned as observations, not raised as exceptions — the agent can react

**Budget shape** (control loop iteration):

- Token budget: per-step + cumulative
- Step budget: max iterations before forced termination
- Tool budget: per-tool rate-limit + monetary-cost cap
- Wall-clock budget: max latency before user-facing timeout

**Apply when**: tasks involve multi-step reasoning + tool use + an indeterminate path. Default to workflow (cheaper, more reliable) until the indeterminate-path requirement is real.

**Substrate examples**:

- HETS (Hierarchical Ensemble Task Substrate) — super-agent orchestrator + tier-2 personas + tier-3 actors
- Persona contracts at `swarm/personas-contracts/` — declare each persona's scope, allowed tools, anti-patterns
- `route-decide.js` — substrate's workflow-vs-agent gate (returns `root` for trivial tasks; `route` for non-trivial)
- `agent-identity` registry — assigns persona+identity per spawn; codifies the agent's role for the lifetime of the loop

## Intent

LLMs are stateless next-token predictors. To make them useful for tasks that take multiple steps + external interactions, we wrap them in an agent loop: the model proposes an action, the substrate executes it, the result is fed back, the model decides what to do next.

The agent pattern emerged because raw LLMs can't:

- Browse for facts (the corpus is fixed at training time)
- Compute reliably (model arithmetic is unreliable; calculators are precise)
- Access proprietary data (the model didn't train on your customer database)
- Take actions in the world (writing files, calling APIs, scheduling jobs)

The loop + tools combination addresses all four. The model's role shifts from "produce the answer" to "decide what to do next." The substrate's role is "execute the chosen action + return results faithfully."

The intent isn't to make the LLM smarter — it's to make it *operational*. A loop with tools turns a static model into a system that can interact with state.

## Workflow vs agent (the load-bearing distinction)

Per Anthropic's "Building Effective Agents" (2024), the workflow-vs-agent distinction is the most important early design decision.

**Workflow**: control flow is fixed at design time. Examples:
- Always run sentiment analysis, then topic classification, then summarization
- Always retrieve relevant docs, then generate the answer with retrieved context
- Always check user permissions, then look up record, then format response

Each step might involve an LLM call, but the *order* and *branches* are predetermined.

**Agent**: control flow is decided at run time by the model. Examples:
- "Help me triage this customer ticket" — the model decides which tools to invoke based on what the ticket says
- "Refactor this code" — the model decides which files to read, which to modify, which to test
- "Plan a project" — the model decides which sub-tasks to break out + sequence

The agent pattern is *more powerful* but *less reliable*:

- Workflows can be tested deterministically; agents require eval on representative tasks
- Workflows have predictable cost; agent costs depend on how many loop iterations happen
- Workflow bugs are usually code bugs; agent bugs are often *behavior* bugs (loop didn't terminate, model planned poorly, tool was misused)

**Default to workflow.** Per the Anthropic guidance + practical experience: most LLM systems should be workflows. Agents are warranted when the task's shape genuinely depends on intermediate results — and even then, a hybrid (workflow with an agent step) is often better than full-agent.

## The ReAct pattern

ReAct (Yao et al, 2022) is the canonical pattern for tool-using agents: interleave **Reasoning** and **Acting** steps.

**Without ReAct** (action-only):

```
Action: search("Python list comprehension")
Observation: [results...]
Action: search("Python list comprehension speed")
Observation: [results...]
```

The model picks each action without explicit reasoning. Tool calls can be wasteful + uncorrelated with the underlying goal.

**With ReAct** (reasoning + acting):

```
Thought: The user wants to know if list comprehensions are faster than for-loops in Python.
         I should find authoritative comparisons.
Action: search("Python list comprehension vs for loop benchmark")
Observation: [Top result: 2-3x faster for simple operations]
Thought: That's a good high-level answer. Let me also check if there are edge cases
         where the difference reverses.
Action: search("when is for loop faster than list comprehension Python")
Observation: [Top result: for loops can be faster with complex conditional logic]
Thought: I have enough to answer the question now.
Action: respond(...)
```

The Thought steps give the model:

- Space to reason about *why* before committing to *what*
- Opportunity to correct course before wasted action
- A reasoning trail for debugging + auditing

Per Yao et al, this pattern outperforms pure action-only loops on standard agent benchmarks (HotpotQA, ALFWorld). The reasoning serializes the model's planning into the context where it can be re-attended; without it, planning is implicit + brittle.

## Tool-use design

### Tools as deep modules

Tools exposed to agents should be *deep modules* (per `kb:architecture/crosscut/deep-modules`):

- **Simple interface**: a few clear parameters; minimal optionality
- **Rich implementation**: handles the complex work internally
- **Self-describing**: tool description is concise + complete

A bad tool: `database.execute(query: str)` — the agent has to know SQL, table names, schema. The interface is shallow; the agent's burden is high.

A better tool: `lookup_customer(customer_id: str) -> CustomerSummary` — the agent provides what it knows; the tool handles SQL + joins + formatting.

Per Anthropic agent guidance: design tools that minimize the model's required knowledge. The model is good at choosing high-level actions; the tool implementation should handle the details.

### Tool descriptions are part of the prompt

Tool schemas + descriptions are included in the prompt (often as JSON schema). They cost tokens + shape behavior. Practical implications:

- Keep descriptions short — every word costs tokens on every call
- Be specific about expected inputs + return shapes — ambiguity produces malformed calls
- Document failure modes the agent should react to — "returns null if not found" is loadbearing
- Avoid contradictions between description + actual behavior — the model trusts the description

### Failures as observations, not exceptions

Tool failures should be returned to the agent as *observations* (data the model can react to), not raised as exceptions (which interrupt the loop).

Bad: tool raises `CustomerNotFound`. The substrate has to catch + recover; the agent has no way to plan a different path.

Good: tool returns `{found: false, reason: "no record matches id=123"}`. The agent observes the failure + can choose: retry with different input, ask the user, try a different tool, give up gracefully.

This treats the agent loop as a *recoverable* control structure rather than a *fragile* exception path.

## Budget shape

Agents need budgets along multiple axes; without them, a misbehaving loop can spin indefinitely or accumulate unbounded cost.

### Token budget

- *Per-step token cap*: prevents a single inference call from consuming the full budget
- *Cumulative token cap*: prevents the loop from accumulating across many steps
- *Context-window pressure*: as history grows, latency + cost rise; loops may need summarization

### Step budget

Max iterations before forced termination. Without it, looping behaviors (model proposing identical action repeatedly) can run unbounded.

Per Anthropic guidance: include a hard step cap + a *soft* cap that prompts the model to wrap up. Soft caps preserve graceful termination; hard caps prevent runaway.

### Tool budget

- *Rate limit per tool*: prevents API exhaustion
- *Monetary cost cap*: prevents a search tool with per-query cost from running 1000 queries
- *Combined cap across loop*: top-level budget that any tool's usage contributes to

### Wall-clock budget

User-facing systems can't afford unbounded latency. Set a wall-clock cap that triggers graceful termination + partial-result return. The agent should know its remaining time (model behavior shifts when "you have 30 seconds left" is part of the prompt).

## Common failure modes

### Looping

Symptom: model repeats nearly-identical action sequences without progress.

Causes:

- Tool not returning informative feedback ("query failed" without saying why)
- Model lacks context-awareness to recognize repetition
- Reasoning step missing (action-only loop is more loop-prone than ReAct)

Mitigation: include action-history summary in the prompt; detect repeated actions in the substrate + nudge the model ("you just tried that — try something different"); hard step cap.

### Hallucinated tool calls

Symptom: model invents tools that aren't available, or calls with malformed arguments.

Causes:

- Tool descriptions ambiguous or incomplete
- Too many tools in context (model can confuse them)
- Prompt has examples that reference different tools than the actual schema

Mitigation: validate every action against actual tool schema; return clear error observations on hallucinations; prune tool list when feasible.

### Over-confident planning

Symptom: model commits to a multi-step plan, then sticks with it even when early results contradict it.

Causes:

- Plan-then-execute pattern is more brittle than ReAct's incremental planning
- Model doesn't re-plan when observations disagree with assumptions
- Reasoning step doesn't include "is my plan still valid?" check

Mitigation: ReAct-style interleaved reasoning; prompt-level "if observation contradicts plan, revise" instruction; periodic re-summarization that surfaces accumulated evidence.

### Budget exhaustion before completion

Symptom: loop hits step/token/cost cap mid-task; user gets partial result.

Causes:

- Task complexity exceeds budget allocation
- Inefficient tool selection (model uses expensive tools when cheap ones suffice)
- Reasoning steps consume disproportionate budget

Mitigation: ground budget in eval data (what tasks need how much); soft cap warnings let the model wrap up gracefully; budget-aware prompts ("you have ~10 steps left").

## Apply when

- **Building any LLM-mediated multi-step task**: start with workflow; promote to agent only when the indeterminate-path requirement is real
- **Designing tool surfaces**: apply the deep-module principle — narrow interface, rich implementation, clear failure observations
- **Production agent deployment**: budget along all 4 axes (token, step, tool, wall-clock); log + monitor each
- **Eval design**: separate workflow-style eval (deterministic) from agent-style eval (run-dependent); use task-completion + step-efficiency as agent-specific metrics

## When NOT to use this principle (or apply with caveat)

**Don't apply when**:

- **Simple deterministic workflows** — a fixed-step pipeline beats an agent loop on latency, cost, and reproducibility. Use Workflow (per Anthropic's Workflow-vs-Agent distinction) when steps + branching are knowable upfront.
- **Latency-critical paths (<500ms budgets)** — agent loops amortize inference across multiple LLM calls; the ReAct minimum is ~2-3 calls per step. Even at 200ms/call, the loop floor is ~600ms — already above tight latency SLOs.
- **Single-tool one-shot calls** — if the task is "call tool X with these args, return result," the agent loop overhead (reason → act → observe → reason → finish) is pure tax. Call the tool directly from non-LLM code.
- **High-stakes irreversible actions without checkpoint design** — agent loops without explicit confirmation gates can compound errors (agentic file deletion; chained transactions). If you can't add HIL or rollback, prefer Workflow.

**Apply with caveat when**:

- **Mixed deterministic + open-ended sub-tasks** — use Workflow as the outer shell, Agent for the open-ended inner sub-tasks. Don't agent-ify the whole pipeline.
- **Cost-sensitive products** — bound the loop iterations explicitly (`max_iterations`); add per-step token budgets; route trivial sub-tasks to smaller models. See `inference-cost-management` for the cost-lever framework.

**Cross-reference**: `inference-cost-management` treats agent loops as the highest-leverage cost amortization lever — but also the highest-cost anti-pattern when defaulted-to. The agent vs workflow decision IS the cost decision in most LLM systems.

## Substrate applications

### HETS as agent pattern

The substrate's HETS (Hierarchical Ensemble Task Substrate) is an agent-team pattern:

- **Tier 1 super-agent**: orchestrator; sees the overall task
- **Tier 2 personas**: tier-2 actors (`04-architect.mira`, `03-code-reviewer.jade`, etc.)
- **Tier 3 actors**: spawned per-task; each is a constrained LLM loop with persona contract + identity

Each tier is itself an agent loop — the super-agent decides which personas to spawn; each persona decides which tools to use within its scope. The persona contract is the deep-module-equivalent: narrow scope, rich behavior.

### Workflow-vs-agent gate (`route-decide`)

`scripts/agent-team/route-decide.js` is the substrate's workflow-vs-agent gate. Given a task, it returns `root` (handle inline; trivial) or `route` (spawn team; non-trivial). This is the default-to-workflow discipline encoded.

The gate uses a weighted formula across surface-pattern signals (file count, complexity vocabulary, tool-use intent) — a workflow-style decision before the agent layer is invoked.

### Persona contracts as agent-scope declarations

Each contract in `swarm/personas-contracts/*.json` declares:

- `tools.allowed` — which tools the persona can use
- `anti_patterns` — what behaviors to avoid
- `output_requirements` — what shape the result should take

The contract is the agent's scope envelope. Verification (`contract-verifier.js`) checks the result against the contract; failures are observable + can be retried.

### Budget tracking

`scripts/agent-team/budget-tracker.js` records per-spawn token + cost + step usage. The substrate logs accumulating spend across multi-tier agent runs; per-tier caps can be enforced.

## History

Authored: kb authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup). Closes the `## Related KB docs (planned)` forward-reference from `rag-anchoring.md` for agent-design. Pairs with rag-anchoring (RAG is the substrate's most-used pattern *within* agent loops), refusal-patterns (refusal is a deliberate agent behavior + an eval target), and deep-modules (tools should be deep modules).

## Phase

Authored: H.9.3 KB authoring batch — sibling format-discipline trajectory under H.9.x. Third of 5 unauthored planned KBs (per HT.1.12-followup BACKLOG entry). AI-systems pairing: agent-design × rag-anchoring is the most-cited foundational pairing for LLM application architects.
