#!/usr/bin/env node

// PreToolUse hook: blocks edits to linter/formatter/build/test config files.
// Forces the agent to fix code instead of weakening configurations.
//
// Patterns load from hooks/config-guard-patterns.json (relative to this
// script's parent directory). If the file is missing or invalid, falls
// back to a hardcoded essential set so the gate never silently disables.

const fs = require('fs');
const path = require('path');
const { log } = require('./_log.js');
const logger = log('config-guard');

// Essential fallback if patterns file is missing or invalid
const FALLBACK_PATTERNS = [
  /(?:^|\/)\.eslintrc/i,
  /(?:^|\/)eslint\.config/i,
  /(?:^|\/)\.prettierrc/i,
  /(?:^|\/)prettier\.config/i,
  /(?:^|\/)biome\.jsonc?$/i,
  /(?:^|\/)\.stylelintrc/i,
  /(?:^|\/)tsconfig[^/]*\.json$/i,
  /(?:^|\/)\.editorconfig$/i,
];

function loadPatterns() {
  // Look for patterns file at ../config-guard-patterns.json (next to
  // hooks/scripts/) and at ./config-guard-patterns.json (same dir, for
  // installs that flatten the layout).
  const candidates = [
    path.join(__dirname, '..', 'config-guard-patterns.json'),
    path.join(__dirname, 'config-guard-patterns.json'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.patterns)) {
        const compiled = parsed.patterns.map((p) => new RegExp(`(?:^|\\/)(?:${p})`, 'i'));
        logger('patterns_loaded', { source: candidate, count: compiled.length });
        return compiled;
      }
    } catch { /* try next candidate */ }
  }

  logger('patterns_fallback', { reason: 'no_valid_patterns_file' });
  return FALLBACK_PATTERNS;
}

const PROTECTED_PATTERNS = loadPatterns();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || '';

    const isProtected = PROTECTED_PATTERNS.some((pattern) => pattern.test(filePath));

    if (isProtected) {
      logger('block', { filePath, reason: 'protected_config' });
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `Config file "${filePath}" is protected. Fix the code to satisfy the existing config instead of weakening the config.`,
      }));
    } else {
      logger('approve', { filePath });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
    }
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
