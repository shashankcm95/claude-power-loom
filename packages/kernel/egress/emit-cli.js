#!/usr/bin/env node

// @loom-layer: kernel
//
// emit-cli — the OPERATOR armed-emit runner. Reads the approved draft.json + custody paths and calls
// emitPR to open a real GitHub PR. The missing sibling of approve-cli (which MINTS the approval); the
// only other emitPR caller (live-loop-run) is EMIT-OFF by design, so before this there was no turnkey
// way to run the armed emit. The operator runs approve-cli FIRST (mint), then this (emit), pointing
// BOTH at the SAME draft.json so the approvalHash matches.
//
// TRUST MODEL (load-bearing): `data` is UNTRUSTED and carries ONLY {repo, issueRef, diff} picked from
// the draft; ALL custody (killswitch/disposition/token/verify-key/approvals-dir/gh-config-dir) comes
// ONLY from argv (the #273 data/opts separation). emitPR builds + scrubs the draft itself and gates
// fail-closed; this CLI never emits a byte on its own. Success is ONLY a positively-confirmed
// emitted===true; every other/unknown return exits non-zero (fail-closed default).
//
// Claude NEVER runs this: the arming (killswitch ARM file, custody token, /etc/loom verify-key, the
// broker) is OPERATOR-only (task_d722450d). This module is normal substrate tooling.

'use strict';

const { emitPR } = require('./emit-pr');
// Reuse approve-cli's draft read + size cap VERBATIM (DRY on a shared security artifact — a divergence
// would mint an approval this side refuses). readDraftFile is statSync + isFile + 8 MiB cap: the draft
// PATH is operator-provided so a symlink is permissible; the CONTENT gate (emitPR's validators) is the
// trust boundary, NOT the path (contrast the verify-key, which emitPR resolves as a trust anchor).
const { readDraftFile } = require('./approve-cli');

// argv flag -> internal field. The 7 REQUIRED custody flags plus 3 optional ones. No --fork-owner
// (S4: same-owner emit is dormant-by-omission), no --host-allowlist / --cap-state / --join-key-dir
// (surplus for the same-owner path; --host-allowlist also has a string/array trap).
const VALUE_FLAGS = {
  '--draft': 'draftPath',
  '--approvals-dir': 'approvalsDir',
  '--killswitch': 'killswitchPath',
  '--disposition': 'dispositionPath',
  '--token': 'tokenPath',
  '--verify-key': 'verifyKeyPath',
  '--gh-config-dir': 'ghConfigDir',
  '--etiquette-ledger': 'etiquetteLedgerPath',   // OPTIONAL flag; the runbook REQUIRES it for a live emit
  '--lock': 'lockPath',
  '--ttl-ms': 'ttlMs',
};

const REQUIRED_FIELDS = ['draftPath', 'approvalsDir', 'killswitchPath', 'dispositionPath', 'tokenPath', 'verifyKeyPath', 'ghConfigDir'];

const USAGE = [
  'usage: emit-cli --draft <draft.json> --approvals-dir <dir> --killswitch <path> --disposition <path>',
  '                --token <path> --verify-key <pem> --gh-config-dir <empty-dir>',
  '                [--etiquette-ledger <path>] [--lock <path>] [--ttl-ms <n>]',
  '',
  '  Runs the ARMED emitPR on the SAME draft.json approve-cli signed. Emits a real DRAFT PR only when',
  '  disposition=live AND a token AND killswitch-off AND a VALID signed approval. Fail-closed otherwise.',
  '  Exit: 0 = PR emitted; 1 = a fail-closed refusal (awaiting-approval / not-armed / error); 2 = usage.',
].join('\n');

// Parse argv into {ok, flags} | {ok:false, error}. Mirrors approve-cli's guard: reject an unknown flag
// and a value that startsWith('-') (a flag-injection where the value is missing).
function parseArgv(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const field = VALUE_FLAGS[argv[i]];
    if (!field) return { ok: false, error: `unknown argument: ${argv[i]}` };
    // A repeated custody flag is ambiguous — fail closed rather than silently last-win (VALIDATE-hacker L1).
    if (Object.prototype.hasOwnProperty.call(flags, field)) return { ok: false, error: `${argv[i]} given more than once` };
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('-')) return { ok: false, error: `${argv[i]} requires a value` };
    flags[field] = val;
    i += 1;
  }
  return { ok: true, flags };
}

// The #273 exact-key pick: `data` is EXACTLY {repo, issueRef, diff} from the draft — never a spread, so
// a policy/custody/extra key in the draft can never ride into data (emitPR re-rejects policy keys too).
// diff is passed VERBATIM (emitPR scrubs internally; a pre-scrub would break the approvalHash match).
// lesson_commitment is DEFERRED (YAGNI — no lesson-bearing emit yet): emitPR defaults it to '' via
// assertSafeLessonCommitment, and a lesson-bearing draft fails CLOSED at lesson-commitment-mismatch
// (safe). When needed, derive it from the DRAFT's own lesson_signature/lesson_body (parity with
// approve-cli's computeLessonCommitment), NEVER an argv flag (a second source would diverge from the
// signed basis).
function buildData(draftObj) {
  if (!draftObj || typeof draftObj !== 'object' || Array.isArray(draftObj)) {
    throw new Error('emit-cli: draft must be a JSON object');
  }
  return { repo: draftObj.repo, issueRef: draftObj.issueRef, diff: draftObj.diff };
}

