#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W3a -- the per-arm prompt composer (the experiment's controlled variable). The three
// arms differ by EXACTLY one additive delta each, so the only thing the experiment varies
// is (archetype, earned-slice):
//   A (bare)     = task only
//   B (styled)   = archetype prose + task
//   C (grounded) = archetype prose + the grounding-slice block + task
//
// The generic build-spawn-context toolkit prefix (KB/ADR scaffolding) is EXCLUDED entirely
// (probe-confirmed in the plan): the harness composes prompts DIRECTLY so a generic prefix
// can never become a confound. The composition is DETERMINISTIC and identical-except-the-
// delta: B ends with the exact A composition; C is B with only the slice block inserted --
// no accidental ordering/whitespace difference can leak into the measured delta.
//
// SRP / dependency-inversion (architect VERIFY): the PURE composition is separated from
// file I/O via the injectable `loadArchetype` seam. The default seam reads the
// agents/<persona>.md SOURCE body; tests inject a fixed loader. A persona with no
// agents/<persona>.md -> an EXPLICIT thrown error (code-reviewer F2 fold), never a silent
// empty archetype that would silently collapse arm B into arm A.

'use strict';

const fs = require('fs');
const path = require('path');
// BARE_SHAPE (the bare-persona token rule) is imported from canonical-persona-key (DRY fold) --
// one source of truth. It defends the file-I/O seam so a crafted persona string can never
// traverse out of agents/ (CWE-22).
const { BARE_SHAPE } = require('./canonical-persona-key');

const AGENTS_DIR = path.join(__dirname, '..', '..', '..', 'agents');

// The frozen arm set (a one-way contract; a new arm is additive, never a rename).
const ARMS = Object.freeze(['A', 'B', 'C']);

// A stable, single-blank-line separator between blocks (the held-constant whitespace).
const SEP = '\n\n';

const ERR_MISSING_ARCHETYPE = 'ARCHETYPE_NOT_FOUND';

function archetypeError(persona) {
  const e = new Error(`archetype not found for persona ${JSON.stringify(persona)} (no agents/${persona}.md)`);
  e.code = ERR_MISSING_ARCHETYPE;
  return e;
}

// Default loader seam: read the agents/<persona>.md SOURCE body. Returns the file text, or
// null if the persona is mis-shaped / the file is absent (the caller turns null into the
// explicit error so arm B/C never silently degrades). PURE except this single read.
function defaultLoadArchetype(persona) {
  if (typeof persona !== 'string' || !BARE_SHAPE.test(persona)) return null;
  const file = path.join(AGENTS_DIR, `${persona}.md`);
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/**
 * Compose one arm's prompt. PURE given the (injectable) loader seam.
 *
 * @param {'A'|'B'|'C'} arm
 * @param {object} input
 * @param {string} input.persona  - the bare agentType (used to load the archetype for B/C)
 * @param {string} input.task     - the test-repo/task context (identical across all arms)
 * @param {string} [input.grounding] - the earned-instincts block (arm C only); '' = none
 * @param {(persona:string)=>(string|null)} [input.loadArchetype] - the loader seam
 * @returns {string} the composed prompt
 */
function composeArm(arm, input = {}) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${JSON.stringify(arm)} (expected one of ${ARMS.join(', ')})`);
  const { persona, task, grounding = '', loadArchetype = defaultLoadArchetype } = input;
  if (typeof task !== 'string' || task.length === 0) throw new Error('composeArm: a non-empty task is required');

  // Arm A: task only (no archetype load -- bare arm never touches the file seam).
  if (arm === 'A') return task;

  // Arm B / C need the archetype. A missing archetype is an EXPLICIT error (never silent-empty).
  const archetype = loadArchetype(persona);
  if (typeof archetype !== 'string' || archetype.length === 0) throw archetypeError(persona);

  // Arm B: archetype + task. Built so it ENDS with the exact arm-A composition (the task),
  // making B = A + the archetype delta with no whitespace confound.
  if (arm === 'B') return `${archetype}${SEP}${task}`;

  // Arm C: archetype + grounding (if any) + task. The slice is the ONLY addition over B; an
  // empty slice degrades cleanly to B's shape (no dangling block).
  const slice = typeof grounding === 'string' ? grounding : '';
  if (slice.length === 0) return `${archetype}${SEP}${task}`;
  return `${archetype}${SEP}${slice}${SEP}${task}`;
}

module.exports = { composeArm, defaultLoadArchetype, ARMS, ERR_MISSING_ARCHETYPE, AGENTS_DIR };
