#!/usr/bin/env node
// Power Loom egress — loom-custody-verify.js  (③.2.5b)
//
// The OUT-OF-BAND custody verifier: the operator runs this AS THE HOST UID on the deployed box to check every
// custody condition the host uid can OBSERVE, and to surface the one it CANNOT (that the running broker PROCESS is
// genuinely the other uid). It NEVER asserts custody-real (NS-9): it reports `hostObservableChecksPassed` +
// `requiresOutOfBandUidConfirmation`. Only the operator's out-of-band uid attestation (`id` / `ls -l` / `cat`)
// HARDENS — the kernel's EACCES under a genuinely separate uid is the world-anchored signal; this tool checks the
// necessary (not sufficient) condition.
//
// PURE `assessCustody(facts)` (the verdict — testable for the cross-uid TRUE branch via SYNTHETIC facts a same-uid
// box can never produce) + impure `gatherCustodyFacts` (the I/O). C3 (a real sign+verify round-trip) is the
// load-bearing NON-VACUITY proof — a real, usable key exists behind the broker WITHOUT the host reading/statting it.
//
// PORTED from PACT custody-verify.js; C3 adapted: the live-sign probe presents a minimal emission CONTEXT and
// verifies the broker's signature over the freshness-bound BASIS against the pinned verify key.

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { verifyRecordSig } = require('../_lib/edge-attestation');
const { computeEmissionHash, approvalSigBasis } = require('./approval');

// the denial leg counts ONLY for these — any OTHER open error (ELOOP symlink / ENXIO FIFO / EISDIR / ENOENT) is a
// custody-leg ERROR, never silently treated as "denied".
const DENIAL_ERRNOS = new Set(['EACCES', 'EPERM']);

/**
 * PURE verdict over observed facts. No I/O.
 * @param {{
 *   isRoot:boolean,
 *   keyStat:{ok:true,isFile:boolean,size:number,ownerUid:number}|{ok:false,errno:string},
 *   hostRead:{ok:true}|{ok:false,errno:string},
 *   runningUid:number|null,
 *   sign:{signed:boolean,sigVerifies:boolean},
 *   wrapper:null|{ok:true,isFile:boolean,worldOrGroupWritable:boolean,ownerUid:number}|{ok:false,errno:string}
 * }} facts
 * @returns {{hostObservableChecksPassed:boolean, requiresOutOfBandUidConfirmation:boolean, checks:object[], residuals:string[]}}
 */