// Custody opts come ONLY from flags. No custodyForkOwnerPath (S4). ttlMs is Number-coerced (validated
// numeric in run() before this is reached).
function buildOpts(flags) {
  const opts = {
    custodyApprovalsDir: flags.approvalsDir,
    killswitchPath: flags.killswitchPath,
    custodyDispositionPath: flags.dispositionPath,
    custodyTokenPath: flags.tokenPath,
    custodyVerifyKeyPath: flags.verifyKeyPath,
    ghConfigDir: flags.ghConfigDir,
  };
  if (flags.etiquetteLedgerPath) opts.custodyEtiquetteLedgerPath = flags.etiquetteLedgerPath;
  if (flags.lockPath) opts.lockPath = flags.lockPath;
  if (flags.ttlMs !== undefined) opts.ttlMs = Number(flags.ttlMs);
  return opts;
}

// FAIL-CLOSED control structure (VERIFY-hacker H3): the ONLY exit-0 path is a positively-confirmed
// emitted===true; every other/unknown shape exits 1. Success -> stdout; refusal -> stderr.
function formatResult(res) {
  // A thenable return means emitPR was made async out from under this synchronous CLI — fail LOUD
  // (an explicit diagnostic), never a silent universal refusal (VALIDATE-hacker M2).
  if (res && typeof res.then === 'function') {
    return { exitCode: 1, stderr: 'emit-cli: emit returned a Promise (unsupported — emitPR must stay synchronous)\n' };
  }
  if (res && res.ok === true && res.emitted === true) {
    const pr = res.pr;
    // exit 0 REQUIRES a real pr_url string — never claim "opened" without the artifact identity
    // (VALIDATE-hacker M1 + code-reviewer LOW). A success with no url is a malformed result, fail-closed.
    if (!pr || typeof pr.pr_url !== 'string' || !pr.pr_url) {
      return { exitCode: 1, stderr: 'emit-cli: emit reported success but returned no PR url (malformed result)\n' };
    }
    if (pr.deduped) return { exitCode: 0, stdout: `emit-cli: already emitted (deduped, prior PR): ${pr.pr_url}\n` };
    return { exitCode: 0, stdout: `emit-cli: opened PR: ${pr.pr_url}\n` };
  }
  const reason = (res && (res.approvalReason || res.reason)) || 'not-armed';
  const disp = res && res.disposition ? ` disposition=${JSON.stringify(res.disposition)}` : '';
  const hash = res && res.approvalHash ? ` approvalHash=${res.approvalHash}` : '';   // top-level, F1
  return { exitCode: 1, stderr: `emit-cli: not emitted (${reason})${disp}${hash}\n` };
}

// run() sets NO process side effects (no process.exit) — it RETURNS {exitCode, stdout?, stderr?} so it
// is unit-testable. main() does the stream writes + exit. deps.{emitFn, readDraftFile} inject for tests.
function run(argv, deps = {}) {
  const emitFn = deps.emitFn || emitPR;
  const readDraft = deps.readDraftFile || readDraftFile;
  const parsed = parseArgv(argv);
  if (!parsed.ok) return { exitCode: 2, stderr: `emit-cli: ${parsed.error}\n${USAGE}\n` };
  const missing = REQUIRED_FIELDS.filter((f) => !parsed.flags[f]);
  if (missing.length) return { exitCode: 2, stderr: `emit-cli: missing required flag(s): ${missing.join(', ')}\n${USAGE}\n` };
  if (parsed.flags.ttlMs !== undefined) {
    const n = Number(parsed.flags.ttlMs);
    if (!Number.isInteger(n) || n <= 0) {   // reject 0 / negative / fractional / NaN / Infinity (VALIDATE-hacker L2)
      return { exitCode: 2, stderr: `emit-cli: --ttl-ms must be a positive integer (got ${parsed.flags.ttlMs})\n` };
    }
  }
  try {
    const data = buildData(readDraft(parsed.flags.draftPath));
    const res = emitFn(data, buildOpts(parsed.flags));
    return formatResult(res);
  } catch (e) {
    // fail-closed: any read/parse/validator throw -> a clean reason, never a raw stack trace. A JSON.parse
    // failure is mapped to a STABLE reason (VALIDATE-hacker L3) so an operator script matches a fixed string,
    // not V8's parser wording; emitPR validator messages (Error, not SyntaxError) surface verbatim (informative).
    const msg = e instanceof SyntaxError ? 'draft is not valid JSON' : ((e && e.message) || 'emit-error');
    return { exitCode: 1, stderr: `emit-cli: ${msg}\n` };
  }
}

function main(argv) {
  const r = run(argv);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;   // never process.exit(): let the event loop drain cleanly
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { run, parseArgv, buildData, buildOpts, formatResult, USAGE };
