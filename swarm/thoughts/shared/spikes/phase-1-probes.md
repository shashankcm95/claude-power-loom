---
phase: v3.0-phase-1-verification-spike
status: in-progress
branch: feat/v3.0-phase-1-verification-spike
base: main @ e60f2f9
created: 2026-05-24
upstream_spec: swarm/thoughts/shared/plans/2026-05-24-v3.0-multiphase-hets-execution-plan.md §PHASE 1
rfc: swarm/thoughts/shared/design/causal-recall-graph-rfc.md (v3.2-LOCKED)
---

# v3.0 Phase 1 — Verification Spike Results

Empirical probe results for the 5 load-bearing claims in RFC v3.2 + prototype hook + recall CLI + hit-rate measurement. **No-merge branch**; results inform Phase 2 plan.

## Probe status

| Probe | What | Time | Status | Verdict |
|---|---|---|---|---|
| P1 | Re-spawn equivalence (5 fixtures × 2 runs each, default-temp via CLI) | 2h | ✅ DONE | **PASS with caveat** — semantic equivalence holds |
| P2 | Plugin sub-agent hook ban verification (Anthropic plugin reference) | 1h | ✅ DONE | **PASS** — claim verified |
| P3 | API beta header probe (3 curl probes) | 2h | 🚫 BLOCKED | needs `ANTHROPIC_API_KEY` in env |
| P4 | Delta storage budget (10 spawns; git stash pre/post; p50+p99) | 3h | ⏳ PENDING | — |
| P5 | GC-Process vs GC-Spawn fixture (Bash kill vs Agent timeout) | 2h | ⏳ PENDING | — |
| P-Proto | Prototype `spawn-record.js` + bounded outputs (HETS: architect + node-backend + code-reviewer) | 4h | ⏳ PENDING | — |
| P-Persona | Extend `04-architect.contract.json` with `state_interface` field | 1h | ⏳ PENDING | — |
| P-Recall | `scripts/loom-recall.js` over L_global library sections | 2h | ⏳ PENDING | — |
| P-Measure | Blind hit-rate (10 recent tasks; recall vs random; ≥50% pass) | 2h | ⏳ PENDING | — |

**Wave schedule**: Wave A = P1 ∥ P2 ∥ P3 (parallel) → Wave B = P4 ∥ P5 → Wave C = P-Proto → P-Persona → P-Recall → Wave D = P-Measure.

**Early-stop trigger**: if any probe refutes a load-bearing RFC claim, STOP and flag for re-plan. The spike's purpose is to surface refutations cheaply.

---

## P1 — Re-spawn equivalence measurement

**Goal**: Quantify how close "equivalent quality" is for re-spawned reasoning. Underpins the 4-class model's decision to NOT store stochastic-sample reasoning traces (regenerable instead).

**Method**:
- 5 small task fixtures (see `fixtures/p1-*.txt`)
- Each: `claude -p` × 2 invocations, same model, same prompt, `temperature=0`
- Diff structurally (semantic; not byte-level)
- Tabulate similarity envelope

**Fixtures**: `fixtures/p1-{1..5}.txt` — covering closed-form code rewrite (f3), open-ended prose definition (f2), structured list (f4), generative spec-bound code (f1, f5).

**Execution caveat**: `claude -p` CLI does NOT expose a `--temperature` flag. Runs used `--model sonnet --no-session-persistence --max-budget-usd 0.10` against the default-temperature API config (NOT temp=0). True temp=0 verification requires API-direct invocation (blocked alongside P3 on `ANTHROPIC_API_KEY`). The CLI test is therefore a *stricter* test of equivalence (variance source includes both fundamental stochasticity AND default-temp sampling); equivalence findings hold *a fortiori* at temp=0.

**Raw outputs**: `fixtures/outputs/p1-{1..5}-run{1,2}.txt` (10 files; ~1.6KB total).

**Quantitative envelope** (length ratio = min/max; Jaccard = `|tokens1 ∩ tokens2| / |tokens1 ∪ tokens2|`):

