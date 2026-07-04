# Plan — spawn-record.js records the async launch-ack as the completion (follow-up 2 of #508)

- **Date**: 2026-07-04
- **Branch**: `fix/spawn-record-async-stub-blindness` (off fresh `origin/main` @ `a93fc77`)
- **Files**: `packages/kernel/spawn-state/spawn-record.js` + `tests/unit/kernel/spawn-state/spawn-record.test.js` (2)
- **Class**: kernel Phase-1 prototype (L_spawn provenance capture). NON-enforcing, fail-soft, additive schema.

## Problem (surfaced as F6a in the #509 architect VERIFY)

`spawn-record.js` captures a provenance envelope on every `PostToolUse:Agent|Task`.
For an ASYNC spawn, `tool_response` is the launch-ACK stub
(`{isAsync:true, status:'async_launched', prompt:<echoed>, …}`), which has no
`.text`/`.content` — so `extractResultText` (`:184-203`) falls through to
`JSON.stringify(toolResponse)` (`:200`), and `buildEnvelope` (`:315,:370-374`)
stores that stringified launch-ack as `bounded_output.completion_sha256`,
`completion_chars`, and the `excerpt_head/tail`. The provenance "completion" for
every async spawn is therefore the **launch ack (dominated by the echoed prompt),
not the sub-agent's response** — the real completion arrives out-of-band via a
task-notification and never re-fires PostToolUse (the #508 finding). Same
async-stub blindness as the kb-citation-gate had, but here it silently mis-labels
provenance rather than blocking.

## Runtime Probe
- Same firsthand evidence as #508: 193 on-disk async-launch spawn-records whose
  `excerpt_head` is `{"isAsync":true,"status":"async_launched",…,"prompt":…}` and
  whose `completion_chars` (3-8KB) is the echoed prompt, not a response.
  (`~/.claude/spawn-state/*/spawn-*.json`.)

## Fix (honest capture — additive, backward-compatible)

Detect the async-launch stub and record HONESTLY instead of capturing the ack:

- Add a duplicated `isAsyncLaunchStub(toolResponse)` (format-shape detector,
  matching the file's deliberate-duplication convention for `extractResultText`;
  a comment cross-refs the canonical `kb-citation-gate.js` definition).
- In `buildEnvelope`: compute `asyncLaunch` first; when true, do NOT
  extract/scrub/excerpt the stub, and emit a `bounded_output` that says so:
  `{completion_sha256:null, completion_chars:null, excerpt_head:'', excerpt_tail:'',
    scrubbed:false, completion_captured:false, capture_phase:'async-launch',
    agent_id:<stub.agentId|null>}`. The `agent_id` is the correlation key for a
  FUTURE SubagentStop-based capture — **firsthand-grounded**: the SubagentStop
  payload carries a top-level `agent_id` equal to the spawn's launch `agentId`
  (verified in the #509 SubagentStop probes — the sync spike showed
  `SubagentStop.agent_id === PostToolUse tool_response.agentId`). The consumer that
  joins on it is NOT yet wired (deferred); the field is stored optimistically, not
  a live join.
- The completed (sync) path is unchanged for a REAL completion, plus two markers:
  `completion_captured` = (real text captured?) and `capture_phase` =
  `'completed'` / `'completed-empty'`. An EMPTY completed close reads
  `completion_captured:false` + `'completed-empty'` (honest — a consumer keying on
  `captured:true` never sees a 0-char "completion").

`null` (not `0`/`''` alone) + the explicit `completion_captured:false` disambiguate
"not captured (async launch)" from "captured an empty real completion" — the same
null-not-false honesty as #508.

**SCHEMA_VERSION stays `v1`.** The new fields (`completion_captured`,
`capture_phase`, `agent_id`) are additive/backward-compatible (old walkers ignore
them; old records lack them). NOTE: the async path also **corrects the VALUES** of
existing fields (`completion_sha256`/`completion_chars`/`excerpt_*` for async
records go from the mis-recorded ack to null) — a semantic correction, not purely
additive; but that is the fix (the old async values were wrong), and no reader
keyed on the ack-derived async fingerprint as meaningful.

## Test plan (TDD)
Add to `spawn-record.test.js` (uses the exported `__test__.buildEnvelope` directly):
1. Async-launch stub tool_response → `bounded_output.completion_captured===false`,
   `capture_phase==='async-launch'`, `completion_sha256===null`,
   `completion_chars===null`, and the echoed prompt is NOT in `excerpt_head`
   (the bug: prompt must not leak into the completion fingerprint).
2. Completed (sync) tool_response `{status:'completed',content:[{text}]}` →
   `completion_captured===true`, `capture_phase==='completed'`, real excerpt + sha.
3. `agent_id` correlation captured on the async record.
Re-run the full spawn-record suite (must stay green — additive change).

## VALIDATE result

**Real-payload dogfood** (real hook binary via stdin, real async-stub shape): async
stub → `completion_captured:false`, `capture_phase:'async-launch'`, `agent_id`
captured, and the echoed prompt does NOT leak anywhere in the on-disk envelope ✅.
Sync completed → `completion_captured:true`, `capture_phase:'completed'`, real
excerpt ✅. Suite 26/26 + spawn-record-a6 7/7; kernel 117/117; eslint/doc/markdown clean.

**2-lens VALIDATE**: code-reviewer APPROVE (2 harmless NITs). honesty-auditor
APPROVE-WITH-CHANGES (Grade B) — confirmed the bug against a REAL on-disk record
(the echoed HACKER prompt was the recorded "completion"). Folded: (MEDIUM) the
`agent_id`-correlation comment now CITES the #509 firsthand probe instead of
asserting the SubagentStop payload shape bare (the referenced #508 plan had marked
it UNDOCUMENTED — pre-probe); (LOW) empty sync response now reads
`completion_captured:false` + `'completed-empty'` (was contradictory `true`+0-chars)
plus a regression test; (LOW) SCHEMA_VERSION framing refined (async path is a value
correction, not purely additive).

## Not in scope
- Capturing the real async completion into the provenance envelope (that needs the
  SubagentStop `last_assistant_message` / `agent_transcript_path` wired into
  spawn-state, joined on the `agent_id` stored here — a larger enhancement; this PR
  only stops MIS-recording the ack).