function assessCustody(facts = {}) {
  const checks = [];
  const residuals = [];
  let verified = true;
  let denialLegTaken = false;
  const fail = (id, detail) => { checks.push({ id, status: 'FAIL', detail }); verified = false; };
  const pass = (id, detail) => checks.push({ id, status: 'PASS', detail });
  const note = (id, detail) => checks.push({ id, status: 'NOTE', detail });

  // C0 — root / uid-model guard (POSIX perms use the EFFECTIVE uid; isRoot folds getuid||geteuid===0). A null or
  // non-integer runningUid (no getuid — non-POSIX — or a forged NaN fact) fails CLOSED: the owner-uid disambiguator
  // below cannot run. The !Number.isInteger guard matches the actor + edge twins (a NaN runningUid would otherwise
  // C0-PASS, then C2's `ownerUid === NaN` is always false -> the denial leg would false-PASS).
  if (facts.isRoot) fail('C0-root', 'running as root (real or effective uid 0) — root bypasses file permissions; uid separation is unobservable from here');
  else if (facts.runningUid === null || facts.runningUid === undefined || !Number.isInteger(facts.runningUid)) fail('C0-root', 'uid model unavailable / invalid on this platform (getuid undefined or a non-integer like NaN) — cross-uid custody cannot be verified here');
  else pass('C0-root', 'not running as root (uid ' + facts.runningUid + ')');

  // C1 — non-vacuity, best-effort via lstat (NEVER a read — survives the real cross-uid case where the host cannot
  // read the broker key). C3 below is the load-bearing non-vacuity proof.
  const ks = facts.keyStat || {};
  if (ks.ok) {
    if (!ks.isFile) fail('C1-keypresent', 'key path is not a regular file (symlink/FIFO/dir) — no key to protect');
    else if (!(ks.size > 0)) fail('C1-keypresent', 'key file is empty — vacuous: no key to protect');
    else pass('C1-keypresent', 'key file present + non-empty (' + ks.size + ' bytes)');
  } else if (ks.errno && DENIAL_ERRNOS.has(ks.errno)) {
    note('C1-keypresent', 'cannot stat the key (the key directory is locked down — ' + ks.errno + '); non-vacuity rests on the C3 live sign');
  } else {
    fail('C1-keypresent', 'cannot stat the key path (' + (ks.errno || 'unknown') + ') — key absent / path broken');
  }

  // C2 — the custody (denial) leg. Branch ONLY on the open errno, and disambiguate MODE-vs-uid via the key OWNER
  // so a same-owner mode-000 file can never false-pass.
  const hr = facts.hostRead || {};
  if (hr.ok) {
    fail('C2-denied', 'the host uid CAN read the key file — custody is NOT real (same-uid / over-permissive)');
  } else if (hr.errno && DENIAL_ERRNOS.has(hr.errno)) {
    // The denial leg requires a POSITIVELY-PROVEN different owner. Owner-unknown is NOT a pass: the host cannot
    // distinguish a genuinely cross-uid key from its OWN locked-dir key, so it proves nothing — fail-closed.
    // Number.isInteger (NOT typeof === 'number', which is true for NaN): a forged non-integer owner/uid must
    // not slip the guard and false-PASS the denial leg (cross-verifier NaN-hardening, byte-identical across the
    // broker/actor/edge twins).
    if (ks.ok && Number.isInteger(ks.ownerUid) && Number.isInteger(facts.runningUid)) {
      if (ks.ownerUid === facts.runningUid) {
        fail('C2-denied', 'host read denied (' + hr.errno + ') BUT the key is owned by the running uid (' + ks.ownerUid + ') — EACCES is from file MODE, not uid separation. NOT cross-uid custody.');
      } else {
        denialLegTaken = true;
        pass('C2-denied', 'host read denied (' + hr.errno + ') + key FILE owned by a DIFFERENT uid (' + ks.ownerUid + ' != ' + facts.runningUid + ') — NECESSARY only; it is still UNPROVEN that the running broker PROCESS is uid ' + ks.ownerUid + ' (attest out-of-band)');
      }
    } else {
      fail('C2-denied', 'host read denied (' + hr.errno + ') but the key OWNER is unreadable (the key directory is not traversable to the host) — the host cannot distinguish a cross-uid key from its own locked-dir key. Relax the key DIR to 0755 (the key stays 0600) so the owner is confirmable, or rely entirely on the out-of-band attestation.');
    }
  } else {
    fail('C2-denied', 'host read failed with ' + (hr.errno || 'unknown') + ' (not EACCES/EPERM) — the key path is a symlink/FIFO/dir/absent; cannot establish the custody leg');
  }

  // C3 — liveness: the load-bearing NON-VACUITY + functional proof. Two distinct diagnostics.
  const sg = facts.sign || {};
  if (!sg.signed) fail('C3-liveness', 'broker returned NO signature — sudo/wiring/exec failure (check sudoers, wrapper perms, -n, and that the operator uid is on LOOM_BROKER_ALLOWED_UIDS) or no usable key');
  else if (!sg.sigVerifies) fail('C3-liveness', 'broker signed but the signature does NOT verify against the pinned verify key — key <-> verify-key mismatch (check the custody verify-key file)');
  else pass('C3-liveness', 'broker produced a signature over the freshness basis that verifies against the pinned key — a real, usable key exists behind the broker');

  // C2.5 — wrapper integrity (only if a wrapperPath was provided). A host-writable wrapper is a privesc path: the
  // host edits the script sudo execs as the broker uid -> code execution as the broker uid -> key exfil.
  if (facts.wrapper) {
    // --wrapper WAS supplied, so an unstatable wrapper / unobservable owner / non-root owner is a FAIL, not an
    // advisory NOTE (CodeRabbit Major): leaving them as NOTE/PASS lets hostObservableChecksPassed go true without
    // proving the documented root:root wrapper contract — a fail-OPEN gap in a security verifier. Mirrors the
    // loom-edge-custody-verify.js C2.5 fold; the actor twin already FAILs on unstatable.
    const w = facts.wrapper;
    if (!w.ok) fail('C2.5-wrapper', 'sudo wrapper not statable (' + (w.errno || 'unknown') + ') — cannot establish wrapper integrity');
    else if (!w.isFile) fail('C2.5-wrapper', 'the sudo wrapper is not a regular file (symlink/dir) — hijackable');
    else if (w.worldOrGroupWritable) fail('C2.5-wrapper', 'the sudo wrapper is group/world-writable — the host can run code as the broker uid (privesc)');
    else if (!Number.isInteger(w.ownerUid)) fail('C2.5-wrapper', 'the sudo wrapper owner uid is unavailable — cannot establish wrapper integrity');
    else if (Number.isInteger(facts.runningUid) && w.ownerUid === facts.runningUid) fail('C2.5-wrapper', 'the sudo wrapper is OWNED by the host uid (' + w.ownerUid + ') — its owner can chmod/edit it and have sudo run attacker code as the broker uid (privesc). Own it root:root.');
    else if (w.ownerUid !== 0) fail('C2.5-wrapper', 'the sudo wrapper is not root-owned (' + w.ownerUid + ') — own it root:root to establish wrapper integrity');
    else pass('C2.5-wrapper', 'sudo wrapper is a regular, root-owned, non-group/world-writable file not owned by the host uid');
  } else {
    note('C2.5-wrapper', 'wrapper integrity NOT checked — pass wrapperPath to enable');
  }

  // The bind-gap is UNCONDITIONAL on the passed path (integrity != provenance): C2 proves a file is owned by a
  // different uid; C3 proves a signer works; the tool NEVER binds the two (that the signing PROCESS runs as that
  // uid + uses that key) — only the operator can, out-of-band. So the field is `hostObservableChecksPassed`, NOT
  // `custodyVerified`.
  if (denialLegTaken) {
    residuals.push('binding (out-of-band, the SOLE determiner): this tool checked only what the host uid can observe — that a key file is owned by another uid + the broker mechanism signs. It does NOT and CANNOT prove the signing PROCESS runs as that uid. Confirm out-of-band (`id`, `ls -l <key>`, `cat <key>` -> Permission denied) that the broker truly runs as the key-owner uid. ONLY that decides custody-real.');
  }
  return {
    hostObservableChecksPassed: verified,
    requiresOutOfBandUidConfirmation: denialLegTaken,
    checks,
    residuals,
  };
}

