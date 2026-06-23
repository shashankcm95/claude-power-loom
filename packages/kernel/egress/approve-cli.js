#!/usr/bin/env node
// Power Loom egress — approve-cli.js  (③.2.5b.2)
//
// The human SIGN-WHAT-YOU-SEE gate: a CLI the OPERATOR (a uid DISTINCT from the actor, on the broker's caller-auth
// allowlist) runs to review the EXACT emission a draft would produce and, on confirmation, mint a SIGNED approval
// (via the ③.2.5b cross-uid broker signFn) into the custody approvals dir. emitPR later finds + verifies it keyed
// to computeEmissionHash(draft). SHADOW — armedEmit still throws, so a minted approval gates nothing live until 5c.
//
// SECURITY MODEL (honest — VERIFY board CRITICAL reframe):
//   * The LOAD-BEARING boundary is the CROSS-UID deployment, NOT /dev/tty. The CLI runs as the OPERATOR uid; an
//     actor that spawns the CLI runs it as the ACTOR uid -> the broker's caller-auth DENIES it -> no mint. So the
//     actor cannot drive a mint even by PTY-wrapping a CLI it spawns.
//   * /dev/tty + isatty is DEFENSE-IN-DEPTH (defeats a NAIVE same-uid pipe), not the boundary: a uid-co-resident
//     actor can allocate a controlling PTY. The confirm token is a SIGN-WHAT-YOU-SEE HANDSHAKE (hash prefix), not a
//     secret (the actor can derive it) — its job is forcing the confirmer to have READ the rendered content-address.
//   * validateDraft REUSES emitPR's OWN egress validators on the RAW draft (the CLI is the FIRST gate on the
//     human-facing path) so the human only ever reviews+mints a draft emitPR would accept AND normalize identically.
//   * Same-uid is VACUOUS (consistent with 5b). Single-operator payload authority + operator authenticity are
//     uncloseable ceilings carried by the deployment + operator trust, not the CLI.
//   * `--verify-key` is OPTIONAL: when given, recordApproval verifies the broker sig over the basis at the MINT
//     boundary (catch a value-swap signFn early); when omitted, that mint-time check is SKIPPED and sig-verification
//     defers to emitPR's read gate (the mint still produces a signed approval). Recommended for a real deployment.

'use strict';

const fs = require('fs');
const tty = require('tty');
const crypto = require('crypto');
const { scrubEmitDiff } = require('./scrub');
const { computeEmissionHash, emissionAxiom } = require('./approval');
const { assertCustodyApprovalsDir, recordApproval } = require('./approval-store');
const { assertDataIsPolicyFree, assertSafeRepoRef, assertSafeIssueRef, assertEgressSafeDiff } = require('./emit-pr');
const { crossUidLoomBrokerSigner } = require('./loom-broker-launch');

const CONFIRM_TOKEN_LEN = 8;        // sign-what-you-see handshake length (NOT a secret — see the security model)
const MAX_DRAFT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CONFIRM_LINE = 256;

// =============================== PURE helpers (no I/O) ===============================

/**
 * Validate the RAW actor-written draft by REUSING emitPR's OWN egress validators, in emitPR's order. Throws on any
 * miss (the human is never shown a draft emitPR would reject). Returns the draft unchanged.
 * @param {{repo:*, issueRef:*, diff:*}} data
 */
function validateDraft(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('approve-cli: draft must be a JSON object');
  assertDataIsPolicyFree(data);
  assertSafeRepoRef(data.repo);                 // default host allowlist — the same default emitPR uses
  assertSafeIssueRef(data.issueRef);
  assertEgressSafeDiff(data.diff);              // the RAW diff (rejects .github/.git*/CI, traversal, oversize)
  return data;
}

/** ONE frozen scrubbed-draft object — the SAME object flows into render + hash + recordApproval (no re-scrub). */
function freezeScrubbed(data) {
  return Object.freeze({ repo: data.repo, issueRef: data.issueRef, diff: scrubEmitDiff(data.diff) });
}

const HASH64 = /^[0-9a-f]{64}$/;

/** The sign-what-you-see handshake token = the hash prefix (public; binds the confirm to THIS content-address).
 *  Fail-closed on a non-64-hex hash (VALIDATE hacker LOW — `confirmTokenFor(null)` must not degenerate to 'null'). */
function confirmTokenFor(hash) {
  if (typeof hash !== 'string' || !HASH64.test(hash)) throw new Error('confirmTokenFor: hash must be a 64-hex content-address');
  return hash.slice(0, CONFIRM_TOKEN_LEN);
}

