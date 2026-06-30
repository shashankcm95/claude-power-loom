#!/usr/bin/env node
// @loom-layer: kernel
//
// Power Loom egress — loom-edge-sign.js  (PR-A2b W2b)
//
// The custody-holding CLI for the WORLD-ANCHOR EDGE signer: the ONE legitimate per-process key-LOADER for the
// cross-uid edge broker — the symmetric twin of loom-broker-sign.js, one custody domain over. It reads its OWN
// private key from LOOM_EDGE_KEY_FILE, drains the edge CONTEXT preimage from stdin (bounded + deadlined), runs the
// WHO gate (caller-auth on SUDO_UID) then the WHAT gate (loom-edge-bind recompute-bind: re-derive the edge-id basis
// from the {from_node_id, to_delta_ref, edge_type} body, refuse a mismatch), signs the RECOMPUTED basis via the
// kernel crypto leaf, and prints ONLY the base64 signature to stdout. Errors -> stderr (a FIXED message, NEVER key
// bytes, NEVER err.stack) + non-zero exit + EMPTY stdout. It NEVER prints the key.
//
// SHADOW + weight-inert (PR-A2b W2b): the world-anchor store passes signer:undefined in production
// (LIVE_SOURCES = Object.freeze([])), so nothing here signs a real edge or gates a real action this wave. This ships
// the MECHANISM (a real, custody-real-capable cross-uid edge signer); wiring it into a live mint is PR-B (the Rubicon).
//
// HONEST SCOPE (a custody MECHANISM; NOT custody-real here — ported from loom-broker-sign.js:11-14 +
// loom-broker-caller-auth.js:12-15): custody is REAL only when this process runs under a SEPARATE uid — a DEPLOYMENT
// property, verified OUT-OF-BAND (loom-edge-custody-verify.js). SAME-UID, the host uid can still read the key file and
// ptrace this process. caller-auth (SUDO_UID) is unforgeable ONLY when sudo injected it (deployed
// `env_reset, !setenv`); on a DIRECT (non-sudo) invoke the host forges SUDO_UID freely — so the cross-uid KEY CUSTODY
// is the real control. The WHO gate stays (defense-in-depth + the deployed case) but is NOT itself a boundary.
// integrity != provenance: this signer proves CUSTODY OF THE KEY, not that from_node_id is world-anchored (PR-B).

'use strict';

const fs = require('fs');
const { signEdgeId } = require('../_lib/edge-attestation');
const { authorizeCaller } = require('./loom-broker-caller-auth');
const { authorizeRequest } = require('./loom-edge-bind');

// the recomputed basis is a lowercase 64-hex sha256 (defensive re-gate before signing). Local check.
const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// (D5) the edge body is {from_node_id(64hex), to_delta_ref(64hex), edge_type} ~ 180 B; 16 KiB is generous-but-tiny
// vs the broker's 1 MiB (the broker carries a scrubbed diff; the edge does not). This is the ONLY volume bound on
// edge_type before the bind (loom-edge-bind ALLOWs an arbitrary-length non-empty type — the W2a F9 asymmetry; the lab
// store, not the bind, gates the type-set). Do NOT raise toward 1 MiB.
const MAX_EDGE_BYTES = 16 * 1024;   // 16 KiB volume bound (DoS)
const READ_DEADLINE_MS = 2000;      // wall-clock time bound (slow-loris) — a byte cap alone does not bound time

// Bounded + DEADLINED stdin read. A byte cap bounds VOLUME; the deadline bounds TIME (a never-EOF slow-loris pipe
// would otherwise hang forever — fs.readFileSync(0) is unbounded on both axes and is FORBIDDEN).
function readStdinBounded({ maxBytes, deadlineMs }) {
  return new Promise((resolve) => {
    const inp = process.stdin;
    const chunks = []; let len = 0; let settled = false; let tooLarge = false;
    const finish = (val) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      inp.removeListener('data', onData); inp.removeListener('end', onEnd); inp.removeListener('error', onErr);
      try { inp.pause(); } catch { /* */ }
      resolve(val);
    };
    // On too-large, MARK + keep DISCARDING (do not finish/pause mid-stream): a streaming caller that is still writing
    // would EPIPE/short-write if we stopped reading early — the same "always complete the drain" reason main() drains
    // FIRST. Memory stays bounded (chunks cleared, nothing accumulates past the cap); the deadline still bounds TIME.
    const onData = (c) => {
      len += c.length;
      if (tooLarge) return;
      if (len > maxBytes) { chunks.length = 0; tooLarge = true; return; }
      chunks.push(c);
    };
    const onEnd = () => finish(tooLarge ? { ok: false, reason: 'too-large' } : { ok: true, data: Buffer.concat(chunks).toString('utf8') });
    const onErr = () => finish({ ok: false, reason: 'read-error' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'read-timeout' }), deadlineMs);
    inp.on('data', onData); inp.on('end', onEnd); inp.on('error', onErr);
    try { inp.resume(); } catch { finish({ ok: false, reason: 'read-error' }); }
  });
}

// stderr ONLY (never the key / never err.stack); empty stdout; non-zero exit.
function fail(msg) {
  process.stderr.write('loom-edge-sign: ' + msg + '\n');
  process.exit(1);
}

