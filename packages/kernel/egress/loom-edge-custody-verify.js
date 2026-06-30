#!/usr/bin/env node
// @loom-layer: kernel
//
// Power Loom egress — loom-edge-custody-verify.js  (PR-A2b W2b)
//
// The OUT-OF-BAND custody verifier for the WORLD-ANCHOR EDGE signer uid — the symmetric twin of
// loom-custody-verify.js (the broker's) and loom-actor-custody-verify.js (the actor's). The operator runs this AS THE
// HOST UID on the deployed box to check every custody condition the host uid can OBSERVE, and to surface the one it
// CANNOT (that the running edge-signer PROCESS is genuinely the other uid). It NEVER asserts custody-real (NS-9): it
// reports `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`. Only the operator's out-of-band uid
// attestation (`id` / `ls -l` / `cat`) HARDENS.
//
// MIRROR (bounded, intentional — the egress deliberate-duplication-for-independent-auditability convention; a separate
// trust domain; does NOT edit the shipped broker/actor verifiers — D13: the edge twin is the 3rd; a 4th makes the
// shared C0/C1/C2/C2.5 fact-gathering a consolidation candidate worth an ADR; NOT refactored here, YAGNI):
//   C0 not-root · C1 key present + non-vacuous (lstat, never read) · C2 host-read DENIED + owner-differs
//   disambiguation · C2.5 wrapper integrity (root-owned, not group/world-writable, not host-owned).
// EDGE-SPECIFIC:
//   C3 EDGE sign-liveness — present a GENUINE consistent edge ctx (random 64-hex endpoints, the fixed real
//       edge_type 'world-anchored-by'), recompute the probe basis via deriveWorldAnchorEdgeId (so the wrapper's
//       recompute-bind ALLOWs it — a non-consistent basis makes the bind REFUSE and C3 FAIL, the non-vacuity proof),
//       sign via the cross-uid edge signer, verify via verifyEdgeSig against the pinned verify key with NO env
//       fallback. (D8) the probe (basis, sig) is NEVER printed — only the boolean verdict (so the probe never emits a
//       reusable signature; replay-resistance is not a property of the deterministic edge sig — PR-B's full-tuple
//       freshness commitment defers it).
//
// (D4) C3 imports ONLY deriveWorldAnchorEdgeId (kernel/_lib) + verifyEdgeSig (edge-attestation). It MUST NOT import
//   ./approval (that carries the broker's computeEmissionHash/approvalSigBasis — the WRONG basis recipe for the edge;
//   a mechanical mirror of loom-custody-verify.js:23 would re-vacuate C3).
//
// HONEST SCOPE: this signer proves CUSTODY OF THE KEY, not that from_node_id is world-anchored (integrity !=
// provenance — PR-B's full-tuple commitment). custody-real is a DEPLOYMENT property; this tool checks the necessary
// (not sufficient) host-observable conditions + the live sign.

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { verifyEdgeSig } = require('../_lib/edge-attestation');
const { deriveWorldAnchorEdgeId } = require('../_lib/world-anchor-edge-id');

// the denial leg counts ONLY for these — any OTHER open error (ELOOP symlink / ENXIO FIFO / EISDIR / ENOENT) is a
// custody-leg ERROR, never silently treated as "denied".
const DENIAL_ERRNOS = new Set(['EACCES', 'EPERM']);

// the fixed real edge type the lab store accepts (WORLD_ANCHOR_EDGE_TYPE) — the C3 probe must use it so the probe is
// a genuinely persistable-shape edge (the type stays fixed; the endpoints are per-run random for un-special-caseability).
const PROBE_EDGE_TYPE = 'world-anchored-by';

const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

/**
 * PURE verdict over observed facts. No I/O. (MIRROR of assessCustody / assessActorCustody — a separate trust domain.)
 * @param {{
 *   isRoot:boolean,
 *   runningUid:number|null,
 *   keyStat:{ok:true,isFile:boolean,size:number,ownerUid:number}|{ok:false,errno:string},
 *   hostRead:{ok:true}|{ok:false,errno:string},
 *   sign:{signed:boolean,sigVerifies:boolean},
 *   wrapper:null|{ok:true,isFile:boolean,worldOrGroupWritable:boolean,ownerUid:number}|{ok:false,errno:string}
 * }} facts
 * @returns {{hostObservableChecksPassed:boolean, requiresOutOfBandUidConfirmation:boolean, checks:object[], residuals:string[]}}
 */