/** Exact-match the typed token (no trim — a trailing space is a different string). Returns false (never throws) on
 *  a degenerate hash so a bad hash can never confirm (e.g. `checkConfirmation('null', null)` -> false). */
function checkConfirmation(typed, hash) {
  if (typeof typed !== 'string' || typeof hash !== 'string' || !HASH64.test(hash)) return false;
  return typed === hash.slice(0, CONFIRM_TOKEN_LEN);
}

/** The review the human reads (the scrubbed diff + the full hash) + the confirm instruction. */
function reviewText(scrubbed, hash) {
  const ax = emissionAxiom(scrubbed);           // the EXACT hashed preimage (repo/issueRef normalized, diff verbatim)
  return [
    '=== Power Loom :: review this emission before approving (SHADOW — gates nothing live yet) ===',
    'repo:      ' + ax.repo,
    'issueRef:  ' + ax.issueRef,
    'hash:      ' + hash,
    '--- scrubbed diff (EXACTLY what would be emitted) ---',
    ax.diff,
    '--- end diff ---',
    'To APPROVE, type the first ' + CONFIRM_TOKEN_LEN + ' hex chars of the hash above (anything else aborts):',
  ].join('\n');
}

// =============================== impure I/O ===============================

/** Read one bounded line from an open fd (the tty). */
function readLineSync(fd) {
  const buf = Buffer.alloc(1);
  let out = '';
  for (;;) {
    let n;
    try { n = fs.readSync(fd, buf, 0, 1, null); } catch { break; }
    if (n === 0) break;
    const c = buf.toString('utf8');
    if (c === '\n') break;
    if (c === '\r') continue;
    out += c;
    if (out.length >= MAX_CONFIRM_LINE) break;
  }
  return out;
}

/**
 * Render to /dev/tty and read the confirm from /dev/tty (NEVER fd 0 — the actor can pipe stdin). Asserts isatty on
 * the opened fd. Fail-closed (no mint) on no-tty (ENXIO headless) / not-a-tty.
 * @returns {{ok:true, line:string}|{ok:false, reason:string}}
 */
function readTtyConfirm(renderText) {
  let fd;
  try { fd = fs.openSync('/dev/tty', 'r+'); }
  catch { return { ok: false, reason: 'no-tty' }; }      // ENXIO under piped/headless -> fail-closed
  try {
    if (!tty.isatty(fd)) return { ok: false, reason: 'not-a-tty' };
    fs.writeSync(fd, renderText + '\n');
    return { ok: true, line: readLineSync(fd) };
  } finally { try { fs.closeSync(fd); } catch { /* */ } }
}

