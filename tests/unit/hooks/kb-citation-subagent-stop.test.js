#!/usr/bin/env node

// tests/unit/hooks/kb-citation-subagent-stop.test.js
//
// SubagentStop KB-citation gate — self-correcting enforcement (follow-up 1 of
// #508). Pipes SubagentStop envelopes through the hook binary via stdin and
// asserts the Stop-class output contract: allow-stop = {} (NO decision key);
// block = {decision:'block', reason}. Hermetic via LOOM_KB_CITATION_LOG_PATH.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/lifecycle/kb-citation-subagent-stop.js');
const POST_GATE = path.resolve(__dirname, '../../../packages/kernel/hooks/post/kb-citation-gate.js');
const TEST_LOG = path.join(os.tmpdir(), `kb-citation-substop-test-${process.pid}.jsonl`);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function clearLog() { if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG); }
function lastLog() {
  if (!fs.existsSync(TEST_LOG)) return null;
  const lines = fs.readFileSync(TEST_LOG, 'utf8').trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

function runBin(bin, envelope) {
  const r = spawnSync('node', [bin], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOKS_QUIET: '1', LOOM_KB_CITATION_LOG_PATH: TEST_LOG },
  });
  if (r.status !== 0) throw new Error(`hook exited non-zero: status=${r.status}, stderr=${r.stderr}`);
  try { return JSON.parse(r.stdout || '{}'); }
  catch (e) { throw new Error(`stdout not JSON: ${JSON.stringify(r.stdout)} (${e.message})`); }
}
function runHook(envelope) { clearLog(); return { out: runBin(HOOK, envelope), log: lastLog() }; }

// A realistic SubagentStop envelope (keyed on top-level agent_type + last_assistant_message).
function ss(overrides = {}) {
  return {
    hook_event_name: 'SubagentStop',
    agent_type: 'architect',
    agent_id: 'a0c475929aa3971ff',
    session_id: 'test-sess',
    stop_hook_active: false,
    last_assistant_message: 'Analysis with no KB section.',
    ...overrides,
  };
}
const COMPLIANT_MSG = 'Design review.\n\n## KB Sources Consulted\n- kb:architecture/crosscut/idempotency — anchor';

process.stdout.write('\n=== kb-citation-subagent-stop (self-correcting SubagentStop gate) ===\n');

// S1 (LOAD-BEARING): architect, KB-less, first fire → BLOCK with [KB-CITATION-MISSING]
test('S1: architect KB-less, stop_hook_active:false → block', () => {
  const { out, log } = runHook(ss());
  if (out.decision !== 'block') throw new Error(`expected block, got ${JSON.stringify(out)}`);
  if (!/\[KB-CITATION-MISSING\]/.test(out.reason || '')) throw new Error('reason must carry [KB-CITATION-MISSING]');
  if (!log || log.disposition !== 'subagent-stop-block') throw new Error(`expected subagent-stop-block log, got ${JSON.stringify(log)}`);
});

// S2 (F1): architect compliant → {} with NO decision key (Stop-class allow schema)
test('S2: architect compliant → {} (decision undefined, NOT approve)', () => {
  const { out, log } = runHook(ss({ last_assistant_message: COMPLIANT_MSG }));
  if (out.decision !== undefined) throw new Error(`Stop-class allow must be {} — decision must be undefined, got ${JSON.stringify(out)}`);
  if (!log || log.disposition !== 'subagent-stop-pass' || log.compliant !== true) throw new Error(`expected pass log, got ${JSON.stringify(log)}`);
});

// S3 (LOAD-BEARING F5): KB-less BUT stop_hook_active:true → allow ({}), loop guard
test('S3: KB-less + stop_hook_active:true → {} (loop guard, no second block)', () => {
  const { out } = runHook(ss({ stop_hook_active: true }));
  if (out.decision !== undefined) throw new Error(`loop guard must allow the stop on a re-fire, got ${JSON.stringify(out)}`);
});

// S4 (F2): non-architect (general-purpose) → {} (not KB-required)
test('S4: general-purpose async subagent → {} (not KB-required)', () => {
  const { out } = runHook(ss({ agent_type: 'general-purpose' }));
  if (out.decision !== undefined) throw new Error(`expected allow for non-architect, got ${JSON.stringify(out)}`);
});

// S5: plugin-prefixed power-loom:architect KB-less → block (normalization)
test('S5: power-loom:architect KB-less → block', () => {
  const { out } = runHook(ss({ agent_type: 'power-loom:architect' }));
  if (out.decision !== 'block') throw new Error(`expected block for plugin-prefixed architect, got ${JSON.stringify(out)}`);
});

// S5b (F6e): literal plugin:architect KB-less → block (the probed plugin form)
test('S5b: plugin:architect KB-less → block', () => {
  const { out } = runHook(ss({ agent_type: 'plugin:architect' }));
  if (out.decision !== 'block') throw new Error(`expected block for plugin:architect, got ${JSON.stringify(out)}`);
});

// S6 (F6b): empty last_assistant_message → {} + honest skip-empty log (compliant:null)
test('S6: empty last_assistant_message → {} + skip-empty log', () => {
  const { out, log } = runHook(ss({ last_assistant_message: '' }));
  if (out.decision !== undefined) throw new Error(`empty message must not block, got ${JSON.stringify(out)}`);
  if (!log || log.disposition !== 'skip-empty-message' || log.compliant !== null) throw new Error(`expected skip-empty log (compliant:null), got ${JSON.stringify(log)}`);
});

