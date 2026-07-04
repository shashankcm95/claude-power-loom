# Plan — kb-citation-gate false-fires on ASYNC architect spawns

- **Date**: 2026-07-04
- **Branch**: `fix/kb-citation-gate-async-stub` (off fresh `origin/main` @ `2de2b31`)
- **Files**: `packages/kernel/hooks/post/kb-citation-gate.js` + `tests/unit/hooks/kb-citation-gate.test.js` (2 files)
- **Class**: kernel hook (enforced layer) — full rigor, but the gate itself is **fail-soft / advisory-block** (not a security/auth/data-mutation control), so the review tier is architect VERIFY + code-reviewer/honesty-auditor VALIDATE (not the mandatory 3-lens security tier).

## Problem

`kb-citation-gate.js` (PostToolUse:Agent|Task) blocks EVERY `architect` spawn with
`[KB-CITATION-MISSING] ... found section=no, kb_refs=0`, even when the architect's
actual completed response is fully KB-grounded. Observed on two fully-grounded
architect spawns in one session (2026-07-04). The gate forces a re-spawn loop that
hits the same false-positive, or forces a bypass.

## Root cause — the reported hypothesis was WRONG; verified firsthand

The task hypothesized the hook checks a `"Async agent launched successfully..."`
string stub. **The real cause is different** (runtime-claim-probe discipline: the
stated premise did not survive contact with the evidence).

When an Agent is launched async (`run_in_background`, now the background-launch
default per the Claude Code sub-agents doc — external, doc-consult not repo-probe;
the STUB SHAPE below is the firsthand-verified part), the
IMMEDIATE `tool_response` the PostToolUse hook receives is a structured
launch-acknowledgment OBJECT, not the agent's response:

```json
{"isAsync":true,"status":"async_launched","agentId":"a0c475929aa3971ff",
 "description":"VERIFY: architect lens on R0 plan","resolvedModel":"claude-opus-4-8",
 "prompt":"<the ENTIRE prompt echoed back>","outputFile":"…/tasks/<agentId>.output",
 "canReadOutputFile":true}
```

This object has **no `.text` / `.content` field**, so `extractResultText()` falls
through to `JSON.stringify(toolResponse)` — stringifying the whole object, dominated
by the echoed-back `prompt`. That is why the gate log shows `result_length` of
3000–8000 chars (the prompt), NOT a ~50-char stub. The gate then scans that
launch-ack JSON for `## KB Sources Consulted`, finds none (it is a launch ack), and
blocks. `kb_refs_count` is occasionally 1 because the echoed prompt sometimes
contains a literal `kb:` ref — never the required section.

## Runtime Probes (firsthand — against the real repo + real spawn-state on disk)

| Claim | Probe | Result |
|---|---|---|
| Async stub shape | `~/.claude/spawn-state/*/spawn-*.json` excerpt_head of architect records | `{"isAsync":true,"status":"async_launched","agentId":…,"prompt":…,"outputFile":…,"canReadOutputFile":true}` — no `.text`/`.content` |
| Stub is what the gate scans | `kb-citation-log.jsonl` tail: architect entries `result_length` 3000–8000, `has_kb_section:false` | Confirms gate scanned the stringified stub, not a ~50-char string |
| PostToolUse re-fires on async completion? | Cross-ref 193 async-launch `agentId`s vs resolver-journal `agentId`s with `observed_status=completed` | **INTERSECTION = 0** (async ∩ resolver-all = 0; async ∩ resolver-completed = 0) |
| Real completion ever reaches a spawn-record? | Search all spawn-records whose excerpt references an async `agentId` with real content | **0** completion records reference an async agentId |
| Temporal corroboration | Real-prose architect records (`## ARCHITECT VERDICT…`) vs async stubs | Real prose = Jun 22–23 (sync era); stubs = Jun 30+ (async era) — clean behavior-change split |
| Completion event exists | `claude-code-guide` + `code.claude.com/docs` (hooks-guide.md:456, sub-agents.md:615) | `SubagentStop` fires "when a subagent completes"; PostToolUse implied single-fire-at-launch |
| SubagentStop as an enforcement vehicle? | Same docs | Payload shape **UNDOCUMENTED** (unknown if it carries response text / subagent_type); block capability **inferred advisory-only**; registers at project-level `.claude/settings.json`; plugin agents can't ship hooks (P2 probe, `spawn-record.js`) |

**Conclusion**: PostToolUse:Agent fires ONCE, at async launch, with the stub. It does
NOT re-fire at completion. The real response arrives out-of-band via a
task-notification, which is not a `tool_response` and triggers no PostToolUse. So the
gate — as a PostToolUse hook — can only ever see the launch stub for async spawns.

## Options considered

- **(a) skip stub, rely on PostToolUse re-fire at completion** — REJECTED: no re-fire
  exists (0/193 firsthand). Would silently never enforce and encode a false premise.
- **(b) move the check to `SubagentStop`** — DEFERRED (not in this PR): its payload is
  undocumented, it is inferred advisory-only (cannot block ⇒ cannot enforce the
  block-and-retry contract), it wires at a different surface, and plugin-shipped
  hooks are unsupported. Building kernel enforcement on an unprobed harness mechanism
  is the ADR-0012 trap (the inert `pre-spawn-tool-mask`). Needs its own firsthand
  probe + plan + PR.
- **(c) detect the async-launch stub and DO NOT block; log the coverage gap** — CHOSEN.

## Chosen fix (option c)

In `kb-citation-gate.js`, after confirming the tool is Agent/Task and the subagent is
KB-required, detect the async-launch stub and short-circuit to `approve`, appending a
distinct advisory log entry so the coverage gap is auditable (not silent):

