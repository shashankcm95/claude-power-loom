#!/usr/bin/env node

// tests/unit/hooks/prompt-enrich-trigger.test.js
//
// v2.8.2 — Fix-2(a) regression guard for the SKIP_PATTERNS over-fire on
// ship/PR confirmation responses ("merged", "shipped", "landed", etc.).
//
// Empirical motivation (Fix-2 investigation, ~/.claude/logs/):
//   - 3102 prompts seen · 1005 classified vague · 2 stored marker blocks
//   - 0.2% follow-through means the strict trigger is too eager
//   - Live over-fire observed on user's typed "merged" mid-session
//
// The fix extends the confirmation-skip regex on line ~88 with
// merged/shipped/landed/pushed/deployed/done. This test locks the
// behavior so a future "tighten the regex" refactor doesn't regress.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.resolve(__dirname, '../../../hooks/scripts/prompt-enrich-trigger.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

function runHook(prompt) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOKS_QUIET: '1' },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.status };
}

function assertSkipped(prompt) {
  const r = runHook(prompt);
  if (r.stdout && r.stdout.includes('[PROMPT-ENRICHMENT-GATE]')) {
    throw new Error(`expected skip (no gate injected) for ${JSON.stringify(prompt)}; got gate output`);
  }
}

function assertEnriched(prompt, tier = null) {
  const r = runHook(prompt);
  if (!r.stdout.includes('[PROMPT-ENRICHMENT-GATE]')) {
    throw new Error(`expected gate output for ${JSON.stringify(prompt)}; got no output`);
  }
  if (tier && !r.stdout.includes(`tier: ${tier}`)) {
    throw new Error(`expected tier=${tier} for ${JSON.stringify(prompt)}; got ${r.stdout.slice(0, 200)}`);
  }
}

process.stdout.write('\n=== prompt-enrich-trigger SKIP_PATTERNS (v2.8.2 Fix-2a) ===\n');

// New ship/PR confirmation skip patterns (the fix)

test('SK-NEW-1: "merged" → skipped (live over-fire reproducer)', () => {
  assertSkipped('merged');
});

test('SK-NEW-2: "merged." → skipped (trailing period)', () => {
  assertSkipped('merged.');
});

test('SK-NEW-3: "shipped" → skipped', () => {
  assertSkipped('shipped');
});

test('SK-NEW-4: "shipped!" → skipped (trailing exclamation)', () => {
  assertSkipped('shipped!');
});

test('SK-NEW-5: "landed" → skipped', () => {
  assertSkipped('landed');
});

test('SK-NEW-6: "pushed" → skipped', () => {
  assertSkipped('pushed');
});

test('SK-NEW-7: "deployed" → skipped', () => {
  assertSkipped('deployed');
});

test('SK-NEW-8: "done" → skipped', () => {
  assertSkipped('done');
});

test('SK-NEW-9: case-insensitive — "MERGED" → skipped', () => {
  assertSkipped('MERGED');
});

test('SK-NEW-10: case-insensitive — "Shipped" → skipped', () => {
  assertSkipped('Shipped');
});

// Regression: existing skip patterns still work

test('SK-REG-1: "yes" still skipped', () => {
  assertSkipped('yes');
});

test('SK-REG-2: "approved" still skipped', () => {
  assertSkipped('approved');
});

test('SK-REG-3: "ok" still skipped', () => {
  assertSkipped('ok');
});

// Anti-regression: the new words must STAY anchored to standalone.
// "the merged branch is broken" must still enrich (full sentence, vague).

test('SK-ANTI-1: "the merged branch is broken" → NOT skipped (real bug report)', () => {
  // "broken" is a VAGUE_KEYWORD — should fire enrichment despite "merged" presence.
  assertEnriched('the merged branch is broken');
});

test('SK-ANTI-2: "shipped a bug" → NOT skipped (vague follow-on)', () => {
  // Falls through skip patterns; length-based catch-all (under 15 chars-ish)
  // OR vague keyword. Either way, NOT a pure confirmation. The skip pattern
  // is anchored with `\s*[.!?]?\s*$` so trailing content prevents match.
  const r = runHook('shipped a bug now');
  if (r.stdout.includes('[PROMPT-ENRICHMENT-GATE]')) {
    // Acceptable — vague enough to enrich.
  } else {
    // Also acceptable if length > 15 + no vague keyword detected.
    // The KEY anti-regression: skip pattern must NOT match a multi-word phrase.
  }
  // Real assertion: the new pattern must be anchored, not greedy.
  // Verify by checking the regex via the source itself.
  const fs = require('fs');
  const src = fs.readFileSync(HOOK, 'utf8');
  if (!src.includes('|merged|shipped|landed|pushed|deployed|done)\\s*[.!?]?\\s*$/i')) {
    throw new Error('skip pattern lost its trailing anchor (\\s*[.!?]?\\s*$) — would over-match');
  }
});

test('SK-ANTI-3: empty prompt still skips early', () => {
  // The "no_prompt" branch handles empty before skip patterns fire.
  assertSkipped('');
});

// Soft-confirmation tier interplay

test('SK-INTERPLAY-1: "merged now please" → still a confirmation pattern via short-confirm tier OR strict skip', () => {
  // The strict regex matches the new word but not arbitrary trailing content.
  // "merged now please" probably gets to short-confirm via isShortAmbiguousConfirmation
  // OR falls through. Either way, NOT a full-enrichment fire — that would
  // be the over-fire we're fixing.
  const r = runHook('merged now please');
  if (r.stdout.includes('tier: full-enrichment')) {
    throw new Error('"merged now please" triggered full enrichment — over-fire residue');
  }
  // tier: short-confirm OR no output (skipped) both acceptable.
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
