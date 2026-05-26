// safe-exec.js — H.8.4 shared helper: safe subprocess invocation without shell.
//
// Replaces execSync(string) call sites in build-spawn-context.js and
// validate-adr-drift.js with execFileSync(binary, argArray) — the array form
// never passes args through a shell, eliminating shell injection RCE.
//
// Created in response to chaos run chaos-20260508-191611-h83-trilogy C1 finding:
// POC confirmed `--task 'foo $(touch /tmp/PWNED) bar'` triggered RCE via the
// execSync string-build path. This helper fixes both call sites (F1b, F1c).
//
// Exported functions:
//   invokeNodeJson(scriptPath, args, opts)  — invoke node script, parse JSON output
//   invokeNodeText(scriptPath, args, opts)  — invoke node script, return raw string
//
// Per ADR-0001 fail-open discipline: errors are logged to stderr; null returned
// so callers can continue with partial context.

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Invoke a Node.js script via execFileSync (no shell) and parse its stdout as JSON.
 * Returns null on error (per ADR-0001 fail-open discipline).
 *
 * @param {string} scriptPath — absolute path to the node script
 * @param {string[]} args — argument array (never passed through shell)
 * @param {object} [opts] — { timeout?: number, cwd?: string }
 * @returns {object|null}
 */
function invokeNodeJson(scriptPath, args, opts = {}) {
  try {
    const out = execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf8',
      timeout: opts.timeout || 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });
    return JSON.parse(out);
  } catch (err) {
    process.stderr.write(`safe-exec: ${path.basename(scriptPath)} failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Invoke a Node.js script via execFileSync (no shell) and return its stdout as a string.
 * Returns null on error (per ADR-0001 fail-open discipline).
 *
 * @param {string} scriptPath — absolute path to the node script
 * @param {string[]} args — argument array (never passed through shell)
 * @param {object} [opts] — { timeout?: number, cwd?: string }
 * @returns {string|null}
 */
function invokeNodeText(scriptPath, args, opts = {}) {
  try {
    return execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf8',
      timeout: opts.timeout || 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });
  } catch (err) {
    process.stderr.write(`safe-exec: ${path.basename(scriptPath)} failed: ${err.message}\n`);
    return null;
  }
}

module.exports = { invokeNodeJson, invokeNodeText };
