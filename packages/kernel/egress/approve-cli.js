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
//     The anchor may be owned by the OPERATOR uid OR root (uid 0) — the cross-uid deploy pins /etc/loom/verify.pem
//     root-owned so neither actor nor operator can swap it (root is the STRONGER anchor); pass that exact file.

'use strict';

const fs = require('fs');
const tty = require('tty');
const crypto = require('crypto');
const { scrubEmitDiff } = require('./scrub');
const { computeEmissionHash, emissionAxiom } = require('./approval');
const { assertCustodyApprovalsDir, recordApproval } = require('./approval-store');
const { assertDataIsPolicyFree, assertSafeRepoRef, assertSafeIssueRef, assertEgressSafeDiff } = require('./emit-pr');
const { computeLessonCommitment } = require('../_lib/lesson-commitment');   // OQ-3 — the single-source lesson commitment
const { crossUidLoomBrokerSigner } = require('./loom-broker-launch');

const CONFIRM_TOKEN_LEN = 8;        // sign-what-you-see handshake length (NOT a secret — see the security model)
const MAX_DRAFT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CONFIRM_LINE = 256;
// OQ-3 (RFC §5.3, fold F5) — per-field caps on the optional lesson the draft carries (a bounded taxonomy axis +
// distinguishing prose). The lesson RIDES the approval (its commitment binds into the broker-signed basis); it is
// NEVER emitted in the PR. Caps are per-field so an oversize body cannot DoS the render / the basis.
const MAX_LESSON_SIGNATURE = 256;
const MAX_LESSON_BODY = 8192;

// OQ-3 (CodeRabbit Major — sign-what-you-see) — the lesson fields are rendered VERBATIM on /dev/tty (reviewText)
// AND hashed into the broker-signed commitment, so a control char (\r, ANSI ESC, backspace, or a \n that injects a
// fake "hash:" line) could change what the operator SEES without changing the committed bytes — breaking the
// sign-what-you-see boundary. Reject ALL control chars (< 0x20, incl. \n/\t since reviewText renders each field on
// ONE line) + DEL (0x7f), via charCodeAt — NO control-regex (ADR-0006 / eslint no-control-regex; mirrors emit-pr's
// isEgressDeniedPath control-char check).
function hasControlChar(s) {
  return Array.prototype.some.call(s, (c) => { const cc = c.charCodeAt(0); return cc < 0x20 || cc === 0x7f; });
}

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
  // OQ-3 (fold F5) — the OPTIONAL lesson the approval rides. When EITHER field is present BOTH must be present,
  // non-empty strings, within the per-field caps (a lone field would compute no commitment; the human must see the
  // full pair). Placed AFTER the emission-axiom validators (readability). A no-lesson draft (neither field) is fine.
  const hasSig = data.lesson_signature !== undefined;
  const hasBody = data.lesson_body !== undefined;
  if (hasSig || hasBody) {
    if (typeof data.lesson_signature !== 'string' || data.lesson_signature.length === 0 || data.lesson_signature.length > MAX_LESSON_SIGNATURE) {
      throw new Error(`approve-cli: lesson_signature must be a non-empty string <= ${MAX_LESSON_SIGNATURE} chars`);
    }
    if (typeof data.lesson_body !== 'string' || data.lesson_body.length === 0 || data.lesson_body.length > MAX_LESSON_BODY) {
      throw new Error(`approve-cli: lesson_body must be a non-empty string <= ${MAX_LESSON_BODY} chars`);
    }
    // sign-what-you-see: a control char would let the rendered /dev/tty view diverge from the committed bytes.
    if (hasControlChar(data.lesson_signature) || hasControlChar(data.lesson_body)) {
      throw new Error('approve-cli: lesson_signature / lesson_body must not contain control characters (sign-what-you-see)');
    }
  }
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

/**
 * The review the human reads (the scrubbed diff + the full hash) + the confirm instruction. OQ-3 (OQ3-3): when a
 * lesson rides the approval, render its signature + body too (the human signs-what-they-see — they can reject a
 * hazardous lesson). The lesson is NOT emitted in the PR; it rides the broker-signed approval as a commitment.
 * @param {object} scrubbed { repo, issueRef, diff }
 * @param {string} hash
 * @param {{lesson_signature?: string, lesson_body?: string}} [lesson]
 */