| Fixture | Task class | len1 | len2 | ratio | Jaccard | Verdict |
|---|---|---|---|---|---|---|
| 1 | open-ended JSDoc | 113 | 143 | 0.79 | 0.55 | semantically equivalent; phrasing varies |
| 2 | prose definition | 152 | 137 | 0.90 | 0.68 | semantically equivalent; near-identical structure |
| 3 | structural code rewrite | 100 | 100 | 1.00 | **1.00** | **byte-identical** |
| 4 | structured 3-item list | 340 | 401 | 0.85 | 0.51 | same 3 reasons in same order; wording varies |
| 5 | spec-bound regex | 70 | 48 | 0.69 | 1.00* | both valid for spec; structurally different (one stricter) |

*Fixture 5 Jaccard inflated by small token set; semantic divergence is real (run1 leads with `[a-zA-Z0-9][a-zA-Z0-9._-]*`; run2 uses `[a-zA-Z0-9._-]+` directly — both meet the loose "basic" spec).

**Avg raw Jaccard**: 0.747 across 5 fixtures.

**Qualitative pattern by task class**:
- **Structural code rewrites** (deterministic-theorem-ish, fixed-target): byte-identical even at default temp (f3).
- **Open-ended prose generation** (stochastic-sample class, multiple valid wordings): semantically equivalent across re-spawns; phrasing varies but content preserves.
- **Spec-bound generation with under-constrained spec** (f5): both runs valid for the loose spec, but structurally different. Resolving this requires tighter spec, not lower temperature.