```js
function isAsyncLaunchStub(toolResponse) {
  return !!toolResponse
    && typeof toolResponse === 'object'
    && !Array.isArray(toolResponse)
    && (toolResponse.status === 'async_launched' || toolResponse.isAsync === true);
}
```

- Discriminator precedence: `status === 'async_launched'` is unique to the launch
  stub (a completed spawn carries `status === 'completed'`); `isAsync === true` is a
  secondary confirmation. Either triggers the skip (robust to one field being dropped).
- On detection: append `{ disposition: 'skip-async-launch-stub', async_launch: true,
  compliant: null, … }` and `emit({decision:'approve'})`. `compliant:null` is honest
  — the response was NOT evaluated (not judged compliant).

### Why this does NOT weaken the gate for the case it is meant to catch

The gate is meant to catch a genuinely KB-less architect **response**. It never could
catch that on the async path — it never sees the async response, only the launch
stub; every async block was a 100% false-positive on a launch ack, not a caught
KB-less response. The fix changes behavior ONLY for the async-launch stub. The
**sync** path (real string / `{content:[…]}` / `{text:…}` response) is untouched: a
KB-less sync architect response still blocks; a compliant one still approves. So real
enforcement (on the case the gate can see) is preserved exactly.

## Test plan (TDD)

Add to `kb-citation-gate.test.js` (regression guards; run against current impl first —
the async-stub tests must FAIL before the fix, PASS after):

1. `async-launch stub {isAsync:true,status:'async_launched',prompt:…}` for architect → **approve** (currently blocks).
2. `status:'async_launched'` alone (no `isAsync`) → **approve**.
3. `isAsync:true` alone (no `status`) → **approve**.
4. Stub whose echoed `prompt` contains a `kb:` ref and the literal text `## KB Sources Consulted` inside the prompt → **approve** (must skip on shape, not be fooled into a compliant-looking pass either way; the point is we do not evaluate the stub).
5. NON-regression — sync KB-less architect response (plain string / content array) → **block** (unchanged).
6. NON-regression — sync compliant architect response → **approve** (unchanged; existing T1/T2 still green).
7. Non-architect async stub (e.g. `general-purpose`) → **approve** via the existing subagent-not-required pass-through (skip ordering must not matter).

## Follow-up (separate task, NOT this PR)

Firsthand-probe `SubagentStop` (payload shape via a throwaway `claude -p` spike with a
capture hook + a real async subagent; block capability; plugin-registration). If it
reliably carries the final response + agent type and can block, a `SubagentStop`
kb-citation gate would RESTORE async enforcement. Until probed, do not build on it.

## Pre-Approval Verification (architect VERIFY — APPROVE-WITH-CHANGES, all folds applied)

Architect lens pressure-tested the design pre-build. Verdict APPROVE-WITH-CHANGES; every fold applied:

- **F2 (placement, MEDIUM)** — stub check pinned between the KB-required gate and
  `extractResultText` (after the `KB_REQUIRED_SUBAGENTS.has` early-return). Keeps the
  disposition log scoped to KB-contracted personas; non-architect async stubs still
  exit via the existing subagent-not-required pass-through (T20).
- **F3 + F6c (non-vacuous audit, LOW)** — added `LOOM_KB_CITATION_LOG_PATH` env
  override; tests now assert the skip-path log entry actually lands
  (`disposition:'skip-async-launch-stub'`, `compliant:null`). Also closes a
  pre-existing test-hygiene leak (tests were appending to the real
  `~/.claude/checkpoints/kb-citation-log.jsonl`).
- **F4 (log honesty, LOW)** — skip entry sets `has_kb_section`/`kb_refs_count`/
  `result_length`/`compliant` to `null` (not false/0): not-evaluated, not evaluated-and-failed.
- **F1 + F6b (discriminator, LOW)** — `isAsync === true` OR-branch relabeled as a
  DEFENSIVE fallback for an unobserved future stub (the only probed stub carries both
  fields); strict `=== true` is deliberate (a garbage `isAsync` fails toward evaluate, not skip).
- **F5 / SRP** — `isAsyncLaunchStub` is a pure predicate; its guard is adapted from the
  2-clause sibling guard at `spawn-close-resolver.js:249` (`!x || typeof x !== 'object'`),
  adding the `Array.isArray` exclusion so a content-array response is evaluated, not skipped.

## Tracked follow-ups (NOT this PR)

1. **SubagentStop async enforcement** (restores what async loses) — pending a firsthand
   probe of the SubagentStop payload + block capability + plugin-registration.
2. **`spawn-record.js` shares the same async-stub blindness** (F6a): its
   `extractResultText` (functionally-equivalent — differs only by a try/catch around the
   stringify) captures the stringified launch-ack (echoed prompt) as the
   "completion excerpt" / `completion_sha256` for every async spawn — provenance
   excerpts are the launch ack, not the response. It does NOT block anything (not
   KB-gated), so it is out of scope here; tracked so the next reader knows kb-citation
   was not the only victim.

## VALIDATE result

Real-payload dogfood (real hook binary via stdin, real async-stub shape):
- Real async stub → **approve** + honest audit (`skip-async-launch-stub`, null eval fields).
- Genuinely KB-less COMPLETED architect response → **block** (gate still enforces the catchable case).
- Compliant completed response → **approve**. Real `~/.claude/checkpoints` log untouched (hermetic override works).

Suite: 20/20 kb-citation-gate tests GREEN (11 pre-existing + 9 new); full `tests/unit/hooks/` suite GREEN; eslint clean.

## Drift Notes

- The reported bug premise ("checks the `Async agent launched successfully` string")
  was a plausible-but-wrong abstraction of the symptom; the firsthand spawn-state
  probe corrected it to the structured `async_launched` object. Reinforces
  runtime-claim-probe: probe the harness before coding the fix.
