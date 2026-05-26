'use strict';

// doctor/probes/hook-installation.js — v2.9.0 Phase C.1 (FIX-I4)
//
// Checks whether the toolkit's hooks are installed in the user's Claude
// settings file (~/.claude/settings.json or per-project).
//
// Surfaces:
//   pass — settings.json present + at least one hook matches expected manifest
//   warn — settings.json present but no toolkit hooks detected (operator
//          may have explicitly disabled, which is a valid choice)
//   fail — settings.json malformed (cannot parse)
//
// MVP scope: looks at ~/.claude/settings.json only. Per-project settings
// are not yet probed (out of scope; would need cwd convention).

const fs = require('fs');
const path = require('path');
const os = require('os');

const EXPECTED_HOOKS = [
  'pre-compact-save.js',
  'auto-store-enrichment.js',
  'session-self-improve-prompt.js',
  'prompt-enrich-trigger.js',
];

function run(_args) {
  if (process.env.AGENT_TEAM_DOCTOR_TEST === '1') {
    return { status: 'pass', details: { mode: 'test-fixture' } };
  }
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return { status: 'warn', details: { settings: 'absent', notes: 'No ~/.claude/settings.json found; hooks not yet wired (run install.sh).' } };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return { status: 'fail', details: { error: 'settings.json parse failed', message: err.message } };
  }
  const matched = [];
  const hookSection = parsed.hooks || {};
  const allHookText = JSON.stringify(hookSection);
  for (const h of EXPECTED_HOOKS) {
    if (allHookText.includes(h)) matched.push(h);
  }
  if (matched.length === 0) {
    return { status: 'warn', details: { matched: [], expected: EXPECTED_HOOKS, notes: 'No toolkit hooks detected — operator may have disabled or never installed.' } };
  }
  return {
    status: 'pass',
    details: { matched, expected: EXPECTED_HOOKS, coverage: `${matched.length}/${EXPECTED_HOOKS.length}` },
  };
}

module.exports = { name: 'hook-installation', run };