/** Read the operator custody verify-key (public) fail-closed: O_NOFOLLOW + fstat-the-fd + uid-owned + not w-able. */
function readVerifyKeySafe(keyPath, selfUid) {
  if (typeof keyPath !== 'string' || keyPath.length === 0) return null; // optional — recordApproval handles absent
  let fd;
  try { fd = fs.openSync(keyPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { throw new Error('approve-cli: verify-key unreadable (' + (e && e.code) + ') — must not be a symlink'); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('approve-cli: verify-key must be a regular file');
    if (typeof selfUid === 'number' && st.uid !== selfUid) throw new Error('approve-cli: verify-key must be owned by the operator uid (not actor-writable)');
    if (st.mode & 0o022) throw new Error('approve-cli: verify-key must not be group/world-writable');
    return fs.readFileSync(fd, 'utf8');
  } finally { try { fs.closeSync(fd); } catch { /* */ } }
}

function readDraftFile(draftPath) {
  // statSync (not lstatSync) / path read: the draft PATH is operator-provided via --argv, so a symlink is
  // permissible here, and the CONTENT-level gate (validateDraft -> emitPR's validators) is the trust boundary, not
  // the path. Contrast readVerifyKeySafe, which uses O_NOFOLLOW because the verify-key IS a trust anchor (VALIDATE
  // reviewer LOW — the asymmetry is intentional).
  const st = fs.statSync(draftPath);
  if (!st.isFile()) throw new Error('approve-cli: --draft must be a regular file');
  if (st.size > MAX_DRAFT_FILE_BYTES) throw new Error('approve-cli: --draft file too large');
  return JSON.parse(fs.readFileSync(draftPath, 'utf8'));
}

function currentUid() { return typeof process.getuid === 'function' ? process.getuid() : null; }

// =============================== the orchestrated flow (deps-injectable for tests) ===============================

/**
 * @param {{draftPath, approvalsDir, brokerUser, wrapperPath, sudoPath, verifyKeyPath, keyId}} opts
 * @param {{readConfirm?, makeSigner?, now?, randomNonce?, selfUid?}} deps  (tests inject; defaults are the real I/O)
 * @returns {{ok:boolean, reason?:string, hash?:string}}
 */
function runApprove(opts = {}, deps = {}) {
  const readConfirm = deps.readConfirm || readTtyConfirm;
  const makeSigner = deps.makeSigner || ((o) => crossUidLoomBrokerSigner(o));
  const now = deps.now || Date.now;
  const randomNonce = deps.randomNonce || (() => crypto.randomBytes(16).toString('hex'));
  const selfUid = deps.selfUid !== undefined ? deps.selfUid : currentUid();

  // 1. read + validate the RAW draft (reusing emitPR's gates) BEFORE any render/prompt.
  const data = readDraftFile(opts.draftPath);
  validateDraft(data);

  // 2. ONE frozen scrubbed object -> render + hash + recordApproval all see the identical bytes.
  const scrubbed = freezeScrubbed(data);
  const hash = computeEmissionHash(scrubbed);

  // 3. fail-fast UX dir check (the ATOMIC guard is recordApproval's own re-assert + wx).
  assertCustodyApprovalsDir(opts.approvalsDir, selfUid);

  // 4. the operator custody verify-key (optional; read fail-closed).
  const verifyKeyPem = readVerifyKeySafe(opts.verifyKeyPath, selfUid);

  // 5. render sign-what-you-see + read the confirm from /dev/tty (fail-closed on no-tty).
  const confirm = readConfirm(reviewText(scrubbed, hash));
  if (!confirm.ok) return { ok: false, reason: confirm.reason }; // no-tty / not-a-tty -> no mint
  if (!checkConfirmation(confirm.line, hash)) return { ok: false, reason: 'not-confirmed' };

  // 6. mint: a fresh nonce + the cross-uid broker signFn.
  const signFn = makeSigner({ brokerUser: opts.brokerUser, wrapperPath: opts.wrapperPath, sudoPath: opts.sudoPath });
  recordApproval(opts.approvalsDir, scrubbed, {
    now: now(), nonce: randomNonce(), signFn, keyId: opts.keyId || 'v0', verifyKeyPem, selfUid,
  });
  return { ok: true, hash };
}

// =============================== CLI ===============================

const VALUE_FLAGS = {
  '--draft': 'draftPath', '--approvals-dir': 'approvalsDir', '--broker-user': 'brokerUser',
  '--wrapper': 'wrapperPath', '--sudo': 'sudoPath', '--verify-key': 'verifyKeyPath', '--key-id': 'keyId',
};
// NOTE: no --ttl-ms — the TTL is a READ-side concern (readVerifiedApproval/verifyApproval); recordApproval has no
// mint-time TTL knob, so a --ttl-ms flag would be inert (VALIDATE: all 3 lenses flagged the dead flag). Omitting it
// means an operator who passes --ttl-ms gets a loud `unknown argument` rather than a silently-ignored lifetime.

function parseArgv(argv, die) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const field = VALUE_FLAGS[argv[i]];
    if (!field) { die('unknown argument: ' + argv[i]); return o; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('-')) { die(argv[i] + ' requires a value'); return o; }
    o[field] = val; i++;
  }
  return o;
}

function main() {
  const usage = 'usage: approve-cli --draft <draft.json> --approvals-dir <dir> --broker-user <user> --wrapper <abs-path> [--verify-key <pem>] [--key-id <id>] [--sudo <abs-path>]\n';
  const o = parseArgv(process.argv.slice(2), (m) => { process.stderr.write('approve-cli: ' + m + '\n' + usage); process.exit(2); });
  if (!o.draftPath || !o.approvalsDir || !o.brokerUser || !o.wrapperPath) { process.stderr.write(usage); process.exit(2); }
  let res;
  try { res = runApprove(o); }
  catch (e) { process.stderr.write('approve-cli: ' + (e && e.message) + '\n'); process.exit(1); }
  if (res.ok) { process.stdout.write('approved: ' + res.hash + '\n'); process.exit(0); }
  process.stderr.write('approve-cli: NOT approved (' + res.reason + ') — no approval minted\n');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { validateDraft, freezeScrubbed, confirmTokenFor, checkConfirmation, reviewText, readVerifyKeySafe, runApprove };
