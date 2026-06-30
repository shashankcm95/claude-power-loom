#!/usr/bin/env node
'use strict';

// Power Loom egress — loom-actor-custody-verify.js  (③.2.5 uid-611)
//
// The OUT-OF-BAND custody verifier for the ACTOR uid (loom-actor@611) — the symmetric twin of loom-custody-verify.js
// (the broker's). The operator runs this AS THE HOST UID on the deployed box to check every custody condition the
// host uid can OBSERVE, and to surface the one it CANNOT (that the running actor PROCESS is genuinely the other uid).
// It NEVER asserts custody-real (NS-9): it reports `hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`.
//
// MIRROR (bounded, intentional — a separate trust domain; does NOT edit the shipped broker verifier):
//   C0 not-root · C1 API-key present + non-vacuous · C2 host-read DENIED + owner-differs disambiguation ·
//   C2.5 wrapper integrity (root-owned, not group/world-writable, not host-owned).
// NEW vs the broker:
//   C3 EXEC-liveness — a live `claude --version` AS 611 via the cross-uid wrapper (proves the cross-uid exec path +
//       the binary is reachable WITHOUT the host reading anything; the API-key USE is proven by the operator's real
//       dogfood, NOT here — honest necessary-not-sufficient, like the broker's sign-liveness).
//   C4 EXEC-TARGET root-lock — the wrapper's claude + node + their ancestor chains are root-owned + not
//       group/world-writable (hacker VERIFY H2: a 501-writable claude/node that runs AS 611 is privesc; the macOS
//       home-dir wrinkle forces a staged claude/node, so this gate is load-bearing here where the broker did not
//       need it — its wrapper only execs a staged sign.js).
//   C5 JUDGE tool-lessness (#430 PR-2) — runs the --loom-judge-version-probe arm AS 611 + asserts the init tools[] is
//       EMPTY. Doubles as the judge-aware-wrapper confirmation (an OLD actor-only wrapper fails closed at the case
//       *) -> exit 2): it is the EMPIRICAL gate the operator confirms BEFORE setting LOOM_JUDGE_REQUIRE_UID_SEP
//       (the deploy-ordering Forward-Contract). Unlike C3's free `--version`, C5 is a real (cheap, 'hi') `claude -p`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { crossUidActorVersionProbeArgs, crossUidJudgeProbeArgs } = require('./loom-actor-launch');

const DENIAL_ERRNOS = new Set(['EACCES', 'EPERM']);
const PROBE_TIMEOUT_MS = 8000;
const JUDGE_PROBE_TIMEOUT_MS = 90000;   // #430 PR-2 — the judge probe is a REAL (cheap, 'hi') `claude -p`, unlike C3's free `--version`

// #430 PR-2 — the init-tools[] fail-closed ladder. A kernel-local TWIN of the lab claude-headless.js
// verifyToollessRuntime inline ladder (the LAYER rule forbids the kernel custody-verifier importing a lab module);
// the two MUST stay in sync (cross-ref). PURE: parses the FIRST system/init event's tools[] and fail-closes on EVERY
// path that is not a successfully-parsed EMPTY array (no-init / not-array / leaked). Unit-tested via the export.
function assessInitTools(stdout) {
  let initTools = null;
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    // first parseable init is authoritative — the real `claude -p` emits EXACTLY ONE system/init, so a forged second
    // init cannot relax the gate (and a leaked-first/empty-second sequence still fails closed).
    if (e && e.type === 'system' && e.subtype === 'init') { initTools = Array.isArray(e.tools) ? e.tools : 'NOT_ARRAY'; break; }
  }
  if (initTools === null) return { ok: false, reason: 'no-init-event' };
  if (initTools === 'NOT_ARRAY') return { ok: false, reason: 'tools-not-array' };
  if (initTools.length > 0) return { ok: false, reason: 'tools-leaked', tools: initTools };
  return { ok: true, tools: [] };
}