async function main() {
  // recompute-bind is ALWAYS-ON: drain the ctx preimage FIRST — before any gate that can process.exit — so the
  // host's execFileSync `input:` write always completes (else an early refuse EPIPEs the host). The 16 KiB cap is
  // the ONLY volume bound on edge_type and MUST run BEFORE the WHAT gate (mirrors loom-broker-sign.js:62).
  const rd = await readStdinBounded({ maxBytes: MAX_EDGE_BYTES, deadlineMs: READ_DEADLINE_MS });
  if (!rd.ok) fail('ctx channel: ' + rd.reason); // too-large / timeout / read-error -> refuse, fail closed
  const presentedCtxRaw = rd.data;

  // (0) caller-auth gate (WHO) — keyed on SUDO_UID (sudo-injected REAL uid under env_reset,!setenv). SUDO_USER is
  // root-spoofable — NEVER authorize on it. The allowlist is set EDGE-SIDE in the root-owned wrapper. Loom
  // deny-on-unset: an unset allowlist DENIES (fail closed). Config errors are operator-facing + safe to name; an
  // auth denial is a FIXED no-echo message (an echo is an allowlist-probing oracle).
  const auth = authorizeCaller({ sudoUid: process.env.SUDO_UID, allowlistRaw: process.env.LOOM_EDGE_ALLOWED_UIDS });
  if (auth.decision !== 'allow') {
    if (auth.reason === 'allowlist-unset' || auth.reason === 'allowlist-malformed') {
      return fail('caller-auth misconfigured: ' + auth.reason + ' (set LOOM_EDGE_ALLOWED_UIDS in the wrapper)');
    }
    return fail('caller not authorized');
  }

  // (0.5) recompute-bind gate (WHAT) — loom-edge-bind re-derives the edge-id basis from the {from,to,type} body on
  // stdin (via the SAME kernel module the lab store uses) and signs the COMPUTED basis, never the caller-asserted
  // argv. Runs BEFORE the key open (an unauthorized request never touches the key/TOCTOU surface). Reject is a FIXED
  // no-echo message. This is loom-edge-bind's FIRST production caller.
  const req = authorizeRequest({ claimedBasis: process.argv[2], presentedCtxRaw });
  if (req.decision !== 'allow') return fail('request not authorized');
  const basisToSign = req.basisToSign;
  if (!isHex64(basisToSign)) return fail('internal: recomputed basis not 64-hex'); // defensive; unreachable

  // (1) vet the key path SWAP-RESISTANTLY (D6 — verbatim port of loom-broker-sign.js:90-108, LOOM_BROKER_KEY_FILE ->
  // LOOM_EDGE_KEY_FILE): open with O_NOFOLLOW (refuses a symlink AT open, atomically) + O_NONBLOCK (a FIFO/device
  // key path opens immediately instead of HANGING), then fstat the RESOLVED fd (the inode, immune to a path swap) and
  // read THAT fd — no second path resolution. A private key must be a regular, owner-only file.
  const keyFile = process.env.LOOM_EDGE_KEY_FILE;
  // `return fail(...)` for consistency with every other bail below (fail() exits today, but the explicit return keeps
  // the bail-here signal if fail() is ever refactored to throw).
  if (typeof keyFile !== 'string' || keyFile.length === 0) return fail('LOOM_EDGE_KEY_FILE is required');
  let fd;
  try { fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { return fail(e && e.code === 'ELOOP' ? 'key file must not be a symlink' : 'key file not found / unreadable'); }
  // close-before-fail: fail() calls process.exit, which SKIPS a finally — so the interior reject paths close the fd
  // explicitly. CHECK-before-READ preserved. A minimal try/finally wraps ONLY the read so a throw also closes.
  let pem;
  try {
    const st = fs.fstatSync(fd);                                  // the OPEN fd's inode — swap-immune
    if (!st.isFile()) { try { fs.closeSync(fd); } catch { /* */ } return fail('key file must be a regular file'); }
    // OWNER-ONLY: reject ANY group/world permission bit (`& 0o077`), not just writable. A group/world-READABLE key
    // (e.g. 0644/0640) lets a non-edge uid read it and mint edges OUTSIDE the broker — defeating custody. A 0600 key
    // passes; anything looser refuses.
    if (st.mode & 0o077) { try { fs.closeSync(fd); } catch { /* */ } return fail('key file must be owner-only (mode 0600) — not group/world accessible'); }
  } catch { try { fs.closeSync(fd); } catch { /* */ } return fail('key file unstattable'); }
  try { pem = fs.readFileSync(fd, 'utf8'); } finally { try { fs.closeSync(fd); } catch { /* */ } }

  // (2) sign the RECOMPUTED basis via the SAME alg-pinned ed25519 leaf the host uses (output re-gated by the leaf).
  const sig = signEdgeId(basisToSign, { privateKeyPem: pem });
  if (!sig) fail('sign failed (no / non-ed25519 key, or bad output)');

  process.stdout.write(sig + '\n'); // ONLY the sig — nothing else
}

// (D7) Any unexpected throw fails CLOSED (a FIXED message, NEVER key bytes / err.stack), preserving the empty-stdout
// + non-zero-exit contract. NOT `.catch(e => fail(e.message))` (an err.message can carry key/path detail).
main().catch(() => fail('internal error'));
