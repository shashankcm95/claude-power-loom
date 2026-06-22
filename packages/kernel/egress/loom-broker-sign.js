#!/usr/bin/env node
// Power Loom egress — loom-broker-sign.js  (③.2.5b)
//
// The custody-holding CLI: the ONE legitimate per-process key-LOADER for the loom-broker. It reads its OWN private
// key from LOOM_BROKER_KEY_FILE, drains the approval CONTEXT preimage from stdin (bounded + deadlined), runs the
// WHO gate (caller-auth on SUDO_UID) then the WHAT gate (recompute-bind: re-derive the basis from the emission
// body, refuse a mismatch), signs the RECOMPUTED basis via the kernel crypto leaf, and prints ONLY the base64
// signature to stdout. Errors -> stderr (a FIXED message, NEVER key bytes, NEVER err.stack) + non-zero exit +
// EMPTY stdout. It NEVER prints the key.
//
// HONEST SCOPE (a custody MECHANISM; NOT custody-real here): custody is REAL only when this process runs under a
// SEPARATE uid — a DEPLOYMENT property, verified OUT-OF-BAND. SAME-UID, the host uid can still read the key file and
// ptrace this process. caller-auth (SUDO_UID) is unforgeable ONLY when sudo injected it (deployed
// `env_reset, !setenv`); on a DIRECT invoke the host forges it — so the cross-uid KEY CUSTODY is the real control.

'use strict';

const fs = require('fs');
const { signRecordId } = require('../_lib/edge-attestation');
const { authorizeCaller } = require('./loom-broker-caller-auth');
const { authorizeRequest } = require('./loom-broker-bind');

// the recomputed basis is a lowercase 64-hex sha256 (defensive re-gate before signing). Local check.
const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// the ctx carries a scrubbed emission.diff (larger than a PACT persona frame) -> a generous-but-bounded cap.
const MAX_CTX_BYTES = 1024 * 1024;   // 1 MiB volume bound (DoS)
const READ_DEADLINE_MS = 2000;       // wall-clock time bound (slow-loris) — a byte cap alone does not bound time

// Bounded + DEADLINED stdin read. A byte cap bounds VOLUME; the deadline bounds TIME (a never-EOF slow-loris pipe
// would otherwise hang forever — fs.readFileSync(0) is unbounded on both axes and is FORBIDDEN).
function readStdinBounded({ maxBytes, deadlineMs }) {
  return new Promise((resolve) => {
    const inp = process.stdin;
    const chunks = []; let len = 0; let settled = false;
    const finish = (val) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      inp.removeListener('data', onData); inp.removeListener('end', onEnd); inp.removeListener('error', onErr);
      try { inp.pause(); } catch { /* */ }
      resolve(val);
    };
    const onData = (c) => { len += c.length; if (len > maxBytes) { chunks.length = 0; return finish({ ok: false, reason: 'too-large' }); } chunks.push(c); };
    const onEnd = () => finish({ ok: true, data: Buffer.concat(chunks).toString('utf8') });
    const onErr = () => finish({ ok: false, reason: 'read-error' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'read-timeout' }), deadlineMs);
    inp.on('data', onData); inp.on('end', onEnd); inp.on('error', onErr);
    try { inp.resume(); } catch { finish({ ok: false, reason: 'read-error' }); }
  });
}

// stderr ONLY (never the key / never err.stack); empty stdout; non-zero exit.
function fail(msg) {
  process.stderr.write('loom-broker-sign: ' + msg + '\n');
  process.exit(1);
}

