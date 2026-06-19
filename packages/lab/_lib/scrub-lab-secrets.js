#!/usr/bin/env node

// @loom-layer: lab
//
// ③.1-W4d Item 2a — the shared lab secret-scrub helper. The lesson-capture persistence
// path (causal-edge/lesson-capture.js) writes the candidate-patch BYTES + the LLM-derived
// lesson_body to a lab-state dir; a secret echoed into either would be immortalized in a
// world-readable file. scrubLabSecrets is the single coarse redaction chokepoint for that
// path. It mirrors spawn-record.js's scrubSecrets surface EXACTLY = the canonical no-FP
// classes + the four coarse SCRUBBER-ONLY classes (URL-embedded password, coarse sk-,
// Stripe TEST sk_test_/rk_test_, AWS-secret assignment). Canonical-only is strictly weaker
// (a sk-proj-… / bare sk-… / https://u:pw@host / aws_secret_access_key=… all survive it).
//
// COARSE DEFENSE-IN-DEPTH, not a primary control — exactly like spawn-record's scrubber.
// The primary controls are a real secret-management discipline + the ③.2 PR-egress
// pre-scrubber. Item 2d (0700 dir-perms) is the amplifier-close on the same threat model.
//
// Imports ONLY kernel/_lib (the secret-pattern SSOT — lab->kernel = LEGAL; precedent:
// candidate-sidecar.js, trace-store.js, _clone-lifecycle.js) + node core. PURE: no I/O,
// no STATE. RETURNS A NEW STRING — never mutates its argument.
//
// WHY CALL THE FACTORIES ONCE AT MODULE LOAD (not per-call): each /g RegExp carries a
// mutable lastIndex. .replace() self-resets lastIndex, so reusing this module's own
// fresh instances across calls is safe (the factory's guarantee is cross-CONSUMER
// isolation — no OTHER consumer shares these objects). One mint at load, owned here.

'use strict';

const { getCanonicalSecretClasses, getScrubberOnlyClasses } = require('../../kernel/_lib/secret-patterns');

// The full scrub surface = canonical no-FP classes + the coarse scrubber-only extras.
// Minted ONCE here so this module owns its own RegExp instances (see header).
const REGEXES = [...getCanonicalSecretClasses(), ...getScrubberOnlyClasses()].map((c) => c.regex);

/**
 * Coarse-redact every known secret class from `text`, returning a NEW string.
 * Empty / null / undefined pass through unchanged (so callers can scrub an absent field
 * without a guard). A non-string is coerced to a string before scrubbing.
 *
 * @param {*} text the free-form content to redact (candidate patch bytes / lesson_body).
 * @returns {*} the scrubbed string, or the original empty/nullish value unchanged.
 */
function scrubLabSecrets(text) {
  // Short-circuit ONLY nullish/empty (CodeRabbit): a falsy `0`/`false` is a real value that the
  // contract coerces + scrubs (a no-op for them, but the return type must be the scrubbed string).
  if (text === null || text === undefined || text === '') return text;
  let out = String(text);
  for (const p of REGEXES) out = out.replace(p, '[REDACTED]');
  return out;
}

module.exports = { scrubLabSecrets };
