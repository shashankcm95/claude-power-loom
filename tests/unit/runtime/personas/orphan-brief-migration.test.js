'use strict';

// orphan-brief-migration.test.js — the committed "loss-free heading/token probe"
// the persona-depth Wave 1 plan promises (Requirement 4). When optimizer/planner
// were thinned (fat `agents/*.md` -> thin delegation stub), their workflow/report/
// plan templates had to migrate INTO the Layer-2 briefs first. This guards that
// migration against regression: the load-bearing template headings + operational
// tokens must stay present in the briefs.
//
// SCOPE (honest): this guards the TEMPLATE migration only. The KB catalog was
// DELIBERATELY condensed from the fat flat lists into a per-instinct Instinct->KB
// map (planner -9 refs, optimizer -3), per the thin-persona convention — that
// reshape is NOT asserted here (a token probe cannot check a reference-list
// shrank, and the plan states the condensation explicitly rather than claiming
// wholesale preservation).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PERSONAS = path.resolve(__dirname, '../../../../packages/runtime/personas');
const optimizer = fs.readFileSync(path.join(PERSONAS, '18-optimizer.md'), 'utf8');
const planner = fs.readFileSync(path.join(PERSONAS, '19-planner.md'), 'utf8');

// Tokens whose loss would be a genuine migration regression (from the fat bodies).
const OPTIMIZER_TOKENS = [
  'Optimization Report', 'Baseline', 'Changes Applied', 'Principle Adherence',
  'rollback', 'never weaken', 'cross-platform', 'MCP', 'model tier',
  'regression', // the migrated "Validate" step -> verify-before-ship instinct
];
const PLANNER_TOKENS = [
  'Sizing', 'Red flags', '## Phases', '## Principle Audit', 'Requirements analysis',
  'reconnaissance', 'HIGH-severity', 'independently', 'Testing Strategy',
];

test('18-optimizer brief carries the migrated workflow/report template tokens', () => {
  for (const t of OPTIMIZER_TOKENS) {
    assert.ok(optimizer.includes(t), `18-optimizer.md lost migrated token: "${t}"`);
  }
});

test('19-planner brief carries the migrated process/template/red-flag tokens', () => {
  for (const t of PLANNER_TOKENS) {
    assert.ok(planner.includes(t), `19-planner.md lost migrated token: "${t}"`);
  }
});
