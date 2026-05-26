# `_routing.md` — Task-signal-to-KB routing index (planning doc)

> **Status**: planning doc (substrate's planned BM25-style retrieval mechanism). Authored at H.9.4 to close 6 forward-references in `kb/architecture/ai-systems/rag-anchoring.md`. The runtime integration with `kb-resolver` is deferred to v2.1+ post-soak; this doc specifies the routing model + table draft.

## Purpose

`_routing.md` is the substrate's deterministic relevance router: given task signals (regex patterns or keywords), map to specific `kb_id` references for injection into spawn-context prompts. It complements RAG by adding a term-based BM25-style layer to the substrate's retrieval — fast, deterministic, low-cost, and explicit (every routing decision is visible in this file rather than implicit in embedding space).

**Why it exists**:

- The substrate's existing retrieval (`kb-resolver cat <kb_id>`) requires the caller to know which `kb_id` they need. For LLM-driven spawn-context construction, that's expensive (model has to reason about which KB applies before retrieving).
- An embedding-based semantic retrieval layer would be powerful but adds inference cost + opacity (embedding similarity is hard to debug).
- A term-based routing layer (deterministic regex → kb_id mapping) gives a cheap, transparent, fast first-pass retrieval before any embedding fallback.

**Position in the substrate's retrieval stack**:

```
Query / task signal
  ↓
[_routing.md term-based BM25 layer] ← this doc's content
  ↓ (if no match)
[Embedding-based semantic retrieval] ← v2.1+; not yet implemented
  ↓ (if both miss)
[Explicit kb_id from caller] ← current default path
  ↓
kb-resolver cat <kb_id>
```

## Routing model

Each routing entry is a tuple: `(signal_pattern, kb_id, priority, rationale)`.

- **`signal_pattern`**: regex matching task-description text. Case-insensitive. Anchored on word boundaries for term matching.
- **`kb_id`**: the canonical KB identifier to inject (e.g., `architecture/crosscut/idempotency`).
- **`priority`**: 1 (always inject) | 2 (inject if no higher-priority match) | 3 (advisory; suggest in spawn-context but don't auto-inject).
- **`rationale`**: 1-line note on why this signal maps to this KB. Audit trail for routing decisions.

## Routing table draft

Illustrative entries grounded in current `kb/architecture/` inventory. Authored content for runtime consumption pending v2.1+ kb-resolver integration. Table is intentionally incomplete — additions land via PR with rationale.

### Cross-cutting signals

| Signal pattern | kb_id | Priority | Rationale |
|----------------|-------|----------|-----------|
| `\b(idempot[ae]nc[ey]\|retry-safe\|exactly-once\|at-least-once)\b` | `architecture/crosscut/idempotency` | 1 | Idempotency is the load-bearing concern any time retries / replay / replication are involved |
| `\b(state mutation\|side effect\|mutability\|in-place)\b` | `architecture/crosscut/idempotency` | 2 | State-mutation queries route to idempotency because mutable state + retries is the canonical idempotency failure mode |
| `\b(single responsibility\|SRP\|class taking on)\b` | `architecture/crosscut/single-responsibility` | 1 | Direct match |
| `\b(deep module\|small interface\|powerful implementation\|module depth)\b` | `architecture/crosscut/deep-modules` | 1 | Direct match |
| `\b(information hiding\|hide.*decision\|encapsulat\|leakage)\b` | `architecture/crosscut/information-hiding` | 1 | Direct match; pairs with deep-modules |
| `\b(dependency rule\|dependency direction\|inversion\|DIP)\b` | `architecture/crosscut/dependency-rule` | 1 | Direct match |
| `\b(acyclic\|circular dependenc\|module cycle\|import cycle)\b` | `architecture/crosscut/acyclic-dependencies` | 1 | Direct match |

### Discipline signals

| Signal pattern | kb_id | Priority | Rationale |
|----------------|-------|----------|-----------|
| `\b(error handl\|exception\|failure mode\|fail.*open\|fail.*soft)\b` | `architecture/discipline/error-handling-discipline` | 1 | Direct match |
| `\b(refus\|safety check\|scope.*out.*of.*bound\|policy violation)\b` | `architecture/discipline/refusal-patterns` | 1 | Direct match; routes safety-related work to the LLM refusal taxonomy |
| `\b(trade.?off\|articulate\|design rationale\|why this approach)\b` | `architecture/discipline/trade-off-articulation` | 1 | Direct match |
| `\b(reliab[il]\|scalab[il]\|maintainab[il]\|R/S/M)\b` | `architecture/discipline/reliability-scalability-maintainability` | 1 | Direct match |
| `\b(stability\|circuit breaker\|bulkhead\|timeout)\b` | `architecture/discipline/stability-patterns` | 1 | Direct match; Release It! pattern set |

### AI-systems signals

| Signal pattern | kb_id | Priority | Rationale |
|----------------|-------|----------|-----------|
| `\b(RAG\|retriev[ae]\|chunk\|context window\|prompt anchor)\b` | `architecture/ai-systems/rag-anchoring` | 1 | Direct match |
| `\b(agent\|tool.use\|tool.calling\|ReAct\|loop)\b` | `architecture/ai-systems/agent-design` | 1 | Direct match; covers workflow-vs-agent distinction |
| `\b(eval\|benchmark\|judge\|drift\|gold.*set)\b` | `architecture/ai-systems/evaluation-under-nondeterminism` | 1 | Direct match |
| `\b(cost\|token\|inference\|caching\|batch\|model selection)\b` | `architecture/ai-systems/inference-cost-management` | 1 | Direct match |

### Multi-match resolution

When a task description matches multiple patterns, all matched `kb_id`s are candidates for injection. Priority-1 matches always inject; priority-2 matches inject if context budget allows; priority-3 matches are suggested in the spawn-context preamble but not stuffed into the prompt body.

Multi-match limits: cap at 3 priority-1 injections per spawn-context to prevent context-bloat (per `architecture/ai-systems/inference-cost-management` budget discipline).

## Consumer specification

`kb-resolver` will gain a new subcommand `route` (planned for v2.1+):

```bash
# Given a task description, return matched kb_ids
node scripts/agent-team/kb-resolver.js route \
  --task "implement idempotent retry for the email-send queue"
# Output:
# {
#   "matched": [
#     { "kb_id": "architecture/crosscut/idempotency", "priority": 1, "signal": "idempot[ae]nc[ey]" },
#     { "kb_id": "architecture/ai-systems/agent-design", "priority": 2, "signal": "loop" }
#   ],
#   "table_version": "1"
# }
```

Spawn-context construction (`build-spawn-context.js`) calls `route` upfront; injects matched KB content via `kb-resolver cat-summary` per priority-1 matches.

The route table is loaded as YAML/markdown table parsing at startup (cached); table changes require a kb-resolver scan to refresh the cache (mirrors `kb-resolver scan` discipline).

## Routing table maintenance discipline

Per the substrate's `_PRINCIPLES.md` authoring rules + the `kb-architecture-planning/` substrate convention:

1. **Every addition has rationale**: each new row in the routing table includes the 1-line `rationale` column entry. No silent routing decisions.
2. **Priority is conservative**: default priority-2; promote to priority-1 only when evidence supports always-injecting.
3. **No overlap**: two patterns matching the same task substring should not both be priority-1 — choose the dominant one or split signals.
4. **Test cases per row**: each priority-1 entry has 1-2 example task strings that should match (in this doc's appendix when added) — substrate's eventual `route` test surface verifies these.
5. **Periodic revisit**: every quarter, audit routing decisions for false positives (entries that triggered but shouldn't) + false negatives (relevant tasks that didn't match).

## Migration plan (current → v2.1+ runtime)

### Current state (H.9.4)

- `_routing.md` exists as a planning doc with table draft
- `kb-resolver` does NOT consume the table at runtime
- `build-spawn-context.js` uses explicit `kb_id` lists from persona contracts (`kb_scope.default`)
- Routing happens implicitly via contract authoring (engineers decide which KBs each persona needs)

### v2.1+ planned state

- `_routing.md` table consumed by `kb-resolver route` subcommand
- `build-spawn-context.js` calls `route` per task; injects matched KBs at priority-1
- Persona contracts move from `kb_scope.default` (static list) to `kb_scope.routing_signals` (deny-list overrides for routed matches)
- Table additions tracked via PR (one rationale per row; review gate)

### Compatibility guarantee

The migration preserves the explicit `kb_id` injection path:
- Contracts can override routed matches via `kb_scope.exclude` (deny specific routed kb_ids)
- Contracts can force-include kb_ids regardless of routing match (existing `kb_scope.default` behavior)
- Routing is additive; explicit paths remain authoritative

## Open questions (resolve before v2.1+ runtime integration)

1. **Table format**: markdown table (current draft; human-readable + git-diffable) vs YAML/JSON (machine-readable + faster parse)? Substrate's existing `_TAXONOMY.md` + `_SOURCES.md` are markdown — convention favors markdown.

2. **Regex flavor**: ECMAScript (JS-native) vs PCRE (more powerful)? Substrate's hooks + scripts are Node.js — ECMAScript is natural.

3. **Embedding fallback**: do we layer embedding-based retrieval below the deterministic routing? Adds inference cost + opacity but covers signals not enumerable as regex. Per `architecture/ai-systems/rag-anchoring` Quick Reference: hybrid retrieval (term + semantic) typically outperforms either alone — but v2.1+ scope decision pending.

4. **Routing-budget integration**: how does routing interact with `budget-tracker.js`? Per-spawn cap on injected KBs (priority-1 cap of 3 mentioned above) — should that be configurable per persona? Should higher-tier identities (per `agent-identity` trust scoring) get higher caps?

5. **Test surface for table entries**: where do per-row test cases live? Inline in `_routing.md` as appendix tables, or in `tests/smoke-ht.sh` as separate substrate tests? Probably the latter for runtime verification; this doc remains authoring-time reference.

6. **Routing table evolution**: should table changes go through ADR-level review (institutional), lightweight BACKLOG decision-record (per HT.1.6 precedent), or just PR review? Likely PR-level for table additions; ADR/BACKLOG-level for routing-model changes.

## Cross-references

- `kb/architecture/ai-systems/rag-anchoring.md` — primary consumer reference; cites `_routing.md` 6× as the deterministic-retrieval layer
- `kb/architecture/ai-systems/inference-cost-management.md` — routing-budget discipline (3-cap per spawn-context) per cost-management 5-lever framework
- `kb/architecture/ai-systems/agent-design.md` — agent loops consume routed KBs at each reasoning step
- `swarm/kb-architecture-planning/_TAXONOMY.md` — KB inventory routing maps into
- `swarm/kb-architecture-planning/_PRINCIPLES.md` — authoring discipline for routing table additions
- `scripts/agent-team/kb-resolver.js` — future runtime consumer (v2.1+ `route` subcommand)
- `scripts/agent-team/build-spawn-context.js` — future caller (v2.1+ uses routing for context construction)

## History

Authored: H.9.4 pending-docs-completion phase. Closes 6 forward-references from `kb/architecture/ai-systems/rag-anchoring.md`:

- Line 30: "Substrate: this kb/architecture/ IS a RAG corpus; kb-resolver IS the retriever; `_routing.md` (planned) IS BM25 routing"
- Line 85: "`_routing.md` (planned per `_TAXONOMY.md`) IS BM25-style routing: task signal → kb refs to inject"
- Line 175: "BM25-style routing on `_routing.md` decision tree (deterministic, fast)"
- Line 299: "### `_routing.md` as the deterministic relevance router"
- Line 301: "The planned `_routing.md` (per `_TAXONOMY.md`) is the substrate's term-based retrieval mechanism"
- Line 412: "The specific architecture of `_routing.md` (planned per H.x kb-architecture-planning)"

Authored as PLANNING doc per the underscore-prefix convention in `swarm/kb-architecture-planning/` (alongside `_TAXONOMY.md`, `_SOURCES.md`, `_PRINCIPLES.md`, `_NOTES.md`). Runtime integration with `kb-resolver` deferred to v2.1+ post-soak; this doc establishes the routing model + table draft + migration plan.