// S6b: missing last_assistant_message entirely → {}
test('S6b: missing last_assistant_message → {} (fail-soft, no block)', () => {
  const env = ss(); delete env.last_assistant_message;
  const { out } = runHook(env);
  if (out.decision !== undefined) throw new Error(`missing message must not block, got ${JSON.stringify(out)}`);
});

// S7: non-SubagentStop event → {} (defensive)
test('S7: non-SubagentStop event → {}', () => {
  const { out } = runHook(ss({ hook_event_name: 'Stop', last_assistant_message: 'no kb here' }));
  if (out.decision !== undefined) throw new Error(`non-SubagentStop event must pass through, got ${JSON.stringify(out)}`);
});

// S7b: malformed stdin → {} (fail-soft). Feed non-JSON directly.
test('S7b: malformed stdin → {} (fail-soft)', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json{{', encoding: 'utf8', env: { ...process.env, CLAUDE_HOOKS_QUIET: '1', LOOM_KB_CITATION_LOG_PATH: TEST_LOG } });
  if (r.status !== 0) throw new Error(`fail-soft must exit 0, got ${r.status}`);
  const out = JSON.parse(r.stdout || '{}');
  if (out.decision !== undefined) throw new Error(`malformed stdin must allow the stop, got ${JSON.stringify(out)}`);
});

// S8: numbered heading via the shared module → {} (compliant)
test('S8: numbered `## 7. KB Sources Consulted` → {} (compliant via shared module)', () => {
  const { out } = runHook(ss({ last_assistant_message: '## 7. KB Sources Consulted\n- kb:architecture/crosscut/idempotency' }));
  if (out.decision !== undefined) throw new Error(`numbered-heading compliant must allow, got ${JSON.stringify(out)}`);
});

// S9a (F6a): content-array last_assistant_message, compliant → {}
test('S9a: content-array message (compliant) → {}', () => {
  const { out } = runHook(ss({ last_assistant_message: [{ type: 'text', text: COMPLIANT_MSG }] }));
  if (out.decision !== undefined) throw new Error(`content-array compliant must allow, got ${JSON.stringify(out)}`);
});

// S9b (F6a): content-array message, KB-less → block (must NOT [object Object] into a false-pass)
test('S9b: content-array message (KB-less) → block', () => {
  const { out } = runHook(ss({ last_assistant_message: [{ type: 'text', text: 'prose only, no section' }] }));
  if (out.decision !== 'block') throw new Error(`content-array KB-less must block, got ${JSON.stringify(out)}`);
});

// S10 (F2 INERTNESS GUARD): tool_input.subagent_type set but agent_type absent → {}.
// Proves the hook reads the top-level agent_type, NOT the PostToolUse field. If it
// mistakenly read tool_input.subagent_type it would block here; it must allow.
test('S10: tool_input.subagent_type=architect but no agent_type → {} (reads agent_type only)', () => {
  const env = ss({ last_assistant_message: 'no kb section here' });
  delete env.agent_type;
  env.tool_input = { subagent_type: 'architect' };
  const { out } = runHook(env);
  if (out.decision !== undefined) throw new Error(`hook must key on agent_type (absent → allow), not tool_input.subagent_type — got ${JSON.stringify(out)}`);
});

// S11: block reason uses SUBAGENT-continue framing ("append this section now"), not parent re-spawn
test('S11: block reason is self-correction framing (append now), not re-spawn', () => {
  const { out } = runHook(ss());
  if (!/append this section now/i.test(out.reason || '')) throw new Error(`reason should instruct the subagent to append now, got: ${out.reason}`);
  if (/re-spawn/i.test(out.reason || '')) throw new Error('SubagentStop reason must not use parent re-spawn framing');
});

// ---------------------------------------------------------------------------
// CROSS-GATE AGREEMENT (F3): the PostToolUse gate and the SubagentStop gate MUST
// return the same compliance verdict for the same text. This makes the DRY
// extraction's whole justification ("two gates can never diverge") executable.
// PostToolUse block  ⟺ SubagentStop block  for an architect response.
// ---------------------------------------------------------------------------
function postGateBlocks(text) {
  const out = runBin(POST_GATE, {
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect' },
    tool_response: { status: 'completed', content: [{ type: 'text', text }] },
    session_id: 's', tool_use_id: 't',
  });
  return out.decision === 'block';
}
function subStopBlocks(text) {
  return runBin(HOOK, ss({ last_assistant_message: text })).decision === 'block';
}
test('cross-gate: both gates agree on compliant vs non-compliant fixtures', () => {
  const fixtures = [
    { text: COMPLIANT_MSG, block: false },
    { text: '## KB Sources Consulted\n- kb:a/b', block: false },
    { text: '## 7. KB Sources Consulted\n- kb:a/b', block: false },
    { text: 'no section, no refs', block: true },
    { text: '### KB Sources Consulted\n- kb:a/b', block: true },       // h3 rejected
    { text: '## KB Sources Consulted\n- no canonical ref', block: true }, // heading, 0 refs
  ];
  clearLog();
  for (const f of fixtures) {
    const pg = postGateBlocks(f.text);
    const ss2 = subStopBlocks(f.text);
    if (pg !== ss2) throw new Error(`gates DISAGREE on ${JSON.stringify(f.text.slice(0, 40))}: postGate.block=${pg} subStop.block=${ss2}`);
    if (pg !== f.block) throw new Error(`wrong verdict on ${JSON.stringify(f.text.slice(0, 40))}: expected block=${f.block}, got ${pg}`);
  }
});

clearLog();
process.stdout.write(`\n=== Summary ===\n  Passed: ${passed}\n  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
