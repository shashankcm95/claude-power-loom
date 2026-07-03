#!/usr/bin/env node

'use strict';

// observe-noverify-push.js — PostToolUse:Bash observer (logs-only, never blocks).
//
// The git-native pre-push lint gate (packages/kernel/validators/lint-gate-prepush.js)
// has one native escape: `git push --no-verify`, which fires NO git hook and leaves
// ZERO trace. Since the whole drift-detection premise is "surface skip-over-use to
// /self-improve," a --no-verify skip would be invisible without this observer.
//
// It LOGS a `git push --no-verify` and emits a stderr NOTE. It NEVER blocks (the
// tool already ran — PostToolUse), NEVER parses for enforcement, NEVER runs repo
// code — so it does NOT reintroduce the v1 RCE/parser surface (C1/H1). A missed
// detection (e.g. an aliased push) just fails to log one skip; there is no security
// consequence. (plan 2026-07-03-lint-gate-prepush-hook.md §10.2 G-E / M-C.)

const { log } = require('../_lib/_log.js');

const logger = log('observe-noverify-push');

/** Best-effort (logs-only, not a gate): a git push carrying --no-verify. */
function isNoVerifyPush(command) {
  if (typeof command !== 'string') return false;
  if (!/\bgit\b/.test(command) || !/\bpush\b/.test(command)) return false;
  return /(?:^|\s)--no-verify(?:\s|=|$)/.test(command);
}

/** Mask inline `user:secret@host` credentials before the command is logged, so a
 *  `git push https://user:token@host/repo` never persists a token to the log. */
function redactCredentials(str) {
  return String(str).replace(/:\/\/[^\s@/]+:[^\s@/]+@/g, '://***:***@');
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const command = (data.tool_input && data.tool_input.command) || '';
      if (data.tool_name === 'Bash' && isNoVerifyPush(command)) {
        logger('noverify_push', { command_excerpt: redactCredentials(command).slice(0, 120) });
        process.stderr.write(
          '[observe-noverify-push] NOTE: `git push --no-verify` bypasses the local pre-push '
          + 'lint gate. Logged for /self-improve drift tracking (not a block).\n'
        );
      }
    } catch (err) {
      // An observer must never fail the tool it observes.
      logger('error', { error: err && err.message });
    }
    // PostToolUse: no decision to emit; stay silent on stdout.
  });
}

// Guard the stdin wiring behind require.main so `require()`-ing this module (e.g.
// from a unit test that only wants isNoVerifyPush) does NOT attach stdin listeners
// and hang the process.
if (require.main === module) main();

module.exports = { isNoVerifyPush, redactCredentials };