/**
 * PURE verdict over observed facts. No I/O.
 * @param {{
 *   isRoot:boolean, runningUid:number|null,
 *   keyStat:{ok:true,isFile:boolean,size:number,ownerUid:number}|{ok:false,errno:string},
 *   hostRead:{ok:true}|{ok:false,errno:string},
 *   liveProbe:{ran:boolean,exitZero:boolean},
 *   judgeProbe:null|{ran:boolean,exitZero:boolean,toolsResult:{ok:boolean,tools?:string[],reason?:string}},
 *   wrapper:null|{ok:true,isFile:boolean,worldOrGroupWritable:boolean,ownerUid:number}|{ok:false,errno:string},
 *   execTargets:null|Array<{label:string,ok:boolean,isFile?:boolean,ownerUid?:number,worldOrGroupWritable?:boolean,ancestorsRootLocked?:boolean,errno?:string}>
 * }} facts
 * @returns {{hostObservableChecksPassed:boolean, requiresOutOfBandUidConfirmation:boolean, checks:object[], residuals:string[]}}
 */
function assessActorCustody(facts = {}) {
  const checks = [];
  const residuals = [];
  let verified = true;
  let denialLegTaken = false;
  const fail = (id, detail) => { checks.push({ id, status: 'FAIL', detail }); verified = false; };
  const pass = (id, detail) => checks.push({ id, status: 'PASS', detail });
  const note = (id, detail) => checks.push({ id, status: 'NOTE', detail });

  // C0 — root / uid-model guard (POSIX perms use the EFFECTIVE uid). A null runningUid fails CLOSED.
  if (facts.isRoot) fail('C0-root', 'running as root (real or effective uid 0) — root bypasses file permissions; uid separation is unobservable from here');
  else if (facts.runningUid === null || facts.runningUid === undefined || !Number.isInteger(facts.runningUid)) fail('C0-root', 'uid model unavailable / invalid on this platform (getuid undefined or a non-integer like NaN) — cross-uid custody cannot be verified here');
  else pass('C0-root', 'not running as root (uid ' + facts.runningUid + ')');

  // C1 — API-key custody present + non-vacuous (lstat, NEVER a read — survives the real cross-uid case).
  const ks = facts.keyStat || {};
  if (ks.ok) {
    if (!ks.isFile) fail('C1-keypresent', 'API-key custody path is not a regular file (symlink/FIFO/dir) — no key to protect');
    else if (!(ks.size > 0)) fail('C1-keypresent', 'API-key file is empty — vacuous: no key to protect');
    else pass('C1-keypresent', 'API-key custody present + non-empty (' + ks.size + ' bytes)');
  } else if (ks.errno && DENIAL_ERRNOS.has(ks.errno)) {
    note('C1-keypresent', 'cannot stat the API-key (the key directory is locked down — ' + ks.errno + '); non-vacuity rests on the C3 exec-liveness');
  } else {
    fail('C1-keypresent', 'cannot stat the API-key path (' + (ks.errno || 'unknown') + ') — key absent / path broken');
  }

  // C2 — the custody (denial) leg. Branch ONLY on the open errno; disambiguate MODE-vs-uid via the key OWNER.
  const hr = facts.hostRead || {};
  if (hr.ok) {
    fail('C2-denied', 'the host uid CAN read the API-key file — custody is NOT real (same-uid / over-permissive)');
  } else if (hr.errno && DENIAL_ERRNOS.has(hr.errno)) {
    if (ks.ok && typeof ks.ownerUid === 'number' && typeof facts.runningUid === 'number') {
      if (ks.ownerUid === facts.runningUid) {
        fail('C2-denied', 'host read denied (' + hr.errno + ') BUT the API-key is owned by the running uid (' + ks.ownerUid + ') — EACCES is from file MODE, not uid separation. NOT cross-uid custody.');
      } else {
        denialLegTaken = true;
        pass('C2-denied', 'host read denied (' + hr.errno + ') + API-key owned by a DIFFERENT uid (' + ks.ownerUid + ' != ' + facts.runningUid + ') — NECESSARY only; it is still UNPROVEN that the running actor PROCESS is uid ' + ks.ownerUid + ' (attest out-of-band)');
      }
    } else {
      fail('C2-denied', 'host read denied (' + hr.errno + ') but the API-key OWNER is unreadable (key directory not traversable to the host) — cannot distinguish a cross-uid key from the host\'s own locked-dir key. Relax the key DIR to 0755 (the key stays 0600) or rely on the out-of-band attestation.');
    }
  } else {
    fail('C2-denied', 'host read failed with ' + (hr.errno || 'unknown') + ' (not EACCES/EPERM) — the key path is a symlink/FIFO/dir/absent; cannot establish the custody leg');
  }

  // C3 — exec-liveness: a live `claude --version` AS the actor uid through the cross-uid wrapper. Two diagnostics.
  const lp = facts.liveProbe || {};
  if (!lp.ran) fail('C3-liveness', 'the cross-uid version probe did NOT run — sudo/wiring/exec failure (check sudoers `operator ALL=(loom-actor) NOPASSWD: <wrapper>`, the wrapper perms, -n, and that the wrapper handles the version-probe sentinel)');
  else if (!lp.exitZero) fail('C3-liveness', 'the cross-uid wrapper ran but `claude --version` exited non-zero — the staged claude/node is not runnable as the actor uid (check the staging + the exec chain)');
  else pass('C3-liveness', 'the cross-uid wrapper ran `claude --version` as the actor uid and exited 0 — the cross-uid exec path + a reachable claude binary exist behind the actor uid (API-key USE is proven by the operator dogfood, not here)');

  // C2.5 — wrapper integrity (root-owned, not group/world-writable, not host-owned). Same as the broker's.
  if (facts.wrapper) {
    const w = facts.wrapper;
    if (!w.ok) fail('C2.5-wrapper', 'sudo wrapper was supplied but is not statable (' + (w.errno || 'unknown') + ') — the wrapper path is wrong/absent/broken; wrapper integrity cannot be established (FAIL, not advisory: --wrapper WAS supplied)');
    else if (!w.isFile) fail('C2.5-wrapper', 'the sudo wrapper is not a regular file (symlink/dir) — hijackable');
    else if (w.worldOrGroupWritable) fail('C2.5-wrapper', 'the sudo wrapper is group/world-writable — the host can run code as the actor uid (privesc)');
    else if (typeof w.ownerUid === 'number' && typeof facts.runningUid === 'number' && w.ownerUid === facts.runningUid) fail('C2.5-wrapper', 'the sudo wrapper is OWNED by the host uid (' + w.ownerUid + ') — its owner can chmod/edit it and have sudo run attacker code as the actor uid (privesc). Own it root:wheel.');
    else pass('C2.5-wrapper', 'sudo wrapper is a regular, non-group/world-writable file not owned by the host uid');
  } else {
    note('C2.5-wrapper', 'wrapper integrity NOT checked — pass --wrapper to enable');
  }

  // C4 — exec-target root-lock (NEW). Every target (claude + node) + its ancestor chain must be root-owned + not
  // group/world-writable, else the host swaps what runs AS the actor uid (privesc). Fail-closed on any unstatable
  // / non-file / non-root / writable / unlocked-ancestor target.
  const ets = facts.execTargets;
  if (Array.isArray(ets) && ets.length) {
    const bad = [];
    for (const t of ets) {
      const label = (t && t.label) || '?';
      if (!t || !t.ok) { bad.push(label + ' (unstatable: ' + ((t && t.errno) || 'unknown') + ')'); continue; }
      if (!t.isFile) { bad.push(label + ' (not a regular file)'); continue; }
      if (t.ownerUid !== 0) { bad.push(label + ' (owned by uid ' + t.ownerUid + ', not root)'); continue; }
      if (t.worldOrGroupWritable) { bad.push(label + ' (group/world-writable)'); continue; }
      if (!t.ancestorsRootLocked) { bad.push(label + ' (a non-root-locked ancestor dir)'); continue; }
    }
    if (bad.length) fail('C4-exectargets', 'the wrapper\'s exec target(s) are NOT root-locked — a 501-writable target/ancestor lets the host run code as the actor uid (privesc): ' + bad.join('; '));
    else pass('C4-exectargets', 'the wrapper\'s exec targets (' + ets.map((t) => t.label).join(', ') + ') + their ancestor chains are root-owned + not group/world-writable');
  } else {
    note('C4-exectargets', 'exec-target root-lock NOT checked — pass --claude-bin + --node-bin to enable');
  }

  // C5 — judge tool-lessness + judge-aware-wrapper confirmation (#430 PR-2). Runs the --loom-judge-version-probe arm
  // (the SAME tool-less judge recipe + stream-json the --loom-judge real branch uses) AS the actor uid and asserts the
  // init tools[] is EMPTY. Two things at once: (1) the judge recipe is genuinely tool-less (a prompt-injected judge
  // has no host-action blast radius via the enumerated toolset); (2) the wrapper RECOGNIZES the judge sentinels — an
  // OLD actor-only wrapper has no --loom-judge-version-probe arm so it fail-closes (*) -> exit 2), which is the
  // EMPIRICAL gate the operator confirms BEFORE setting LOOM_JUDGE_REQUIRE_UID_SEP (the deploy-ordering Forward-
  // Contract). HONEST SCOPE: C5 proves the PROBE branch is tool-less; the --loom-judge PLAIN-output branch's
  // parseability is proven by the operator's judge dogfood (a named residual), and tool-lessness is over the
  // ENUMERATED toolset (a future always-on built-in would leak until added — claude-headless.js residual). Fail-
  // closed on every non-empty-array path (mirrors verifyToollessRuntime). Skips C5 only if the judge probe was not
  // gathered (same condition as C3 — actor-user + wrapper present).
  const jp = facts.judgeProbe;
  if (jp) {
    // VERIFY-the-array, don't TRUST the ok flag (#273): C5 PASSes ONLY when tools is independently a parsed-EMPTY
    // array — assessInitTools guarantees ok:true ⟺ tools:[], but assessActorCustody is a PURE fn over arbitrary facts,
    // so a forged/inconsistent { ok:true, tools:['LSP'] } must still FAIL (CodeRabbit major: ok-alone is too permissive).
    const tr = jp.toolsResult;
    const verifiedEmpty = !!(tr && tr.ok === true && Array.isArray(tr.tools) && tr.tools.length === 0);
    if (!jp.ran) fail('C5-judgeless', 'the cross-uid JUDGE probe did NOT run — sudo/wiring/exec failure, OR an OLD wrapper with no --loom-judge-version-probe arm (NOT judge-aware). Re-deploy the judge-aware wrapper before setting LOOM_JUDGE_REQUIRE_UID_SEP.');
    else if (!jp.exitZero) fail('C5-judgeless', 'the cross-uid judge probe ran but exited non-zero — the wrapper does not recognize --loom-judge-version-probe (an OLD actor-only wrapper fails closed at *) -> exit 2), or the tool-less judge recipe failed. NOT judge-aware.');
    else if (!verifiedEmpty) fail('C5-judgeless', 'the judge probe ran but its init tools[] is not a verified-EMPTY array (' + ((tr && tr.reason) || (!tr ? 'no-tools-result' : !Array.isArray(tr.tools) ? 'tools-not-array' : tr.tools.length > 0 ? 'tools-leaked' : 'ok-flag-not-set')) + (tr && Array.isArray(tr.tools) && tr.tools.length > 0 ? ': ' + JSON.stringify(tr.tools) : '') + ') — the judge recipe is NOT tool-less (a prompt-injected judge could take a host action via the leaked tool)');
    else pass('C5-judgeless', 'the cross-uid --loom-judge recipe runs TOOL-LESS as the actor uid (init tools: []) — the wrapper is confirmed judge-aware + tool-less (the PLAIN-output --loom-judge branch is proven by the operator dogfood; tool-lessness is over the enumerated toolset)');
  } else {
    // reachable ONLY from a programmatic caller that omits judgeProbe — gatherActorCustodyFacts ALWAYS produces a
    // non-null judgeProbe (a probe-build throw / spawn error leaves ran:false => C5 FAIL, not this NOTE), exactly as
    // C3's liveProbe is always gathered. The CLI requires --actor-user + --wrapper, so C5 is always evaluated there.
    note('C5-judgeless', 'judge tool-lessness NOT checked (no judgeProbe in the supplied facts — a programmatic-caller path; the CLI always gathers it alongside C3)');
  }

  // The bind-gap is UNCONDITIONAL on the passed path (integrity != provenance): the tool checks only what the host
  // uid can observe; the binding (that the actor PROCESS runs as that uid) is the operator's out-of-band call.
  if (denialLegTaken) {
    residuals.push('binding (out-of-band, the SOLE determiner): this tool checked only what the host uid can observe — that an API-key file is owned by another uid + the cross-uid wrapper runs claude. It does NOT and CANNOT prove the actor PROCESS runs as that uid. Confirm out-of-band (`id`, `ls -l <key>`, `cat <key>` -> Permission denied) that the actor truly runs as the key-owner uid. ONLY that decides custody-real.');
  }
  return {
    hostObservableChecksPassed: verified,
    requiresOutOfBandUidConfirmation: denialLegTaken,
    checks,
    residuals,
  };
}

