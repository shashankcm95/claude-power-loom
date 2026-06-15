#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the candidate-patch SIDECAR. The recall-graph node keeps only a
// content-address (candidate_patch_sha); the patch BYTES live here, one file per patch,
// named by the FULL sha256 (not the dead 16-char digest the bootcamp nodes carried —
// RFC Sec 1/8). This is the store that makes the candidate patch recoverable so the
// derivation leg has something to contrast against the accepted diff.
//
// THE STORE IS NOT A SANDBOX (#273 / #310): readCandidate RE-HASHES the body and
// rejects (fail-soft -> null) any file whose name disagrees with its content. A
// filename-only check is bypassable; verify CONTENT on read. writeCandidate verifies
// on write too (symmetric). Dedup is content-aware first-wins (a squat/truncated stub
// is REPAIRED, never silently kept).
//
// Imports ONLY kernel/_lib (atomic-write — lab->kernel = LEGAL) + node core. PURE of
// any runtime/kernel STATE. The full-sha here MUST equal the node's candidate_patch_sha
// (one content-address for the patch, two sites — a test asserts the equality).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'candidate-sidecar');
const HEX64 = /^[0-9a-f]{64}$/;

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }

// The ONE content-address for a candidate patch. Used as the sidecar filename AND as
// the node's candidate_patch_sha (the two-site digest-equality the board required).
function sidecarSha(patch) {
  return crypto.createHash('sha256').update(String(patch == null ? '' : patch)).digest('hex');
}

function readCandidate(sha, opts = {}) {
  if (!HEX64.test(String(sha || ''))) return null;
  const file = path.join(storeDir(opts), `${sha}.patch`);
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch { return null; }
  if (sidecarSha(body) !== sha) return null;                     // content must hash to the filename (#273)
  return body;
}

function writeCandidate(patch, opts = {}) {
  const sha = sidecarSha(patch);
  const dir = storeDir(opts);
  const file = path.join(dir, `${sha}.patch`);
  if (fs.existsSync(file)) {
    if (readCandidate(sha, opts) != null) return { ok: true, deduped: true, sha }; // valid prior — first-wins
    // unverifiable garbage (a squat / crash-truncated write) — REPAIR by overwriting.
    try { writeAtomicString(file, String(patch == null ? '' : patch)); }
    catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
    return { ok: true, deduped: false, repaired: true, sha };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomicString(file, String(patch == null ? '' : patch));
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, deduped: false, sha };
}

module.exports = { writeCandidate, readCandidate, sidecarSha, DEFAULT_DIR };