async function main() {
  // recompute-bind is ALWAYS-ON: drain the ctx preimage FIRST — before any gate that can process.exit — so the
  // host's execFileSync `input:` write always completes (else an early refuse EPIPEs the host).
  const rd = await readStdinBounded({ maxBytes: MAX_CTX_BYTES, deadlineMs: READ_DEADLINE_MS });
  if (!rd.ok) fail('ctx channel: ' + rd.reason); // too-large / timeout / read-error -> refuse, fail closed
  const presentedCtxRaw = rd.data;

  // (0) caller-auth gate (WHO) — keyed on SUDO_UID (sudo-injected REAL uid under env_reset,!setenv). SUDO_USER is
  // root-spoofable — NEVER authorize on it. The allowlist is set BROKER-SIDE in the root-owned wrapper. Loom
  // deny-on-unset: an unset allowlist DENIES (fail closed). Config errors are operator-facing + safe to name; an
  // auth denial is a FIXED no-echo message (an echo is an allowlist-probing oracle).
  const auth = authorizeCaller({ sudoUid: process.env.SUDO_UID, allowlistRaw: process.env.LOOM_BROKER_ALLOWED_UIDS });
  if (auth.decision !== 'allow') {
    if (auth.reason === 'allowlist-unset' || auth.reason === 'allowlist-malformed') {
      return fail('caller-auth misconfigured: ' + auth.reason + ' (set LOOM_BROKER_ALLOWED_UIDS in the wrapper)');
    }
    return fail('caller not authorized');
  }

  // (0.5) recompute-bind gate (WHAT) — re-derive the basis from the emission body on stdin; sign the COMPUTED
  // basis, never the caller-asserted argv. Runs BEFORE the key open (an unauthorized request never touches the
  // key/TOCTOU surface). Reject is a FIXED no-echo message.
  const req = authorizeRequest({ claimedBasis: process.argv[2], presentedCtxRaw });
  if (req.decision !== 'allow') return fail('request not authorized');
  const basisToSign = req.basisToSign;
  if (!isHex64(basisToSign)) return fail('internal: recomputed basis not 64-hex'); // defensive; unreachable

  // (1) vet the key path SWAP-RESISTANTLY: open with O_NOFOLLOW (refuses a symlink AT open, atomically) +
  // O_NONBLOCK (a FIFO/device key path opens immediately instead of HANGING), then fstat the RESOLVED fd (the
  // inode, immune to a path swap) and read THAT fd — no second path resolution. A private key must be a regular,
  // tightly-permissioned file (not group/world-writable).
  const keyFile = process.env.LOOM_BROKER_KEY_FILE;
  // `return fail(...)` for consistency with every other bail below (fail() exits today, but the explicit return
  // keeps the bail-here signal if fail() is ever refactored to throw — VALIDATE reviewer MED).
  if (typeof keyFile !== 'string' || keyFile.length === 0) return fail('LOOM_BROKER_KEY_FILE is required');
  let fd;
  try { fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { return fail(e && e.code === 'ELOOP' ? 'key file must not be a symlink' : 'key file not found / unreadable'); }
  // close-before-fail: fail() calls process.exit, which SKIPS a finally — so the interior reject paths close the
  // fd explicitly. CHECK-before-READ preserved. A minimal try/finally wraps ONLY the read so a throw also closes.
  let pem;
  try {
    const st = fs.fstatSync(fd);                                  // the OPEN fd's inode — swap-immune
    if (!st.isFile()) { try { fs.closeSync(fd); } catch { /* */ } return fail('key file must be a regular file'); }
    // OWNER-ONLY: reject ANY group/world permission bit (`& 0o077`), not just writable. A group/world-READABLE
    // key (e.g. 0644/0640) lets a non-broker uid read it and mint approvals OUTSIDE the broker — defeating custody
    // (CodeRabbit Major, probed: a 0644 key was accepted). A 0600 key passes; anything looser refuses.
    if (st.mode & 0o077) { try { fs.closeSync(fd); } catch { /* */ } return fail('key file must be owner-only (mode 0600) — not group/world accessible'); }
  } catch { try { fs.closeSync(fd); } catch { /* */ } return fail('key file unstattable'); }
  try { pem = fs.readFileSync(fd, 'utf8'); } finally { try { fs.closeSync(fd); } catch { /* */ } }

  // (2) sign the RECOMPUTED basis via the SAME alg-pinned ed25519 leaf the host uses (output re-gated by the leaf).
  const sig = signRecordId(basisToSign, { privateKeyPem: pem });
  if (!sig) fail('sign failed (no / non-ed25519 key, or bad output)');

  process.stdout.write(sig + '\n'); // ONLY the sig — nothing else
}

// Any unexpected throw fails CLOSED (a FIXED message, NEVER key bytes / err.stack), preserving the empty-stdout +
// non-zero-exit contract.
main().catch(() => fail('internal error'));