// ---------------------------------- impure: gather the observed facts ----------------------------------

// Walk a path's ancestor chain: each ancestor must be root-owned + not group/world-writable. Returns the target's
// own stat fields + ancestorsRootLocked. Mirrors the deploy helper's assert_root_locked walk (runtime form).
function gatherExecTarget(label, p) {
  if (typeof p !== 'string' || !p.length) return { label, ok: false, errno: 'NOPATH' };
  if (!path.isAbsolute(p)) return { label, ok: false, errno: 'NOTABS' };   // a bare/relative bin is an operator error; surface it clearly (not a confusing "unstatable")
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return { label, ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }
  let ancestorsRootLocked = true;
  let dir = path.dirname(path.resolve(p));
  for (let guard = 0; guard < 128; guard += 1) {
    let dst;
    try { dst = fs.lstatSync(dir); } catch { ancestorsRootLocked = false; break; }
    if (dst.uid !== 0 || (dst.mode & 0o022)) { ancestorsRootLocked = false; break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;       // reached '/'
    dir = parent;
  }
  return { label, ok: true, isFile: st.isFile(), ownerUid: st.uid, worldOrGroupWritable: !!(st.mode & 0o022), ancestorsRootLocked };
}

/** Gather the observed facts from real I/O (impure). */
function gatherActorCustodyFacts(opts = {}) {
  const { keyFile, actorUser, wrapperPath, sudoPath, claudeBin, nodeBin } = opts;
  const ruid = typeof process.getuid === 'function' ? process.getuid() : null;
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  const isRoot = ruid === 0 || euid === 0;
  // POSIX file permissions are evaluated against the EFFECTIVE uid (the open() that drives C2-denied uses euid), so
  // the C2 owner-disambiguation must compare the key owner to euid, not the real uid (CodeRabbit: a setuid/seteuid
  // launch with euid != ruid would misclassify mode-lockdown vs real cross-uid separation). Fall back to ruid when
  // geteuid is unavailable (non-POSIX -> null -> C0 fails closed). assessActorCustody's own comment already says euid.
  const runningUid = Number.isInteger(euid) ? euid : ruid;

  // C1 — lstat (path-level metadata, read-permitted on a present-but-unreadable file in a traversable dir).
  let keyStat;
  try {
    const st = fs.lstatSync(keyFile);
    keyStat = { ok: true, isFile: st.isFile(), size: st.size, ownerUid: st.uid };
  } catch (e) { keyStat = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C2 — the open attempt. O_NOFOLLOW refuses a symlink atomically; O_NONBLOCK so a FIFO opens instead of hanging.
  let hostRead;
  try {
    const fd = fs.openSync(keyFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try { fs.closeSync(fd); } catch { /* */ }
    hostRead = { ok: true };
  } catch (e) { hostRead = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }

  // C3 — the live exec probe: run `claude --version` AS the actor uid through the cross-uid wrapper (the
  // version-probe sentinel). A spawn error => ran:false; a non-zero exit (e.g. sudo -n denied) => exitZero:false.
  let liveProbe = { ran: false, exitZero: false };
  try {
    const { command, args } = crossUidActorVersionProbeArgs({ actorUser, wrapperPath, sudoPath });
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
    liveProbe = { ran: !r.error, exitZero: r.status === 0 };
  } catch { /* fail-closed — ran stays false */ }

  // C5 — the judge tool-less exec probe (#430 PR-2): run the --loom-judge-version-probe arm AS the actor uid (a REAL
  // but cheap `claude -p` over a fixed 'hi') + parse the init tools[]. ran:false on spawn error / an old wrapper that
  // throws in the arg-build; exitZero:false on a non-zero exit (old wrapper *) -> exit 2, sudo -n denied, recipe fail).
  let judgeProbe = { ran: false, exitZero: false, toolsResult: { ok: false, reason: 'not-run' } };
  try {
    const { command, args } = crossUidJudgeProbeArgs({ actorUser, wrapperPath, sudoPath });
    const r = spawnSync(command, args, { input: 'hi', encoding: 'utf8', timeout: JUDGE_PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const ran = !r.error;
    const exitZero = r.status === 0;
    judgeProbe = { ran, exitZero, toolsResult: (ran && exitZero) ? assessInitTools(r.stdout) : { ok: false, reason: ran ? 'nonzero-exit' : 'spawn-error' } };
  } catch { /* fail-closed — ran stays false */ }

  // C2.5 — wrapper integrity (optional). lstat (not follow) + the group/world-writable bit-logic.
  let wrapper = null;
  if (typeof wrapperPath === 'string' && wrapperPath.length) {
    try {
      const st = fs.lstatSync(wrapperPath);
      wrapper = { ok: true, isFile: st.isFile(), worldOrGroupWritable: !!(st.mode & 0o022), ownerUid: st.uid };
    } catch (e) { wrapper = { ok: false, errno: (e && e.code) || 'EUNKNOWN' }; }
  }

  // C4 — exec-target root-lock (optional). The claude + node the wrapper execs as the actor uid.
  let execTargets = null;
  if ((typeof claudeBin === 'string' && claudeBin.length) || (typeof nodeBin === 'string' && nodeBin.length)) {
    execTargets = [];
    if (typeof claudeBin === 'string' && claudeBin.length) execTargets.push(gatherExecTarget('claude', claudeBin));
    if (typeof nodeBin === 'string' && nodeBin.length) execTargets.push(gatherExecTarget('node', nodeBin));
  }

  return { isRoot, runningUid, keyStat, hostRead, liveProbe, judgeProbe, wrapper, execTargets };
}

/** gather -> assess. */
function verifyActorCustody(opts = {}) {
  return assessActorCustody(gatherActorCustodyFacts(opts));
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
    lines.push('observe uid separation; only YOUR out-of-band check decides custody is real. Confirm the API-key');
    lines.push('is owned by a genuinely DIFFERENT uid (`id`, `ls -l <key>` — owner differs; `cat <key>` -> Permission');
    lines.push('denied) AND that the actor runs as that uid. --attested-cross-uid records that YOU attested it; it');
    lines.push('changes the exit code, NOT the proof.');
  } else if (!report.hostObservableChecksPassed) {
    lines.push('NOT VERIFIED — a host-observable check FAILED; custody is not real here (see the FAIL line(s) above).');
  }
  return lines.join('\n');
}

const VALUE_FLAGS = {
  '--key': 'keyFile', '--actor-user': 'actorUser', '--wrapper': 'wrapperPath',
  '--sudo': 'sudoPath', '--claude-bin': 'claudeBin', '--node-bin': 'nodeBin',
};

function parseArgv(argv, onError) {
  const die = typeof onError === 'function' ? onError : (m) => { throw new Error(m); };
  const o = { attested: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--attested-cross-uid') { o.attested = true; continue; }
    const field = VALUE_FLAGS[a];
    if (!field) { die('unknown argument: ' + a); return o; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('-')) { die(a + ' requires a value'); return o; }
    o[field] = val; i++;
  }
  return o;
}

function main() {
  const usage = 'usage: loom-actor-custody-verify --key <api-key-file> --actor-user <user> --wrapper <abs-path> --claude-bin <abs> --node-bin <abs> [--sudo <abs>] [--attested-cross-uid]\n';
  const o = parseArgv(process.argv.slice(2), (m) => { process.stderr.write('loom-actor-custody-verify: ' + m + '\n' + usage); process.exit(2); });
  // --claude-bin + --node-bin are REQUIRED: C4 (exec-target root-lock) is the load-bearing macOS privesc gate, so
  // the CLI must NEVER exit green with it un-evaluated (VALIDATE-hacker MEDIUM — a default-skipped guard is theater).
  if (!o.keyFile || !o.actorUser || !o.wrapperPath || !o.claudeBin || !o.nodeBin) {
    process.stderr.write(usage);
    process.exit(2);
  }
  const report = verifyActorCustody(o);
  process.stdout.write(formatReport(report) + '\n');
  const clean = report.hostObservableChecksPassed && (!report.requiresOutOfBandUidConfirmation || o.attested);
  process.exit(clean ? 0 : 1);
}

if (require.main === module) main();

module.exports = { assessActorCustody, gatherActorCustodyFacts, verifyActorCustody, gatherExecTarget, assessInitTools, formatReport };
