#!/usr/bin/env node
/**
 * format-spec-hint.test.js — v2.9.0 Phase B.1 (FIX-I1) coverage
 *
 * Empirical bug (bench-run dogfood evidence): actors wrote
 *   "### LOW-1: <description>"
 * WITHOUT a parent
 *   "## LOW"
 * H2 severity bucket. `countFindings` walked only H2 buckets so it saw 0
 * findings and F3 failed silently — the actor had no signal that the format
 * was wrong vs the content being wrong.
 *
 * Architect.theo HIGH-1 diagnosis (paraphrased):
 *   "_doc on engineering-task.contract.json:24 documents the format
 *   correctly. The failure was actors following the WORDING of '### LOW-1:'
 *   without realizing the parent '## LOW' was required. The fix isn't
 *   'update the _doc'; it's 'make the format constraint impossible to
 *   misread + add a structured hint at the failure boundary'."
 *
 * This test asserts:
 *   T1: well-formed body passes F3 (back-compat)
 *   T2: body with orphan severity-shaped H3 emits structured hint
 *   T3: hint references _format-spec.md
 *   T4: _format-spec.md canonical doc exists with key section names
 *   T5: hint NOT emitted when failure is "no findings at all" (different mode)
 *   T6: hint NOT emitted on a well-formed empty-severity body (no false-pos)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const VERIFIER = path.join(REPO, 'scripts/agent-team/contract-verifier.js');
const ENG_CONTRACT = path.join(REPO, 'swarm/personas-contracts/engineering-task.contract.json');
const SPEC_PATH = path.join(REPO, 'swarm/personas-contracts/_format-spec.md');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

// Build a tmp output.md, run verifier against engineering-task contract, return parsed JSON.
function runVerifier(bodyMarkdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-spec-hint-'));
  const out = path.join(dir, 'output.md');
  // Minimal frontmatter so F1+F2 pass (otherwise we never reach F3).
  const fm = [
    '---',
    'id: test-actor-1',
    'role: actor',
    'depth: 1',
    'parent: super-root',
    'persona: 04-architect',
    'identity: "04-architect.tester"',
    '---',
    '',
  ].join('\n');
  // Include a token file citation so F4 doesn't dominate the failure (we want F3 surface).
  fs.writeFileSync(out, fm + bodyMarkdown + '\n\nFile citation: `scripts/agent-team/contract-verifier.js:77`\n');
  const r = spawnSync('node', [VERIFIER, '--contract', ENG_CONTRACT, '--output', out, '--no-record'], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_TEAM_NO_RECORD: '1' },
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
  // Cleanup tmp dir but don't fail tests on it.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, parsed };
}

process.stdout.write('\n[FIX-I1] _format-spec.md + structured F3 hint\n');

// T1: well-formed `## LOW\n### LOW-1: foo` -> F3 passes
{
  const body = [
    '## Summary',
    'A test report.',
    '',
    '## LOW',
    '### LOW-1: minor cleanup',
    'Body of finding.',
    '',
  ].join('\n');
  const { parsed } = runVerifier(body);
  const f3 = parsed && parsed.functional && parsed.functional.F3;
  assert(f3 && f3.status === 'pass', 'T1: well-formed `## LOW` + `### LOW-1: ...` -> F3 pass');
}

// T2: orphan severity-shaped H3 (no parent H2 bucket) -> F3 fails AND hint present
{
  const body = [
    '## Summary',
    'A report whose author forgot the H2 severity bucket.',
    '',
    '### LOW-1: orphan finding without parent',
    'Body of orphan finding.',
    '',
  ].join('\n');
  const { parsed } = runVerifier(body);
  const f3 = parsed && parsed.functional && parsed.functional.F3;
  assert(f3 && f3.status === 'fail', 'T2a: orphan H3 -> F3 fail');
  assert(f3 && typeof f3.hint === 'string' && f3.hint.length > 0,
    'T2b: orphan H3 -> F3 result carries structured hint string (got: ' +
    (f3 && f3.hint ? JSON.stringify(f3.hint).slice(0, 100) : 'undefined') + ')');
}

// T3: hint references _format-spec.md
{
  const body = [
    '## Summary',
    'no severity buckets at all.',
    '',
    '### HIGH-1: floating finding',
    'Body.',
    '',
  ].join('\n');
  const { parsed } = runVerifier(body);
  const f3 = parsed && parsed.functional && parsed.functional.F3;
  const hint = (f3 && f3.hint) || '';
  assert(/_format-spec\.md/.test(hint),
    'T3: hint references _format-spec.md (got: ' + JSON.stringify(hint).slice(0, 120) + ')');
}

// T4: _format-spec.md canonical doc exists
{
  assert(fs.existsSync(SPEC_PATH), 'T4a: swarm/personas-contracts/_format-spec.md exists');
  if (fs.existsSync(SPEC_PATH)) {
    const spec = fs.readFileSync(SPEC_PATH, 'utf8');
    const hasFindingFormat = /(?:Finding format|Findings format|H2.*severity.*bucket)/i.test(spec);
    const hasH2H3 = /##\s+(?:CRITICAL|HIGH|MEDIUM|LOW)/.test(spec) && /###\s+(?:CRITICAL|HIGH|MEDIUM|LOW)-\d+/.test(spec);
    assert(hasFindingFormat, 'T4b: _format-spec.md documents findings format');
    assert(hasH2H3, 'T4c: _format-spec.md shows H2 severity + H3 numbered example');
  }
}

// T5: NO orphan H3s, NO findings at all -> F3 fails with NO orphan-H3 hint
//     (i.e., the hint must be specific to the orphan-H3 failure mode, not blanket).
{
  const body = [
    '## Summary',
    'Plain prose report with no findings sections of any kind.',
    'No H3, no severity buckets.',
    '',
  ].join('\n');
  const { parsed } = runVerifier(body);
  const f3 = parsed && parsed.functional && parsed.functional.F3;
  assert(f3 && f3.status === 'fail', 'T5a: no findings + no orphans -> F3 fail');
  // Either hint absent or hint indicates "no findings" (different mode);
  // it must NOT claim orphan-H3 when there are none.
  const hint = (f3 && f3.hint) || '';
  const claimsOrphan = /orphan|missing.*##\s+(?:CRITICAL|HIGH|MEDIUM|LOW)|parent.*severity/i.test(hint);
  assert(!claimsOrphan,
    'T5b: F3 hint for "no findings" mode does NOT falsely claim orphan-H3 (got: ' + JSON.stringify(hint).slice(0, 100) + ')');
}

// T6: well-formed body with valid `## CRITICAL` parent + `### CRITICAL-1:` H3 -> no hint
{
  const body = [
    '## Summary',
    'A report.',
    '',
    '## CRITICAL',
    '### CRITICAL-1: real finding',
    'Body.',
    '',
  ].join('\n');
  const { parsed } = runVerifier(body);
  const f3 = parsed && parsed.functional && parsed.functional.F3;
  // Either no hint key at all, or hint is empty/falsy.
  const hint = (f3 && f3.hint);
  assert(f3 && f3.status === 'pass' && (hint === undefined || hint === '' || hint === null),
    'T6: well-formed body -> F3 pass + no hint emitted');
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