function assessEdgeCustody(facts = {}) {
  const checks = [];
  const residuals = [];
  let verified = true;
  let denialLegTaken = false;
  const fail = (id, detail) => { checks.push({ id, status: 'FAIL', detail }); verified = false; };
  const pass = (id, detail) => checks.push({ id, status: 'PASS', detail });
  const note = (id, detail) => checks.push({ id, status: 'NOTE', detail });

  // C0 — root / uid-model guard (POSIX perms use the EFFECTIVE uid; isRoot folds getuid||geteuid===0). A null
  // runningUid (no getuid — non-POSIX) fails CLOSED: the owner-uid disambiguator below cannot run.
  if (facts.isRoot) fail('C0-root', 'running as root (real or effective uid 0) — root bypasses file permissions; uid separation is unobservable from here');
  else if (facts.runningUid === null || facts.runningUid === undefined || !Number.isInteger(facts.runningUid)) fail('C0-root', 'uid model unavailable / invalid on this platform (getuid undefined or a non-integer like NaN) — cross-uid custody cannot be verified here');
  else pass('C0-root', 'not running as root (uid ' + facts.runningUid + ')');

  // C1 — non-vacuity, best-effort via lstat (NEVER a read — survives the real cross-uid case where the host cannot
  // read the edge key). C3 below is the load-bearing non-vacuity proof.
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

  // C2 — the custody (denial) leg. Branch ONLY on the open errno, and disambiguate MODE-vs-uid via the key OWNER so a
  // same-owner mode-000 file can never false-pass.
  const hr = facts.hostRead || {};
  if (hr.ok) {
    fail('C2-denied', 'the host uid CAN read the key file — custody is NOT real (same-uid / over-permissive)');
  } else if (hr.errno && DENIAL_ERRNOS.has(hr.errno)) {
    if (ks.ok && typeof ks.ownerUid === 'number' && typeof facts.runningUid === 'number') {
      if (ks.ownerUid === facts.runningUid) {
        fail('C2-denied', 'host read denied (' + hr.errno + ') BUT the key is owned by the running uid (' + ks.ownerUid + ') — EACCES is from file MODE, not uid separation. NOT cross-uid custody.');
      } else {
        denialLegTaken = true;
        pass('C2-denied', 'host read denied (' + hr.errno + ') + key FILE owned by a DIFFERENT uid (' + ks.ownerUid + ' != ' + facts.runningUid + ') — NECESSARY only; it is still UNPROVEN that the running edge-signer PROCESS is uid ' + ks.ownerUid + ' (attest out-of-band)');
      }
    } else {
      fail('C2-denied', 'host read denied (' + hr.errno + ') but the key OWNER is unreadable (the key directory is not traversable to the host) — the host cannot distinguish a cross-uid key from its own locked-dir key. Relax the key DIR to 0755 (the key stays 0600) so the owner is confirmable, or rely entirely on the out-of-band attestation.');
    }
  } else {
    fail('C2-denied', 'host read failed with ' + (hr.errno || 'unknown') + ' (not EACCES/EPERM) — the key path is a symlink/FIFO/dir/absent; cannot establish the custody leg');
  }

  // C3 — EDGE liveness: the load-bearing NON-VACUITY + functional proof. Two distinct diagnostics.
  const sg = facts.sign || {};
  if (!sg.signed) fail('C3-liveness', 'the edge signer returned NO signature — sudo/wiring/exec failure (check sudoers, wrapper perms, -n, and that the operator uid is on LOOM_EDGE_ALLOWED_UIDS), the recompute-bind refused the probe basis, or no usable key');
  else if (!sg.sigVerifies) fail('C3-liveness', 'the edge signer signed but the signature does NOT verify against the pinned verify key — key <-> verify-key mismatch (check the custody verify-key file)');
  else pass('C3-liveness', 'the edge signer produced a signature over a recomputed edge basis that verifies against the pinned key — a real, usable key exists behind the edge signer');

  // C2.5 — wrapper integrity (only if a wrapperPath was provided). A host-writable wrapper is a privesc path: the host
  // edits the script sudo execs as the edge-signer uid -> code execution as that uid -> key exfil.
  if (facts.wrapper) {
    // --wrapper WAS supplied, so an unstatable wrapper / unobservable owner / non-root owner is a FAIL, not an
    // advisory NOTE (CodeRabbit Major): leaving them as PASS/NOTE lets hostObservableChecksPassed go true without
    // proving the documented root:root wrapper contract (a fail-OPEN gap in a security verifier). The actor twin
    // already FAILs on unstatable; the edge tightens further to require root ownership (the runbook prescription).
    const w = facts.wrapper;
    if (!w.ok) fail('C2.5-wrapper', 'sudo wrapper not statable (' + (w.errno || 'unknown') + ') — cannot establish wrapper integrity');
    else if (!w.isFile) fail('C2.5-wrapper', 'the sudo wrapper is not a regular file (symlink/dir) — hijackable');
    else if (w.worldOrGroupWritable) fail('C2.5-wrapper', 'the sudo wrapper is group/world-writable — the host can run code as the edge-signer uid (privesc)');
    else if (typeof w.ownerUid !== 'number') fail('C2.5-wrapper', 'the sudo wrapper owner uid is unavailable — cannot establish wrapper integrity');
    else if (typeof facts.runningUid === 'number' && w.ownerUid === facts.runningUid) fail('C2.5-wrapper', 'the sudo wrapper is OWNED by the host uid (' + w.ownerUid + ') — its owner can chmod/edit it and have sudo run attacker code as the edge-signer uid (privesc). Own it root:root.');
    else if (w.ownerUid !== 0) fail('C2.5-wrapper', 'the sudo wrapper is not root-owned (' + w.ownerUid + ') — own it root:root to establish wrapper integrity');
    else pass('C2.5-wrapper', 'sudo wrapper is a regular, root-owned, non-group/world-writable file not owned by the host uid');
  } else {
    note('C2.5-wrapper', 'wrapper integrity NOT checked — pass --wrapper to enable');
  }

  // The bind-gap is UNCONDITIONAL on the passed path (integrity != provenance): C2 proves a file is owned by a
  // different uid; C3 proves a signer works; the tool NEVER binds the two (that the signing PROCESS runs as that uid +
  // uses that key) — only the operator can, out-of-band. So the field is `hostObservableChecksPassed`, NOT
  // `custodyVerified`.
  if (denialLegTaken) {
    residuals.push('binding (out-of-band, the SOLE determiner): this tool checked only what the host uid can observe — that a key file is owned by another uid + the edge signer mechanism signs. It does NOT and CANNOT prove the signing PROCESS runs as that uid. Confirm out-of-band (`id`, `ls -l <key>`, `cat <key>` -> Permission denied) that the edge signer truly runs as the key-owner uid. ONLY that decides custody-real.');
  }
  return {
    hostObservableChecksPassed: verified,
    requiresOutOfBandUidConfirmation: denialLegTaken,
    checks,
    residuals,
  };
}

