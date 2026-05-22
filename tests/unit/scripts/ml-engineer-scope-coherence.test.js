#!/usr/bin/env node
/**
 * ml-engineer-scope-coherence.test.js — v2.9.0 Phase C.3 (FIX-I8) coverage
 *
 * Empirical bug surface (FIX-H2 v2.8.5 follow-up):
 *   The 08-ml-engineer persona covers BOTH training-pipeline AND
 *   inference-API consumption (LLM-as-feature). FIX-H2 patched
 *   the contract `_scope_note` and `agents/ml-engineer.md` but the
 *   load-bearing persona brief at `swarm/personas/08-ml-engineer.md`
 *   still leads with training-only framing ("trained, evaluated,
 *   deployed, and operated production ML systems"). Drift between
 *   three sources of truth.
 *
 * FIX-I8: update persona brief + add fixture test asserting
 * scope-claim coherence across the 3 surfaces.
 *
 * The 3 sources of truth (must agree):
 *   1. agents/ml-engineer.md — Agent-tool subagent_type declaration
 *   2. swarm/personas-contracts/08-ml-engineer.contract.json — _scope_note
 *   3. swarm/personas/08-ml-engineer.md — full persona brief
 *
 * Tests:
 *   T1: agents/ml-engineer.md mentions BOTH training AND inference
 *   T2: contract `_scope_note` covers BOTH training AND inference
 *   T3: persona brief mentions BOTH training AND inference + LLM/API
 *   T4: contract's recommended skills include claude-api (inference path)
 *   T5: kb_scope_default references kb:ml-dev/training-vs-inference
 *   T6: persona-md mentions LLM / inference-API / Claude-API / structured output
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const AGENT_MD = path.join(REPO, 'agents/ml-engineer.md');
const CONTRACT = path.join(REPO, 'swarm/personas-contracts/08-ml-engineer.contract.json');
const PERSONA_BRIEF = path.join(REPO, 'swarm/personas/08-ml-engineer.md');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

process.stdout.write('\n[FIX-I8] 08-ml-engineer scope coherence (training + inference)\n');

// T1: agents/ml-engineer.md covers BOTH training AND inference
{
  const src = fs.readFileSync(AGENT_MD, 'utf8');
  const mentionsTraining = /training/i.test(src);
  const mentionsInference = /inference|LLM|claude.?api|openai|prompt engineering/i.test(src);
  assert(mentionsTraining && mentionsInference,
    'T1: agents/ml-engineer.md mentions BOTH training AND inference (training=' + mentionsTraining + ' inference=' + mentionsInference + ')');
}

// T2: contract `_scope_note` covers BOTH paths
{
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const note = (contract.skills && contract.skills._scope_note) || '';
  const mentionsTraining = /training/i.test(note);
  const mentionsInference = /inference|LLM|claude.?api|openai/i.test(note);
  assert(mentionsTraining && mentionsInference,
    'T2: contract _scope_note covers BOTH training AND inference (training=' + mentionsTraining + ' inference=' + mentionsInference + ')');
}

// T3: persona brief covers BOTH training AND inference + LLM/API
{
  const src = fs.readFileSync(PERSONA_BRIEF, 'utf8');
  const mentionsTraining = /training/i.test(src);
  const mentionsInference = /inference|LLM|claude.?api|openai|prompt engineering|API consumption/i.test(src);
  assert(mentionsTraining,
    'T3a: persona brief mentions training (got: ' + mentionsTraining + ')');
  assert(mentionsInference,
    'T3b: persona brief mentions inference/LLM/API (got: ' + mentionsInference + ')');
}

// T4: contract's recommended skills include claude-api (inference path)
{
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const recommended = (contract.skills && contract.skills.recommended) || [];
  const hasClaudeApi = recommended.includes('claude-api') || recommended.some((s) => /claude.?api|openai/i.test(s));
  assert(hasClaudeApi, 'T4: contract.skills.recommended includes inference-path skill (claude-api) (got: ' + JSON.stringify(recommended) + ')');
}

// T5: kb_scope.default references kb:ml-dev/training-vs-inference
{
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const defaults = (contract.kb_scope && contract.kb_scope.default) || [];
  const hasTvI = defaults.some((d) => /training-vs-inference/i.test(d));
  assert(hasTvI, 'T5: kb_scope.default includes kb:ml-dev/training-vs-inference (got: ' + JSON.stringify(defaults) + ')');
}

// T6: persona brief explicitly mentions API consumption / structured output / etc
{
  const src = fs.readFileSync(PERSONA_BRIEF, 'utf8');
  const hasInferenceVocab =
    /structured output|prompt engineering|inference.*API|API.*consumption|RAG|embedding|cost.aware/i.test(src);
  assert(hasInferenceVocab,
    'T6: persona brief uses inference-path vocabulary (prompt engineering / structured output / RAG / etc.)');
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