function reviewText(scrubbed, hash, lesson) {
  const ax = emissionAxiom(scrubbed);           // the EXACT hashed preimage (repo/issueRef normalized, diff verbatim)
  const lines = [
    '=== Power Loom :: review this emission before approving (SHADOW — gates nothing live yet) ===',
    'repo:      ' + ax.repo,
    'issueRef:  ' + ax.issueRef,
    'hash:      ' + hash,
    '--- scrubbed diff (EXACTLY what would be emitted) ---',
    ax.diff,
    '--- end diff ---',
  ];
  const l = lesson || {};
  if (typeof l.lesson_signature === 'string' && l.lesson_signature.length > 0 && typeof l.lesson_body === 'string' && l.lesson_body.length > 0) {
    lines.push('--- lesson (rides this approval; NOT emitted in the PR) ---');
    lines.push('signature: ' + l.lesson_signature);
    lines.push('body:      ' + l.lesson_body);
    lines.push('--- end lesson ---');
  }
  lines.push('To APPROVE, type the first ' + CONFIRM_TOKEN_LEN + ' hex chars of the hash above (anything else aborts):');
  return lines.join('\n');
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

const VERIFY_KEY_ROOT_UID = 0;

/**
 * Owner policy for the verify-key trust anchor: this WIDENS the accepted-owner set from {operator} to {operator,
 * root(uid 0)}. The cross-uid deploy installs /etc/loom/verify.pem root-owned (0644) in a ROOT-OWNED dir
 * (scripts/loom-broker-deploy-macos.sh; runbook step 2) so no non-root principal can swap it — IN THAT DEPLOY root
 * is the stronger anchor, not weaker. The strength is a property of the root-locked DIR, which this owner-check
 * cannot itself verify; the check only admits root as a second acceptable owner. The blast radius is bounded: this
 * is the OPTIONAL mint-time early-catch — emit-pr's resolveVerifyKey re-verifies the broker sig authoritatively at
 * EMIT time (and with NO owner check at all), so a wrong owner here cannot ship an unapproved emission. selfUid===null
 * (no getuid, e.g. Windows) -> ownership unenforceable, accept (parity with the prior skip). True == owner acceptable.
 */
function verifyKeyOwnerOk(stUid, selfUid) {
  if (typeof selfUid !== 'number') return true;     // ownership unenforceable (no getuid) -> skip, as before
  return stUid === selfUid || stUid === VERIFY_KEY_ROOT_UID;
}

/** Read the verify-key (public trust anchor) fail-closed: O_NOFOLLOW + fstat-the-fd + owner=operator-or-root + not w-able. */
function readVerifyKeySafe(keyPath, selfUid) {
  if (typeof keyPath !== 'string' || keyPath.length === 0) return null; // optional — recordApproval handles absent
  let fd;
  try { fd = fs.openSync(keyPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { throw new Error('approve-cli: verify-key unreadable (' + (e && e.code) + ') — must not be a symlink'); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('approve-cli: verify-key must be a regular file');
    if (!verifyKeyOwnerOk(st.uid, selfUid)) throw new Error('approve-cli: verify-key must be owned by the operator uid or root (not actor-writable)');
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

  // 2. ONE frozen scrubbed object -> render + hash + recordApproval all see the identical bytes. The lesson (if any)
  //    rides separately: freezeScrubbed stays {repo, issueRef, diff} (the EMITTED set); the commitment binds the
  //    lesson into the broker-signed approval basis but is NEVER part of the emission.
  const scrubbed = freezeScrubbed(data);
  const hash = computeEmissionHash(scrubbed);
  // OQ-3 (RFC §5.3) — derive the commitment from the SAME lesson body that will be RENDERED (sign-what-you-see).
  // validateDraft has already proven both-or-neither + the caps, so the helper's strict throw is unreachable for a
  // valid pair; '' (the no-lesson sentinel) when neither field is present.
  const lesson = (typeof data.lesson_signature === 'string' && typeof data.lesson_body === 'string')
    ? { lesson_signature: data.lesson_signature, lesson_body: data.lesson_body } : null;
  const lesson_commitment = lesson ? computeLessonCommitment(lesson) : '';

  // 3. fail-fast UX dir check (the ATOMIC guard is recordApproval's own re-assert + wx).
  assertCustodyApprovalsDir(opts.approvalsDir, selfUid);

  // 4. the operator custody verify-key (optional; read fail-closed).
  const verifyKeyPem = readVerifyKeySafe(opts.verifyKeyPath, selfUid);

  // 5. render sign-what-you-see (incl. the lesson, OQ3-3) + read the confirm from /dev/tty (fail-closed on no-tty).
  const confirm = readConfirm(reviewText(scrubbed, hash, lesson || {}));
  if (!confirm.ok) return { ok: false, reason: confirm.reason }; // no-tty / not-a-tty -> no mint
  if (!checkConfirmation(confirm.line, hash)) return { ok: false, reason: 'not-confirmed' };

  // 6. mint: a fresh nonce + the cross-uid broker signFn. The commitment binds into the EXTENDED broker-signed basis.
  const signFn = makeSigner({ brokerUser: opts.brokerUser, wrapperPath: opts.wrapperPath, sudoPath: opts.sudoPath });
  recordApproval(opts.approvalsDir, scrubbed, {
    now: now(), nonce: randomNonce(), signFn, keyId: opts.keyId || 'v0', verifyKeyPem, selfUid, lesson_commitment,
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

module.exports = { validateDraft, freezeScrubbed, confirmTokenFor, checkConfirmation, reviewText, verifyKeyOwnerOk, readVerifyKeySafe, runApprove };