/** Gather the observed facts from real I/O (impure). */
function gatherCustodyFacts(opts = {}) {
  const { keyFile, signer, verifyKeyPem, wrapperPath } = opts;
  const ruid = typeof process.getuid === 'function' ? process.getuid() : null;
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  const isRoot = ruid === 0 || euid === 0;
  // POSIX file permissions are evaluated against the EFFECTIVE uid (the open() that drives C2-denied uses euid), so
  // the C2 owner-disambiguation must compare the key owner to euid, not the real uid (CodeRabbit: a setuid/seteuid
  // launch with euid != ruid would misclassify mode-lockdown vs real cross-uid separation). Fall back to ruid when
  // geteuid is unavailable (non-POSIX -> null -> C0 fails closed). assessCustody's own comment already says euid.
  const runningUid = Number.isInteger(euid) ? euid : ruid;

  // C1 — lstat (path-level metadata, read-permitted on a present-but-unreadable file in a traversable dir).
  let keyStat;
  try {
    const st = fs.lstatSync(keyFile);
    keyStat = { ok: true, isFile: st.isFile(), size: st.size, ownerUid: st.uid };
  } catch (e) { keyStat = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C2 — the open attempt (content-level). O_NOFOLLOW refuses a symlink atomically AT open; O_NONBLOCK so a FIFO
  // key path opens immediately instead of HANGING. A successful open IS the readability signal; close immediately.
  let hostRead;
  try {
    const fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try { fs.closeSync(fd); } catch { /* */ }
    hostRead = { ok: true };
  } catch (e) { hostRead = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C3 — the live sign probe: present a minimal emission context with a RANDOM nonce (un-special-caseable), build
  // the freshness basis exactly as recordApproval would, ask the broker to sign, and verify the sig over the basis
  // against the pinned verify key (no env fallback). Works through the real cross-uid sudo path.
  let sign = { signed: false, sigVerifies: false };
  try {
    const emission = { repo: 'loom-broker/custody-probe', issueRef: 1, diff: 'custody-probe' };
    // OQ-3 (fold F6) + F-W2b (fold D9): the probe ctx + basis carry lesson_commitment:'' AND requestedBaseSha:'' —
    // the no-lesson / no-base sentinels shared with every real dormant emission, so the probe basis matches what
    // recordApproval signs for a no-lesson/no-base approval (the C3 self-test stays valid over the 6-field basis).
    const ctx = { emission, approvedAt: 1, nonce: crypto.randomBytes(16).toString('hex'), key_id: 'custody-probe', lesson_commitment: '', requestedBaseSha: '' };
    const basis = approvalSigBasis({ hash: computeEmissionHash(emission), approvedAt: ctx.approvedAt, nonce: ctx.nonce, key_id: ctx.key_id, lesson_commitment: ctx.lesson_commitment, requestedBaseSha: ctx.requestedBaseSha });
    const sig = typeof signer === 'function' ? signer(basis, ctx) : null;
    if (sig) {
      sign.signed = true;
      sign.sigVerifies = !!(verifyKeyPem && verifyRecordSig(basis, sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false }));
    }
  } catch { /* fail-closed — signed stays false */ }

  // C2.5 — wrapper integrity (optional). lstat (not follow) + the group/world-writable bit-logic.
  let wrapper = null;
  if (typeof wrapperPath === 'string' && wrapperPath.length) {
    try {
      const st = fs.lstatSync(wrapperPath);
      wrapper = { ok: true, isFile: st.isFile(), worldOrGroupWritable: !!(st.mode & 0o022), ownerUid: st.uid };
    } catch (e) { wrapper = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }
  }

  return { isRoot, keyStat, hostRead, runningUid, sign, wrapper };
}

/** gather -> assess. */
function verifyCrossUidCustody(opts = {}) {
  return assessCustody(gatherCustodyFacts(opts));
}

// ===================================== CLI (the operator runs this) =====================================

function formatReport(report) {
  const lines = [];
  for (const c of report.checks) lines.push('  [' + c.status.padEnd(4) + '] ' + c.id + ' — ' + c.detail);
  lines.push('');
  lines.push('hostObservableChecksPassed: ' + report.hostObservableChecksPassed);
  lines.push('requiresOutOfBandUidConfirmation: ' + report.requiresOutOfBandUidConfirmation);
  for (const r of report.residuals) lines.push('  residual: ' + r);
  lines.push('');
  if (report.hostObservableChecksPassed && report.requiresOutOfBandUidConfirmation) {
    lines.push('HOST-OBSERVABLE CHECKS PASSED — this is NOT a verification of custody-real. This tool cannot');
    lines.push('observe uid separation; only YOUR out-of-band check decides custody is real. Confirm that the');
    lines.push('key is owned by a genuinely DIFFERENT uid (run: `id` and `ls -l <key>` — the owner must differ');
    lines.push('from your uid; `cat <key>` must be Permission denied) AND that the broker runs as that uid.');
    lines.push('The --attested-cross-uid flag only records that YOU attested it — it changes the exit code,');
    lines.push('NOT the proof. (Custody-real is a deployment property; no flag and no green check establishes it.)');
  } else if (!report.hostObservableChecksPassed) {
    lines.push('NOT VERIFIED — a host-observable check FAILED; custody is not real here (see the FAIL line(s) above).');
  }
  return lines.join('\n');
}

const VALUE_FLAGS = { '--key': 'keyFile', '--verify-key': 'verifyKeyFile', '--broker-user': 'brokerUser', '--wrapper': 'wrapperPath', '--sudo': 'sudoPath' };

function parseArgv(argv, onError) {
  const die = typeof onError === 'function' ? onError : (m) => { throw new Error(m); };
  const o = { attested: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--attested-cross-uid') { o.attested = true; continue; }
    const field = VALUE_FLAGS[a];
    if (!field) { die('unknown argument: ' + a); return o; }
    // a value-taking flag must be followed by a real value — never the end of argv and never another flag.
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('-')) { die(a + ' requires a value'); return o; }
    o[field] = val; i++;
  }
  return o;
}

