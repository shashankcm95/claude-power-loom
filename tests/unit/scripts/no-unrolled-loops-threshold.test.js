#!/usr/bin/env node
/**
 * no-unrolled-loops-threshold.test.js — v2.9.0 Phase B.3 (FIX-I6) coverage
 *
 * Empirical bug surface (bench v2.8.5 + v2.8.3 — node-backend & data-engineer
 * personas producing Drizzle / Prisma / ORM schema code):
 *
 *   Drizzle / Prisma schemas, GraphQL definitions, and TypeScript import
 *   manifests legitimately produce many short, similar-shape lines:
 *     import { foo } from './foo';
 *     import { bar } from './bar';
 *     import { baz } from './baz';
 *     ...
 *   The pre-FIX-I6 length-filter (`length >= 3`) counted these as repetition
 *   candidates and tripped `unrolled_loop_detected` on functionally-distinct
 *   short lines that just shared structural shape.
 *
 * Fix: bump the min-line-length filter to 20 so short syntactic lines
 * (imports, closing tokens, single-token statements) are skipped. The
 * 1000-zeros / unrolled-fizzbuzz family — the actual target — has long
 * lines (`console.log("foo bar baz")` etc.) that easily clear 20 chars.
 *
 * Tests:
 *   T1: 6 short imports do NOT trigger unrolled_loop (regression)
 *   T2: 6 LONG repeated lines (≥ 20 chars) DO still trigger (back-compat)
 *   T3: source code-level: noUnrolledLoops uses `length >= 20` (not 3)
 *   T4: A drizzle-style schema with many `text('col')` short lines passes
 *   T5: A pathological unrolled fizzbuzz with 30-char lines still fails
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const VERIFIER = path.join(REPO, 'scripts/agent-team/contract-verifier.js');
const ENG_CONTRACT = path.join(REPO, 'swarm/personas-contracts/engineering-task.contract.json');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function runVerifierOnBody(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-unrolled-'));
  const out = path.join(dir, 'output.md');
  const fm = [
    '---',
    'id: test',
    'role: actor',
    'depth: 1',
    'parent: super-root',
    'persona: 04-architect',
    'identity: "04-architect.tester"',
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(out, fm + body + '\n\nFile: `scripts/agent-team/contract-verifier.js:322`\n');
  const r = spawnSync('node', [VERIFIER, '--contract', ENG_CONTRACT, '--output', out, '--no-record'], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_TEAM_NO_RECORD: '1' },
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return parsed;
}

process.stdout.write('\n[FIX-I6] noUnrolledLoops min-line-length bump\n');

// T1: 6 identical SHORT (< 20-char) lines do NOT trigger unrolled-loop
//     (the actual regression: nested-brace-stack false-positive caught by
//     H.2.7 own-validation probe; FIX-I6 widens that filter from 3 to 20).
{
  const body = [
    '## LOW',
    '### LOW-1: nested handler',
    '',
    '```js',
    'function outer() {',
    '  return inner({',
    '    onA: () => x,',
    '    onB: () => y,',
    '    onC: () => z,',
    '  });',
    '});',  // 7 short identical-shape lines worth of closers
    '});',
    '});',
    '});',
    '});',
    '});',
    '```',
    '',
  ].join('\n');
  const parsed = runVerifierOnBody(body);
  const f5 = parsed && parsed.functional && parsed.functional.F5;
  assert(f5 && f5.status === 'pass',
    'T1: 6+ stacked `});` short closers -> F5 pass (regression fixture; got status=' + (f5 && f5.status) + ')');
}

// T2: 6 LONG (≥ 20 chars) repeated lines -> F5 still fails (back-compat)
{
  const longLine = 'console.log("repeated long pathological output line for fizzbuzz unrolling test")';
  const body = [
    '## LOW',
    '### LOW-1: pathological code',
    '',
    '```js',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    '```',
    '',
  ].join('\n');
  const parsed = runVerifierOnBody(body);
  const f5 = parsed && parsed.functional && parsed.functional.F5;
  assert(f5 && f5.status === 'fail',
    'T2: 6 long-line repetitions -> F5 fail (back-compat; got status=' + (f5 && f5.status) + ')');
}

// T3: source-level — noUnrolledLoops uses `length >= 20` (not 3)
{
  const src = fs.readFileSync(VERIFIER, 'utf8');
  // Locate the noUnrolledLoops body. We accept the bump if either:
  //   (a) literal `length >= 20` appears in the function, OR
  //   (b) a named constant MIN_LINE_LENGTH = 20 is declared near it
  const hasBumped =
    /length\s*>=\s*20\b/.test(src) ||
    /MIN_(?:LINE_)?LENGTH\s*=\s*20\b/.test(src);
  assert(hasBumped, 'T3: noUnrolledLoops uses length >= 20 (was 3; FIX-I6)');
}

// T4: Drizzle-style schema with many `text('col')` short lines passes
{
  const body = [
    '## LOW',
    '### LOW-1: schema review',
    '',
    "```ts",
    "export const users = pgTable('users', {",
    "  id: serial('id').primaryKey(),",
    "  name: text('name'),",
    "  email: text('email'),",
    "  bio: text('bio'),",
    "  avatar: text('avatar'),",
    "  status: text('status'),",
    "});",
    '```',
    '',
  ].join('\n');
  const parsed = runVerifierOnBody(body);
  const f5 = parsed && parsed.functional && parsed.functional.F5;
  assert(f5 && f5.status === 'pass',
    'T4: Drizzle-style schema -> F5 pass (got status=' + (f5 && f5.status) + ')');
}

// T5: pathological unrolled fizzbuzz with 30-char repeated lines fails
{
  const longLine = 'output.push(formatBuzz(i, "fizz"))';  // 33 chars
  const body = [
    '## LOW',
    '### LOW-1: unrolled fizzbuzz',
    '',
    '```js',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    longLine + ';',
    '```',
    '',
  ].join('\n');
  const parsed = runVerifierOnBody(body);
  const f5 = parsed && parsed.functional && parsed.functional.F5;
  assert(f5 && f5.status === 'fail',
    'T5: pathological unrolled fizzbuzz (33-char line ×6) -> F5 fail (got status=' + (f5 && f5.status) + ')');
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
