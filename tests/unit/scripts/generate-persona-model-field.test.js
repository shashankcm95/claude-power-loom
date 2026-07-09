'use strict';

// generate-persona-model-field.test.js — guards the 2026-07-08 persona-depth
// VERIFY-board CRITICAL: the generator must NOT silently upgrade a persona's
// model tier on regeneration. Three agents run on `sonnet`: optimizer (now IN
// the roster, pinned to sonnet by this field) + the still-fat/skipped
// code-reviewer + security-auditor. Before the per-persona `model` field,
// renderAgentMd hardcoded `model: opus`, so regenerating a sonnet agent via
// --force would have flipped the tier (a 3-5x cost + behavior change) with no
// gate detecting it. The scoped-core added an optional `model` field
// (default 'opus') + this non-vacuous guard. (Coverage boundary: this guards
// the GENERATOR path; a hand-edit of a committed stub is not caught here — a
// named follow-up, see the plan's stub-drift note.)

const test = require('node:test');
const assert = require('node:assert');
// modelLine is imported (not redefined) so this tier oracle and the --check gate
// read the model line through the exact same helper.
const { PERSONAS, renderAgentMd, modelLine } = require('../../../scripts/generate-persona-agents');

const baseEntry = {
  id: '01-hacker', agent: 'hacker', color: 'red',
  tools: ['Read', 'Grep', 'Glob'], description: 'd', summary: 's',
  kbDefaults: ['kb:hets/spawn-conventions'],
};

test('renderAgentMd defaults model to opus when the entry omits it', () => {
  const md = renderAgentMd({ ...baseEntry });
  assert.strictEqual(modelLine(md), 'opus');
});

test('renderAgentMd honors an explicit model (no silent upgrade)', () => {
  const md = renderAgentMd({ ...baseEntry, id: '18-optimizer', agent: 'optimizer', model: 'sonnet' });
  assert.strictEqual(modelLine(md), 'sonnet');
});

// Non-vacuous: the VALID_MODELS guard (W2, CodeRabbit W1 nitpick #4) must FIRE on a
// typo'd tier — proven by injecting the violation, not asserted. A falsy model
// ('' / null) is validated at its EFFECTIVE value (defaults to opus) so it renders,
// not throws (hacker VALIDATE L2).
test('renderAgentMd throws on an unknown model tier (guard is non-vacuous)', () => {
  assert.throws(
    () => renderAgentMd({ ...baseEntry, model: 'sonet' }),
    /unknown model tier "sonet"/,
  );
});

test('renderAgentMd validates the EFFECTIVE tier — a falsy model renders opus, does not throw', () => {
  assert.strictEqual(modelLine(renderAgentMd({ ...baseEntry, model: '' })), 'opus');
});

test('optimizer roster entry stays sonnet; planner is opus', () => {
  const opt = PERSONAS.find((p) => p.agent === 'optimizer');
  const plan = PERSONAS.find((p) => p.agent === 'planner');
  assert.ok(opt, 'optimizer present in roster');
  assert.strictEqual(opt.model, 'sonnet', 'optimizer pinned to sonnet');
  assert.ok(plan, 'planner present in roster');
  assert.strictEqual(plan.model, 'opus', 'planner is opus');
});

test('every roster entry renders the model tier its entry declares (no drift)', () => {
  for (const p of PERSONAS) {
    const md = renderAgentMd(p);
    assert.strictEqual(modelLine(md), p.model || 'opus', `${p.agent}: rendered model matches roster entry`);
  }
});