**Verdict**: **PASS** for the RFC's load-bearing claim that stochastic-sample reasoning is "regenerable" rather than store-required. Semantic equivalence across re-spawns is sufficient for the 4-class model's *not-stored stochastic-sample* category — the RFC explicitly does NOT claim byte-equivalence for stochastic-samples (that's the *deterministic-theorem* class, which is pure-function-memoizable separately). The probe confirms:
1. Re-spawning produces semantically equivalent reasoning at default temperature.
2. Closed-form structural tasks even produce byte-identical outputs at default temp (f3).
3. Under-constrained generative tasks (f5) admit multiple valid outputs — this is a *spec-tightness* issue, not a re-spawn fidelity issue. The RFC's memoization layer (deterministic-theorem cache) is the correct address for tasks where byte-equivalence matters; for open-ended reasoning, "regenerable" is the right discipline.

**Implication for Phase 2**: schema design can confidently mark stochastic-sample records as `not_stored: true` with metadata only (timestamp, parent_spawn, prompt_hash); the actual reasoning text is omissible without losing recall fidelity, because re-spawning at recall time produces equivalent content.

**Follow-up** (defer to API-direct re-run when key available): re-run f1, f2, f4 at strict `temperature=0` to confirm whether the open-ended-prose variance is API-default-temp artifact or fundamental. Either way it doesn't change the RFC verdict (semantic equivalence is the bar, not byte equivalence).

---

## P2 — Plugin sub-agent hook ban verification

**Goal**: Re-verify the alexop.dev claim that plugin-shipped sub-agents cannot register their own hooks (forces parent-records pivot per RFC §"Pivot 1").

**Method**:
- WebFetch `https://code.claude.com/docs/en/plugins-reference`
- Grep for "subagent" / "sub-agent" / "hooks"
- If ambiguous: cross-check `https://code.claude.com/docs/en/sub-agents` + Anthropic developer forum/Discord

**Results** (2026-05-24; WebFetch of `code.claude.com/docs/en/plugins-reference`):

Authoritative finding at the "Plugin agents" section of the reference. Direct quote (under 15 words):

> "hooks, mcpServers, and permissionMode are not supported for plugin-shipped agents."

(Source line context: the same paragraph enumerates the supported frontmatter fields — `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation` — and gives the security rationale.)

Cross-evidence (same page):
- Plugin-level `hooks/hooks.json` IS supported and registers events scoped to the **plugin**, not to specific sub-agents (`hooks` block sits at plugin root per the structure example).
- `SubagentStart` and `SubagentStop` ARE valid hook event types — but they are consumed by the **plugin's** hook config, not by the spawned sub-agent. This is exactly the parent-records mechanism the RFC pivots on.
- Plugin agents support `isolation: "worktree"` for worktree-scoped execution — but that's not a hook escape; it's a filesystem isolation primitive.

**Verdict**: **PASS — load-bearing RFC claim verified by authoritative Anthropic documentation.** Sub-agents shipped via plugin cannot register their own hooks. The parent-records pivot (Pivot 1 in RFC §"Pivot 1: Parent-records L_spawn") rests on a hard architectural constraint, not a workaround we'd want to design around.

Implication confirmed: any spawn-state capture for sub-agents MUST go through plugin-level `PreToolUse:Agent|Task` + `PostToolUse:Agent|Task` hooks (already empirically present at `hooks/hooks.json:175-183`).

---

## P3 — Anthropic API beta header probe

**Goal**: Empirically verify the 3 beta header strings + the gating behavior (Dreams API expected to return 403 for non-managed-agents access).

**Method** (3 curl probes against `api.anthropic.com`):
| # | Beta header | Endpoint / minimal payload | Expected |
|---|---|---|---|
| a | `memory_20250818` | Messages API w/ memory tool | 200 or "feature not enabled" body |
| b | `context-management-2025-06-27` | Messages API w/ `context_management.edits[].type = clear_tool_uses_20250919` | 200 or behavior note |
| c | `managed-agents-2026-04-01,dreaming-2026-04-21` | Dreams API endpoint | 403 "research preview / access required" |

API key from `$ANTHROPIC_API_KEY` env (do NOT inline). Record HTTP status + body excerpt (first ~200 chars; redact any tokens).

**Status**: 🚫 **BLOCKED** at probe time (2026-05-24). The Claude Code CLI authenticates via session token, not the `ANTHROPIC_API_KEY` env var; `echo $ANTHROPIC_API_KEY` returned empty. Two unblock paths:
1. **Export key in this session** (`export ANTHROPIC_API_KEY=sk-ant-...`) — then re-run probe inline.
2. **Defer to fresh CC session** — recommended in the kickoff plan anyway for Wave B+. Fresh session can be launched with the env var set.

**Results**: _(pending unblock)_

**Verdict**: _(pending unblock)_

---

## P4 — Delta storage budget measurement

**Goal**: Empirical baseline for `git stash create` delta size — informs Phase 2 retention defaults.

**Method**:
- 10 sub-agent spawns of varying scope (small edit / large refactor / multi-file change)
- For each: `git stash create` BEFORE; spawn runs; `git stash create` AFTER; `git diff <pre> <post> | wc -c`
- Tabulate: spawn description / scope class / byte size

**Acceptance**: p50 + p99 sizes documented; retention defaults confirmed or refined.

**Results**: _(pending)_

**Verdict**: _(pending)_

---

## P5 — GC-Process vs GC-Spawn split fixture

**Goal**: Empirically confirm the architect's C1-GC LIVE catch — that Agent/Task spawns are NOT separate OS processes, forcing the GC split.

**Method**:
- (a) Bash tool task running `sleep 60` — find PID via `ps`; confirm `kill -9` works
- (b) Agent/Task long-running spawn — search for any new PID; confirm NONE exists (in-process LLM invocation)
- (c) Recovery semantics check: Bash kill = process gone; Agent timeout = parent marks `child_timed_out` only

**Acceptance**: fixture transcript proves the split is real.

**Results**: _(pending)_

**Verdict**: _(pending)_

---

## P-Proto — Prototype hook + one-persona extension

**Goal**: Working `hooks/scripts/spawn-record.js` that captures one real spawn record at `~/.claude/spawn-state/<run_id>/`.

**Route**: HETS-routed — pair architect + node-backend; code-reviewer post.

**Bounded outputs**: `swarm/run-state/v3.0-phase1-proto/node-actor-{architect,node-backend,code-reviewer}-{name}.md`

**Acceptance**: real spawn record on disk with valid axioms + attestations structure; YAML lints; round-trip read works.

**Results**: _(pending — Wave C)_

---

## P-Persona — `04-architect` `state_interface` field

**Goal**: Add `state_interface` field per RFC §"Persona contract additions" to `swarm/personas-contracts/04-architect.contract.json`.

**Route**: HETS-routed — architect (self-modifying) + code-reviewer.

**Acceptance**: architect spawns correctly with new field; existing contract-verifier still passes.

**Results**: _(pending — Wave C)_

---

## P-Recall — `loom recall` CLI (L_global only)

**Goal**: `scripts/loom-recall.js` with `recall <topic>` over `~/.claude/library/sections/` artifacts; keyword + tag + surface overlap; top-K=3.

**Route**: ROOT-direct (deterministic; spec in RFC).

**Acceptance**: returns 3 results for 10 sample queries; results are real artifact paths.

**Results**: _(pending — Wave C)_

---

## P-Measure — Blind hit-rate evaluation

**Goal**: Validate recall demand signal — does the 3-tuple ranker beat random selection from the same corpus?

**Method**:
- 10 real recent task descriptions from past 30 days of session history
- For each: `loom recall <topic>` AND 3 random library artifacts
- Operator rates each blind to source: "useful: Y/N"
- Hit-rate: `useful_recall / (useful_recall + useful_random)`

**Acceptance**: ≥50% = pass; <50% = architecture re-think.

**Results**: _(pending — Wave D)_

---

## Phase 1 exit checklist (for resuming session)

ALL must be green before opening Phase 2:
- [ ] P1 envelope quantified (avg semantic-similarity across 5 fixtures)
- [ ] P2 plugin-hook-ban verified (or refuted — architecture adjusts either way)
- [ ] P3 API beta headers tested (3 documented responses)
- [ ] P4 delta budget measured (p50 + p99 written to retention defaults)
- [ ] P5 GC split confirmed (fixture transcript)
- [ ] Prototype hook works end-to-end on real spawn (P-Proto)
- [ ] `04-architect` `state_interface` field landed (P-Persona)
- [ ] `loom recall` returns real results on 10 queries (P-Recall)
- [ ] Hit-rate ≥50% (P-Measure)

---

**RESUME HERE** (2026-05-24, Wave A close):

Wave A delivered:
- ✅ **P2 PASS** — Anthropic plugin reference confirms hooks/mcpServers/permissionMode unsupported for plugin-shipped agents. Parent-records pivot validated.
- ✅ **P1 PASS (with caveat)** — semantic equivalence holds across re-spawns at default temp; f3 byte-identical; stochastic-sample "regenerable" claim supported.
- 🚫 **P3 BLOCKED** — needs `ANTHROPIC_API_KEY` env var. Resume by either (a) exporting key in fresh shell + running 3 curl probes, or (b) using `claude --bare --betas memory_20250818 -p ...` style invocation if Bare mode + API key arrangement works.

Wave B+C+D next (fresh CC session recommended for HETS work in Wave C):
1. **P4** — 10 spawns × `git stash create` pre/post; tabulate delta byte sizes; compute p50/p99. ~3h.
2. **P5** — Bash `sleep 60` kill + Agent/Task PID-search fixtures. ~2h.
3. **P-Proto** — HETS-routed (architect + node-backend pair → `hooks/scripts/spawn-record.js`; code-reviewer pair-review). ~4h. **First HETS spawn of v3.0 work**; benefits maximally from fresh context.
4. **P-Persona** — extend `swarm/personas-contracts/04-architect.contract.json` with `state_interface`. ~1h.
5. **P-Recall** — `scripts/loom-recall.js` over `~/.claude/library/sections/`. ~2h.
6. **P-Measure** — blind hit-rate over 10 recent task descriptions. ~2h.

Branch state on resume: `feat/v3.0-phase-1-verification-spike` (off `main @ e60f2f9`); no-merge regardless of outcome.

No load-bearing RFC claim has been refuted by Waves A's probes. The v3.2 architecture remains intact.
