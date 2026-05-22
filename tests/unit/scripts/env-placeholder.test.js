#!/usr/bin/env node
/**
 * env-placeholder.test.js — v2.9.0 Phase C.2 (FIX-I7) coverage
 *
 * Empirical bug surface (bench/control-runs/v2.8.5-control):
 *   `.env` template values like `<your-anthropic-key-here>` evaluate
 *   truthy under `[ -n "$X" ]` but have zero useful content. Phase 3-4
 *   spawn silently degraded to stub responses because the gate that
 *   should have aborted didn't recognize placeholder shapes.
 *
 * New convention: scripts that consume `.env` MUST treat placeholder
 * values as absent. This module is the canonical placeholder detector
 * (shared by the doctor env-inheritance probe + any other consumer).
 *
 * Tests cover the documented placeholder shapes:
 *   T1: empty / empty-after-trim → placeholder
 *   T2: <angle-bracketed> → placeholder
 *   T3: XXX / XXXXX → placeholder
 *   T4: TODO / CHANGEME / FIXME → placeholder
 *   T5: YOUR_API_KEY_HERE shape → placeholder
 *   T6: ${VAR} unsubstituted shell var → placeholder
 *   T7: ... (literal ellipsis) → placeholder
 *   T8: real-looking key (sk-ant-...) → NOT placeholder
 *   T9: realistic short value (true / 1 / dev) → NOT placeholder
 *   T10: null / undefined / non-string → placeholder
 */

'use strict';

const path = require('node:path');

const HELPER = path.resolve(__dirname, '../../../scripts/agent-team/_lib/env-placeholder.js');
const { isPlaceholderEnvValue } = require(HELPER);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

process.stdout.write('\n[FIX-I7] .env placeholder-conditional skip helper\n');

// T1: empty / whitespace-only
assert(isPlaceholderEnvValue('') === true, 'T1a: empty string is placeholder');
assert(isPlaceholderEnvValue('   ') === true, 'T1b: whitespace-only string is placeholder');
assert(isPlaceholderEnvValue('\n\t') === true, 'T1c: newline+tab is placeholder');

// T2: angle-bracketed
assert(isPlaceholderEnvValue('<your-anthropic-key-here>') === true, 'T2a: <your-anthropic-key-here> is placeholder');
assert(isPlaceholderEnvValue('<API_KEY>') === true, 'T2b: <API_KEY> is placeholder');
assert(isPlaceholderEnvValue('<foo>') === true, 'T2c: <foo> is placeholder');

// T3: XXX shape
assert(isPlaceholderEnvValue('XXX') === true, 'T3a: XXX is placeholder');
assert(isPlaceholderEnvValue('XXXXX') === true, 'T3b: XXXXX is placeholder');
assert(isPlaceholderEnvValue('xxx') === true, 'T3c: lowercase xxx is placeholder');

// T4: TODO / CHANGEME / FIXME
assert(isPlaceholderEnvValue('TODO') === true, 'T4a: TODO is placeholder');
assert(isPlaceholderEnvValue('todo') === true, 'T4b: lowercase todo is placeholder');
assert(isPlaceholderEnvValue('CHANGEME') === true, 'T4c: CHANGEME is placeholder');
assert(isPlaceholderEnvValue('FIXME') === true, 'T4d: FIXME is placeholder');

// T5: YOUR_X_HERE shape
assert(isPlaceholderEnvValue('YOUR_API_KEY_HERE') === true, 'T5a: YOUR_API_KEY_HERE is placeholder');
assert(isPlaceholderEnvValue('your_api_key_here') === true, 'T5b: lowercase your_api_key_here is placeholder');
assert(isPlaceholderEnvValue('YOUR_TOKEN_HERE') === true, 'T5c: YOUR_TOKEN_HERE is placeholder');

// T6: ${VAR} unsubstituted shell var
assert(isPlaceholderEnvValue('${OPENAI_API_KEY}') === true, 'T6a: ${OPENAI_API_KEY} is placeholder');
assert(isPlaceholderEnvValue('${VAR}') === true, 'T6b: ${VAR} is placeholder');

// T7: literal ellipsis or "placeholder"
assert(isPlaceholderEnvValue('...') === true, 'T7a: ... is placeholder');
assert(isPlaceholderEnvValue('placeholder') === true, 'T7b: literal "placeholder" is placeholder');
assert(isPlaceholderEnvValue('PLACEHOLDER') === true, 'T7c: PLACEHOLDER is placeholder');

// T8: real-looking values are NOT placeholder
// Synthetic shapes that don't match known secret detectors; we just want to
// confirm the helper doesn't false-positive on opaque-looking long strings.
assert(isPlaceholderEnvValue('aRandomLooking_String-987654321') === false, 'T8a: random-looking long string NOT placeholder');
assert(isPlaceholderEnvValue('postgres://localhost:5432/mydb') === false, 'T8b: real db URL NOT placeholder');
assert(isPlaceholderEnvValue('opaque-blob-zyxwvutsrqponml') === false, 'T8c: opaque-blob NOT placeholder');

// T9: realistic short values are NOT placeholder
assert(isPlaceholderEnvValue('true') === false, 'T9a: "true" NOT placeholder');
assert(isPlaceholderEnvValue('1') === false, 'T9b: "1" NOT placeholder');
assert(isPlaceholderEnvValue('dev') === false, 'T9c: "dev" NOT placeholder');
assert(isPlaceholderEnvValue('production') === false, 'T9d: "production" NOT placeholder');

// T10: null / undefined / non-string
assert(isPlaceholderEnvValue(null) === true, 'T10a: null is placeholder');
assert(isPlaceholderEnvValue(undefined) === true, 'T10b: undefined is placeholder');
assert(isPlaceholderEnvValue(0) === false, 'T10c: number 0 is NOT placeholder (legitimate value)');

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