/** Gather the observed facts from real I/O (impure). */
function gatherEdgeCustodyFacts(opts = {}) {
  const { keyFile, signer, verifyKeyPem, wrapperPath } = opts;
  const ruid = typeof process.getuid === 'function' ? process.getuid() : null;
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  const isRoot = ruid === 0 || euid === 0;
  // POSIX file permissions are evaluated against the EFFECTIVE uid (the open() that drives C2-denied uses euid), so
  // the C2 owner-disambiguation must compare the key owner to euid, not the real uid (CodeRabbit: a setuid/seteuid
  // launch with euid != ruid would misclassify mode-lockdown vs real cross-uid separation). Fall back to ruid when
  // geteuid is unavailable (non-POSIX -> null -> C0 fails closed). assessEdgeCustody's own comment already says euid.
  const runningUid = Number.isInteger(euid) ? euid : ruid;

  // C1 — lstat (path-level metadata, read-permitted on a present-but-unreadable file in a traversable dir).
  let keyStat;
  try {
    const st = fs.lstatSync(keyFile);
    keyStat = { ok: true, isFile: st.isFile(), size: st.size, ownerUid: st.uid };
  } catch (e) { keyStat = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C2 — the open attempt (content-level). O_NOFOLLOW refuses a symlink atomically AT open; O_NONBLOCK so a FIFO key
  // path opens immediately instead of HANGING. A successful open IS the readability signal; close immediately.
  let hostRead;
  try {
    const fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try { fs.closeSync(fd); } catch { /* */ }
    hostRead = { ok: true };
  } catch (e) { hostRead = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C3 — the live EDGE sign probe (D3): present a GENUINE consistent edge ctx with per-run RANDOM 64-hex endpoints
  // (un-special-caseable) + the fixed real edge_type, recompute the probe basis via deriveWorldAnchorEdgeId (so the
  // wrapper's recompute-bind ALLOWs it — a non-consistent basis makes the bind REFUSE -> sig empty -> C3 FAIL, the
  // non-vacuity proof), sign through the cross-uid edge signer (writing the ctx on stdin), and verify the sig over the
  // recomputed basis against the pinned verify key with NO env fallback (D11). (D8) the probe (basis, sig) is NEVER
  // logged — only the booleans flow out.
  let sign = { signed: false, sigVerifies: false };
  try {
    const ctx = {
      from_node_id: crypto.randomBytes(32).toString('hex'),
      to_delta_ref: crypto.randomBytes(32).toString('hex'),
      edge_type: PROBE_EDGE_TYPE,
    };
    // (D3 (b)) assert EXACTLY-64-hex endpoints before signing — a shortened nonce would make C3 vacuous.
    if (isHex64(ctx.from_node_id) && isHex64(ctx.to_delta_ref)) {
      const probeBasis = deriveWorldAnchorEdgeId(ctx);
      const sig = typeof signer === 'function' ? signer(probeBasis, ctx) : null;
      if (sig) {
        sign.signed = true;
        sign.sigVerifies = !!(verifyKeyPem && verifyEdgeSig(probeBasis, sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false }));
      }
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
function verifyEdgeCustody(opts = {}) {
  return assessEdgeCustody(gatherEdgeCustodyFacts(opts));
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
    lines.push('from your uid; `cat <key>` must be Permission denied) AND that the edge signer runs as that uid.');
    lines.push('The --attested-cross-uid flag only records that YOU attested it — it changes the exit code,');
    lines.push('NOT the proof. (Custody-real is a deployment property; no flag and no green check establishes it.)');
  } else if (!report.hostObservableChecksPassed) {
    lines.push('NOT VERIFIED — a host-observable check FAILED; custody is not real here (see the FAIL line(s) above).');
  }
  return lines.join('\n');
}

const VALUE_FLAGS = { '--key': 'keyFile', '--verify-key': 'verifyKeyFile', '--edge-user': 'edgeUser', '--wrapper': 'wrapperPath', '--sudo': 'sudoPath' };

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

function main() {
  const { crossUidLoomEdgeSigner } = require('./loom-edge-launch');
  const usage = 'usage: loom-edge-custody-verify --key <edge-key> --verify-key <pubkey.pem> --edge-user <user> --wrapper <abs-path> [--sudo <abs-path>] [--attested-cross-uid]\n';
  const o = parseArgv(process.argv.slice(2), (m) => { process.stderr.write('loom-edge-custody-verify: ' + m + '\n' + usage); process.exit(2); });
  if (!o.keyFile || !o.verifyKeyFile || !o.edgeUser || !o.wrapperPath) {
    process.stderr.write(usage);
    process.exit(2);
  }
  let verifyKeyPem;
  try { verifyKeyPem = fs.readFileSync(o.verifyKeyFile, 'utf8'); }
  catch (e) { process.stderr.write('loom-edge-custody-verify: cannot read verify-key: ' + (e && e.message) + '\n'); process.exit(2); }

  const signer = crossUidLoomEdgeSigner({ edgeUser: o.edgeUser, wrapperPath: o.wrapperPath, sudoPath: o.sudoPath });
  const report = verifyEdgeCustody({ keyFile: o.keyFile, signer, verifyKeyPem, wrapperPath: o.wrapperPath });
  process.stdout.write(formatReport(report) + '\n');

  // the exit code is NEVER greener than the report. Exit 0 ONLY when the host-observable checks passed AND the
  // operator has explicitly attested the out-of-band uid check.
  const clean = report.hostObservableChecksPassed && (!report.requiresOutOfBandUidConfirmation || o.attested);
  process.exit(clean ? 0 : 1);
}

if (require.main === module) main();

module.exports = { assessEdgeCustody, gatherEdgeCustodyFacts, verifyEdgeCustody, formatReport };