// Extracted from main() (mirrors loom-edge-custody-verify.js:runEdgeCustodyCheck / approve-cli.js:runApprove) so a
// test can inject signerFactory and assert the probe engages the neutral cwd WITHOUT a real cross-uid spawn.
// deps.signerFactory defaults to the real crossUidLoomBrokerSigner (lazy require, as main() did before). Takes an
// already-read verifyKeyPem (main() keeps the readFileSync).
function runCustodyCheck(opts, deps = {}) {
  const signerFactory = deps.signerFactory || require('./loom-broker-launch').crossUidLoomBrokerSigner;
  // neutralizeCwd:true — a custody property must not depend on WHERE the operator ran the verify from (#436-parity,
  // the broker twin of the actor/edge fixes). sudoPath is forwarded verbatim so the operator's --sudo override holds.
  const signer = signerFactory({ brokerUser: opts.brokerUser, wrapperPath: opts.wrapperPath, sudoPath: opts.sudoPath, neutralizeCwd: true });
  return verifyCrossUidCustody({ keyFile: opts.keyFile, signer, verifyKeyPem: opts.verifyKeyPem, wrapperPath: opts.wrapperPath });
}

function main() {
  const usage = 'usage: loom-custody-verify --key <broker-key> --verify-key <pubkey.pem> --broker-user <user> --wrapper <abs-path> [--sudo <abs-path>] [--attested-cross-uid]\n';
  const o = parseArgv(process.argv.slice(2), (m) => { process.stderr.write('loom-custody-verify: ' + m + '\n' + usage); process.exit(2); });
  if (!o.keyFile || !o.verifyKeyFile || !o.brokerUser || !o.wrapperPath) {
    process.stderr.write(usage);
    process.exit(2);
  }
  let verifyKeyPem;
  try { verifyKeyPem = fs.readFileSync(o.verifyKeyFile, 'utf8'); }
  catch (e) { process.stderr.write('loom-custody-verify: cannot read verify-key: ' + (e && e.message) + '\n'); process.exit(2); }

  const report = runCustodyCheck({ keyFile: o.keyFile, verifyKeyPem, brokerUser: o.brokerUser, wrapperPath: o.wrapperPath, sudoPath: o.sudoPath });
  process.stdout.write(formatReport(report) + '\n');

  // the exit code is NEVER greener than the report. Exit 0 ONLY when the host-observable checks passed AND the
  // operator has explicitly attested the out-of-band uid check.
  const clean = report.hostObservableChecksPassed && (!report.requiresOutOfBandUidConfirmation || o.attested);
  process.exit(clean ? 0 : 1);
}

if (require.main === module) main();

module.exports = { assessCustody, gatherCustodyFacts, verifyCrossUidCustody, formatReport, runCustodyCheck };
