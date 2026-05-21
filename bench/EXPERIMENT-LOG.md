# HETS Methodology Experiment — Baseline vs TDD

## Hypothesis

**TDD methodology (write failing test first → fix until green) improves HETS reliability** for agent-prompt and substrate changes, measured by:
- Lower rework loops (architect's first fix proposal accepted vs needing revision)
- Higher code-reviewer first-pass acceptance rate
- Fewer regressions introduced

## Experiment design

| Group | Approach | This branch |
|---|---|---|
| **Baseline (no TDD)** | Agents fix gaps using normal workflow; reviewer validates against unit tests | THIS WORK |
| **Treatment (TDD)** | Agents instructed to write failing test first, then fix to green | Future branch |

## Decision criteria for codifying TDD-by-default rule

The rule lands in `rules/core/workflow.md` IFF either:
- Baseline group needed ≥2× the rework loops the TDD group needed, OR
- TDD group caught a class of bug the baseline group missed entirely

Otherwise, document as "use TDD when convergence_value > X" (advisory, not always-on).

---

## BASELINE measurements (fix/headless-compliance-gaps branch)

### Setup
- **Branch**: `fix/headless-compliance-gaps` (off main)
- **Date started**: 2026-05-20
- **Plugin version at start**: v2.2.0
- **Unit test substrate**: `tests/unit/agents/` (new in this branch)
- **End-to-end verification**: `bench/runner.sh` (from PR #134 branch; pre-merge)

### GAP-A — KB consultation not surfacing

**Pre-fix state**: `tests/unit/agents/architect.test.js` → 6/7 PASS, 1 FAIL  
**Failing assertion**: "definition specifies an output contract for KB citations (e.g. `## KB Sources Consulted` section)"  
**Bench soft signal**: `kb_consultation: no` (sub-agent reviews contain 0 `kb:` refs)

**Workflow**:
1. Architect spawn — root-cause + fix proposal
2. Builder (root) applies fix
3. Code-reviewer spawn — validate against unit test
4. Re-run unit test + bench

**Metrics to record**:
- Architect spawn 1: tokens, wallclock, useful fix proposal? (Y/N)
- Builder iteration count to satisfy reviewer
- Code-reviewer catch count (issues flagged in builder's work)
- Final unit test outcome (PASS/FAIL)
- Final bench signal outcome (YES/no)
- Total rework loops

| Metric | Value |
|---|---|
| Architect spawn count | 1 (21,806 tokens / 57.9s) |
| Code-reviewer spawn count | 2 (iter1: 21,001 tok/69.3s — 5 catches; iter2: 15,217 tok/16.6s — APPROVE) |
| Builder iterations | 2 |
| Code-reviewer catches | 1 HIGH + 2 MEDIUM + 1 LOW + 1 NIT (1 MEDIUM deferred to separate scope re: F5 contract relationship) |
| Rework loops | 1 substantive |
| HETS total tokens | 58,024 |
| HETS total wallclock | 143.8s |
| Unit test final state | 7/7 PASS (was 6/7 pre-fix) |
| Bench signal final state | TBD (verify after all 3 gaps complete) |

**Observations**:
- Architect's self-diagnosis was crisp — identified the ADR-conditional bypass as root cause within 58s
- Code-reviewer's iter-1 catches were substantive: the HIGH finding (under-constrained meta-fix carve-out + untested behavioral path) was a real correctness issue the architect missed
- Code-reviewer's iter-2 confirmation pass was 3.5× cheaper in tokens and 4× faster — short-context validation runs efficiently
- Self-aware moment: code-reviewer iter-2's `Sources:` section used file paths (the carve-out for agent-definition meta-fixes) instead of kb: refs, demonstrating it understood the new contract's exception clause

### GAP-B — Plan mode never enters in headless

**Workflow**: architect spawn for root-cause; builder applies rule rewrite + bench detector update; code-reviewer SKIPPED (low-risk text+detector change; observation captured below as baseline variant).

| Metric | Value |
|---|---|
| Architect spawn count | 1 (65,371 tokens / 109.3s) |
| Code-reviewer spawn count | 0 (skipped — low-risk text rewrite + detector update; risk profile incompatible with full HETS pair) |
| Builder iterations | 1 |
| Code-reviewer catches | n/a (skipped) |
| Rework loops | 0 |
| Outcome | **MIXED FIX**: (a) rule rewrite in workflow.md decouples intent from mechanism; (b) bench detector update accepts TodoWrite-with-≥2-items + plan-file as equivalent signals; (c) NO platform limitation found — `EnterPlanMode` IS in headless tool registry; the model just rationally substituted with TodoWrite |
| Bench signal final state | YES (TodoWrite 4 calls / 7 items max recognized as planning artifact) |

**Architect's hypothesis verdicts** (all refuted with direct stream-json evidence):
- H1 (platform limitation) → **REFUTED**: `EnterPlanMode` IS in `init` event tool registry
- H2 (permission gating) → **REFUTED**: tools accessible under `bypassPermissions`
- H3 (instruction-following gap) → **CONFIRMED WITH REFINEMENT**: model satisfied intent (planning), skipped literal tool
- H4 (skill loading) → **REFUTED**: `/plan` + planner agent both loaded in headless

**Key insight**: GAP-B was a SIGNAL-DETECTION gap, not a BEHAVIOR gap. Claude was planning all along via TodoWrite (the headless-appropriate mechanism); the bench detector was only looking for one specific tool call. Rule rewrite makes this explicit; detector update recognizes the actual artifact.

**Baseline variant noted**: code-reviewer was skipped for this gap because the fix is low-risk (rule text + detector regex). This is itself a baseline observation worth noting: **not every HETS workflow requires a code-reviewer pass**. The TDD-treatment experiment should match: low-risk fixes get the same skip treatment to keep the comparison fair.

---

## Cross-gap observations (worth noting before TDD-treatment experiment)

### Variance in GAP-A's fix effectiveness

Three bench runs post-fix produced different kb_consultation results:
- Run 1 (2026-05-20T21:51, pre-fix): `no` (0 kb refs) — baseline
- Run 2 (2026-05-20T22:48, post-fix): `YES` (9 kb refs; architect spawned as `power-loom:architect`)
- Run 3 (2026-05-20T23:01, post-fix): `no` (0 kb refs; architect spawned as `architect` unqualified)

**Interpretation**: instruction-following is stochastic. Even with explicit "MUST include `## KB Sources Consulted`" in the architect definition, the model sometimes skips it (~50% in this small sample). The fix improves probability significantly (0/N → ~50/50) but is NOT deterministic. The subagent_type difference (prefixed vs unprefixed) may correlate but is hard to isolate without more runs.

**Implication for future GAP-D**: deterministic enforcement requires a PostToolUse hook on the Agent tool that inspects the returned content for the required section. Out of scope for this branch but a logical next step.

**Implication for TDD-treatment experiment**: if TDD wins on rework loops but produces the same variance in fix-effectiveness, the methodology comparison should weight that. Maybe TDD's benefit isn't reducing variance but catching it sooner.

### Plugin install propagation

Editing `~/Documents/claude-toolkit/` doesn't propagate to live plugin behavior. The actual install path is `~/.claude/plugins/cache/power-loom-marketplace/power-loom/<version>/`. During iteration, manual sync was required. End-users would run `/plugin update` to pick up new ships. This is worth a ship-notes mention in v2.3.0.

### GAP-D — deterministic KB-citation enforcement via PostToolUse hook (added post-GAP-A variance discovery)

After GAP-A's variance was documented, added a PostToolUse:Agent|Task hook that fixes the probabilistic-instruction-following gap deterministically.

**Implementation**: `hooks/scripts/kb-citation-gate.js`. After each sub-agent spawn for a KB-required agent (currently just `architect`; extensible), inspects the tool_response for `## KB Sources Consulted` section AND ≥1 `kb:` ref. If non-compliant, emits `decision: block` with a `[KB-CITATION-MISSING]` forcing instruction. Parent Claude sees the reason, re-spawns the agent with explicit KB reminder.

**End-to-end verification** (bench run 2026-05-20T23:15):
```
kb-citation-log for this session:
  call 1: type=architect  section=False refs=0  compliant=False  ← BLOCKED
  call 2: type=architect  section=True  refs=4  compliant=True   ← re-spawn succeeded
```

Bench result: **kb_consultation YES with 32 kb refs** (vs prior 0 or 9). The variance is gone — first attempt skip → block → re-spawn → compliance.

**Cost**: 1 extra architect spawn per session where the model skips KB on first try (~half of runs based on prior variance). Acceptable.

**Side effect observed**: this run did NOT have TodoWrite calls (plan_mode_evidence: no). Possibly because the re-spawn workflow ate the "natural" TodoWrite that would have otherwise fired. Variance — worth more runs to characterize.

**Hook bug caught during testing**: `logger.warn(...)` does NOT exist — `_log.js` returns a callable, called as `logger('event-name', { detail })`. Both `kb-citation-gate.js` and the prior `route-decide-on-agent-spawn.js` had this bug (in catch paths, so silent in normal flow). Both fixed.

### Agent name prefixing affects routing

Plugin-prefixed `power-loom:architect` and unprefixed `architect` both resolve to the same definition file (verified: only one architect.md exists in the plugin's agents/ dir + the install path). But the subagent_type captured in the stream differs across runs. May affect plugin-version dispatch in edge cases. Worth investigating if more variance shows up.

### GAP-C — route-decide.js never invoked before sub-agent spawn

**Workflow**: root-do (no HETS spawn — answer is obviously a missing PreToolUse hook). NOT a baseline data point for the HETS experiment; just gets it shipped.

| Metric | Value |
|---|---|
| Implementation approach | PreToolUse hook on `Agent\|Task` tools → auto-invokes `route-decide.js`, logs verdict to `~/.claude/checkpoints/route-decide-log.jsonl` |
| Files added | `hooks/scripts/route-decide-on-agent-spawn.js` (~165 LoC), entries in `hooks/hooks.json` + `hooks/settings-reference.json` |
| Bench detection update | `bench/collect.js` reads route-decide-log; filters by session_id |
| Bench signal final state | YES (3 hook hits + 1 Bash hit for the verification session) |
| Outcome | FIX — deterministic enforcement via PreToolUse hook |

**Side findings while shipping**:
- Plugin install isolation surfaced: editing `~/Documents/claude-toolkit/hooks/hooks.json` doesn't propagate to live plugin behavior; the actual install path is `~/.claude/plugins/cache/power-loom-marketplace/power-loom/<version>/`. Required syncing the hook files to that path. Users would update via `/plugin update` in normal flow.
- Even before the hook landed, the latest bench run showed Claude DID consult route-decide via Bash (1 Bash hit). The hook adds 3 more deterministic hits, but instruction-following was working too in this run — variance worth noting (the prior run had 0 Bash hits).
- Sub-agent type names now appear as `power-loom:architect` etc. (plugin-prefixed) after the install sync — confirms plugin reload picked up correctly.

---

## Aggregate baseline (after all 3 gaps)

| Total metric | Sum |
|---|---|
| Architect spawns | TBD |
| Builder iterations | TBD |
| Code-reviewer catches | TBD |
| Rework loops | TBD |
| Tokens spent on HETS | TBD |
| Wallclock on HETS | TBD |

These become the **comparison baseline** for a future TDD-treatment experiment.

---

## Future TDD-treatment experiment (not in scope here)

When run, follow the SAME 3-gap structure (or pick 3 new gaps of comparable complexity) with the SAME validation mechanism (unit tests + bench). The only variable changed: agents are explicitly instructed to "write the failing unit test first; then fix until it passes."

If TDD treatment beats baseline by the decision criteria above, codify the rule.

---

## TDD-treatment data point — v2.6.0 GAP-F signal redesign (2026-05-21)

**Why this one is the treatment data point**: substantive redesign of a substrate hook's core signal (from `fs.statSync(transcript_path).size` to `parseLastUsageBlock(transcript_path)` returning summed `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`). Existing v2.5.0 tests describe the OLD bytes-based behavior; the redesign will invalidate some of them. Perfect setup for strict TDD: write failing tests for new behavior FIRST, then implement to green.

**User callout** (this turn): "where are we with our TDD experiment. I don't see it applies since a long time" — honest accounting: baseline captured v2.3.0; v2.4.x/v2.5.x all shipped tests-alongside (not tests-first); treatment side of experiment had been collecting dust for ~10 days. v2.6.0 is the first explicit TDD-treatment ship.

### Setup

- **Branch**: `feat/gap-f-redesign-token-signal` (off main at ed713c7 / v2.5.1)
- **Date started**: 2026-05-21
- **Plugin version at start**: v2.5.1
- **Baseline comparison points**: v2.5.0 (GAP-F initial, non-TDD) + v2.5.1 (GAP-G, non-TDD)
- **TDD discipline contract**: tests MUST fail before any impl change; impl writes the MINIMUM needed to make tests pass; no tests added in the impl phase

### What we're replacing

**Signal source** — `fs.statSync(transcript_path).size`:
- Architect's "800KB ≈ 200K-token window" estimate was off by ~500×
- Real transcripts: 100KB (short bench task) → 387MB (this long session)
- File grows monotonically across `/compact` (append-only history); not a context-window proxy

**Replacement** — `parseLastUsageBlock(transcript_path)`:
- Read last ~50KB of file; walk backwards through JSONL
- Find most recent assistant message with `message.usage`
- Sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
- Empirically verified on this session: `200725 + 863 + 1 = 201589` tokens (right at the 200K window cap)
- Thresholds: WARN=100K (50%), URGENT=160K (80%)

### Metrics to capture during the experiment

| Metric | Definition |
|---|---|
| Tests written before impl (T1) | Count of test cases in the new test file BEFORE any production code change |
| Tests that initially fail | Subset of T1 that fails against current v2.5.1 impl |
| Architect spawn count | Wall-clock + tokens per architect call |
| Builder iterations to all-green | Number of edits to the impl file before all T1 tests pass |
| Code-reviewer catches | Distinct issues raised by code-reviewer in pair-review |
| Code-reviewer iterations | Reviewer spawn count before APPROVE |
| Tests added during impl phase | If > 0, TDD discipline violation — captured for honesty |
| Final test count | All tests in file at PR-ready state |
| Final unit test outcome | PASS / FAIL |
| Final bench outcome | scenario 04 still passes; new bench detection if any |
| Rework loops | Total round-trips between builder and reviewer (≥1 catch round-trip) |

### Decision criteria (from above; restated)

TDD codified in `rules/core/workflow.md` IFF either:
- Baseline group needed ≥2× the rework loops the TDD group needed, OR
- TDD group caught a class of bug the baseline group missed entirely

Otherwise: advisory rule ("use TDD when convergence_value > X") in workflow.md.

---

## Variance characterization — scenario 01, 3-run sample (v2.4.0 follow-up D)

Captured 2026-05-21 to bound the soft-signal variance observed in v2.3.0+v2.4.0.

| Run | Wallclock | Turns | Out tokens | Cache read | Spawns | Tests added | kb_consultation | 10/10 PASS? |
|---|---|---|---|---|---|---|---|---|
| 1 | 424s | 25 | 17,963 | 1.07M | 2 | 20 | no | YES |
| 2 | 357s | 27 | 18,528 | 1.37M | 2 | 27 | no | YES |
| 3 | 411s | 36 | 19,145 | 1.74M | 2 | 16 | no | YES |
| **mean** | **397s (~6.6 min)** | **29.3** | **18,545** | **1.39M** | **2.0** | **21.0** | **0/3 YES** | **3/3** |
| **range** | 67s | 11 | 1,182 | 671K | 0 | 11 | — | — |

### Observations

**Stable across runs**:
- **Sub-agent spawn count is rock-solid at 2** (architect + code-reviewer). Both auto-trigger reliably for this task shape.
- **Output tokens are very consistent (~18.5K ± 0.5K)** — variance ~3% — meaning the architect + code-reviewer + final implementation produce similar-sized work each time.
- **All 10 deterministic checks PASS every run**. The fix (cli.js + test + README) lands every time.

**Variant across runs**:
- **Wallclock varies ~15-20%** (357-424s, range 67s). Likely Anthropic API latency variance, not task variance.
- **Turn count varies more (25-36, range 11)**. Suggests Claude takes different paths through the task — sometimes more iterative file edits, sometimes more upfront planning.
- **Test count varies 16-27** — Claude elaborates the test suite differently each time.
- **Cache read grows across consecutive runs** (1.07M → 1.37M → 1.74M) — looks like Anthropic's API cache warming up across the sequence.

### MAJOR FINDING — GAP-D's PostToolUse block enforcement is broken

**All 3 runs**: `kb_consultation: no` (0 kb refs); but `kb-citation-log.jsonl` shows the hook DID fire and recorded all 3 architect spawns as `compliant=False`.

If the block-and-retry mechanism worked:
- Hook would emit `{decision: block, reason: "[KB-CITATION-MISSING] ..."}`
- Parent Claude would see the reason and re-spawn the architect
- Total architect spawns per run would be 2-3 (initial + retry)

But what we observe:
- Hook fires once per architect spawn → records non-compliance
- Total spawns = 2 (architect + code-reviewer), exactly the expected baseline
- Architect tool_result has `is_error: false` → block didn't convert it to error
- Stream contains 0 occurrences of `KB-CITATION-MISSING` → forcing instruction never reached parent
- Architect response doesn't include `## KB Sources Consulted` or `## Requirements Checklist` either (both contracts ignored in these 3 runs)

**Hypothesis**: `PostToolUse` hook `decision: block` semantics differ from `PreToolUse` block. PreToolUse blocks the tool from running and injects the reason. PostToolUse… apparently doesn't inject the reason in a Claude-visible way under v2.1.140. Needs research with `claude-code-guide` before fixing.

**Implication**: The "deterministic" enforcement we celebrated for GAP-D is actually probabilistic instruction-following PLUS a hook that logs but doesn't enforce. The earlier success cases (kb_consultation: YES with 9-32 refs) were the model coincidentally following the architect.md instruction, NOT the hook forcing re-spawn.

### Interpretation

The bench harness's PRIMARY value is observability — it correctly surfaced this enforcement gap. Before D, we believed GAP-D worked deterministically; the 3-run sample proves otherwise.

**This is itself a finding worth flagging as GAP-E**:
- Title: PostToolUse:Agent decision:block forcing instruction doesn't propagate to parent in headless `-p` mode
- Fix candidates:
  - (a) Switch to PreToolUse on `Agent`'s NEXT tool call by detecting non-compliance state — but PreToolUse doesn't have access to the previous result, complicated
  - (b) Use `stopReason` field in PostToolUse output to halt the session — research needed
  - (c) Accept that PostToolUse:Agent can only OBSERVE, not ENFORCE — and rely on instruction-following with multi-attempt strategies (e.g., add the contract instruction to the SUBAGENT'S prompt at spawn time)
- v2.4.0 ships with this documented; v2.4.1 or v2.5 addresses it

The honest bench report:
- `kb_consultation` IS probabilistic (0/3 in this sample; was 1/3 or 2/3 in earlier samples)
- The PostToolUse hook FIRES reliably but its enforcement decision is ignored by Claude Code
- Plugin behavior is well-characterized; enforcement-gap is documented; fix is a separate scope
