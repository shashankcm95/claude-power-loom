#!/usr/bin/env node

// validate-config-redirect.js — v2.9.0 Phase D.1 (FIX-I9)
//
// PreToolUse:Bash hook — detects when a Bash command writes to a protected
// config file via redirect (`>`, `>>`, `tee`). The existing config-guard.js
// is PreToolUse:Write only; Bash heredocs / redirects bypass it.
//
// DEFAULT BEHAVIOR: WARN-not-BLOCK
//   - decision: 'approve' (does NOT block the command)
//   - stderr WARN message surfaces the protected path so operators see it
//   - rationale: false-positive surface for Bash is large (build scripts
//     legitimately write `tsconfig.build.json`, fixtures, /tmp/, logs)
//     and forcing block would erode trust in ALL gates as operators
//     learn to bypass the substrate
//
// STRICT MODE: STRICT_CONFIG_GUARD=1 env var
//   - decision: 'block' on any match
//   - reserved for tight-discipline contexts (CI, audit runs) where
//     false-positives are an acceptable cost
//
// Per architect.theo HIGH-5: this is itself a design-pushback case.
// The KB anchor at kb:design-pushback/syntactic-gate-extension-for-tool-bypass
// catalogs the anti-pattern (extending deterministic gates via syntactic
// parsing of command lines to plug a capability gap).
//
// DESIGN ANCHORS:
//   - kb:architecture/discipline/refusal-patterns — substrate-scope refusal
//   - kb:architecture/discipline/error-handling-discipline — observability
//     gate (WARN) preserves signal without compounding the original problem

'use strict';

const fs = require('fs');
const path = require('path');
const { log } = require('./_log.js');
const logger = log('validate-config-redirect');

// Reuse the same patterns config-guard.js consumes so the two hooks
// stay in sync.
const FALLBACK_PATTERNS = [
  /(?:^|\/|\s)\.eslintrc/i,
  /(?:^|\/|\s)eslint\.config/i,
  /(?:^|\/|\s)\.prettierrc/i,
  /(?:^|\/|\s)prettier\.config/i,
  /(?:^|\/|\s)biome\.jsonc?(?:\s|$)/i,
  /(?:^|\/|\s)\.stylelintrc/i,
  /(?:^|\/|\s)tsconfig[^/\s]*\.json(?:\s|$)/i,
  /(?:^|\/|\s)\.editorconfig(?:\s|$)/i,
];

function loadPatterns() {
  const candidates = [
    path.join(__dirname, '..', 'config-guard-patterns.json'),
    path.join(__dirname, 'config-guard-patterns.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.patterns)) {
        const compiled = parsed.patterns.flatMap((p) => {
          try {
            // Same anchoring as config-guard but with `\s` (whitespace) added
            // so the Bash command parser catches `> tsconfig.json` (preceded
            // by space) AND `/path/to/tsconfig.json` (preceded by `/`).
            return [new RegExp(`(?:^|\\/|\\s)(?:${p})`, 'i')];
          } catch (e) {
            logger('bad_pattern', { pattern: p, error: e.message });
            return [];
          }
        });
        return compiled;
      }
    } catch { /* try next candidate */ }
  }
  return FALLBACK_PATTERNS;
}

const PROTECTED_PATTERNS = loadPatterns();

// Redirect-token detector. We want to match commands that LIKELY write
// to a file. Conservatively detect:
//   foo > file
//   foo >> file
//   tee file
//   tee -a file
// Not exhaustive (process substitution, heredoc to specific file, dd, etc.)
// — the goal is high-signal warn coverage, not exhaustive enforcement.
function extractRedirectTargets(command) {
  const targets = [];
  // > FILE or >> FILE (capture path-like token after the redirect)
  for (const m of command.matchAll(/(?:^|[\s|&;])>>?\s*([^\s|&;<>]+)/g)) {
    targets.push(m[1]);
  }
  // tee FILE (handle optional -a/-i flags)
  for (const m of command.matchAll(/(?:^|[\s|&;])tee(?:\s+-[ai]+)?\s+([^\s|&;<>]+)/g)) {
    targets.push(m[1]);
  }
  return targets;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const toolInput = data.tool_input || {};
    const command = toolInput.command;

    // Only inspect Bash invocations; anything else passes through cleanly.
    if (toolName !== 'Bash' || typeof command !== 'string' || command.length === 0) {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const targets = extractRedirectTargets(command);
    const protectedHits = targets.filter((t) => PROTECTED_PATTERNS.some((re) => re.test(t)));

    if (protectedHits.length === 0) {
      logger('approve', { command_excerpt: command.slice(0, 80) });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    const strict = process.env.STRICT_CONFIG_GUARD === '1';
    const pathsCsv = protectedHits.join(', ');

    if (strict) {
      logger('block', { command_excerpt: command.slice(0, 80), paths: protectedHits, mode: 'strict' });
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `STRICT_CONFIG_GUARD: Bash redirect targets protected config path(s) (${pathsCsv}). Fix the code to satisfy the existing config instead of bypassing the Write-tool config-guard via redirect.`,
      }));
      return;
    }

    // Default: WARN-not-BLOCK. Approve + stderr observability.
    logger('warn', { command_excerpt: command.slice(0, 80), paths: protectedHits });
    process.stderr.write(
      `[validate-config-redirect] WARN: Bash redirect targets protected config path(s): ${pathsCsv}. ` +
      'This bypasses the Write-tool config-guard. If the intent is to weaken the config, ' +
      'prefer fixing the code instead. (Set STRICT_CONFIG_GUARD=1 to escalate to block; ' +
      'see kb:design-pushback/syntactic-gate-extension-for-tool-bypass.)\n'
    );
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
