#!/usr/bin/env node
// packages/specs/bench/router-v2/shadow-eval.js
//
// Router-V2 corpus-aug — the NARROWS-ONLY shadow-eval harness. Runs old-vs-new
// `scoreTask` over the labeled route eval set and gates a W3/W4 lexicon/weight
// change on REGRESSION. Per OQ-NS-6 this NARROWS only — it picks WHICH change ships
// behind the EXISTING advisory gate; it can NEVER harden the scorer into a blocker,
// and it does NOT claim global route-correctness.
//
// A4-purity: imports `scoreTask` from the kernel READ-ONLY; the live scorer imports
// nothing from here (the firewall is the directory boundary).
//
// The core `shadowEval` takes INJECTED old/new scorers so the gate logic is unit-
// tested against a fixture without git; the CLI wires old = a git-pinned ref, new =
// the worktree scorer (the W1 git-pinned-baseline pattern, extended to the lexicon).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { ROUTE_VALUES, isRouteValue, validateEvalRow } = require('./_schema.js');

// Wilson score interval (reused from the lab — offline tooling may depend on lab utils).
// wilson(successes, n) -> { lower, upper } | null (never throws).
const { wilson } = require('../../../lab/causal-edge/wilson.js');
function accInterval(successes, total) {
  if (total <= 0) return null;
  const w = wilson(successes, total) || { lower: 0, upper: 0 };
  return { successes, total, lower: w.lower, upper: w.upper };
}

// Default anchor floors (VERIFY CA-4 / HON-MED-5): below these the gate REPORTS
// insufficiency rather than silently claiming a clean check.
const DEFAULT_FLOORS = Object.freeze({ minTotal: 20, minRootAnchors: 8, minRouteAnchors: 8 });

function bandOf(scorerOut, leg, id) {
  const rec = scorerOut && scorerOut.recommendation;
  if (!isRouteValue(rec)) {
    throw new Error(`shadow-eval: ${leg} scorer returned a non-route recommendation for row ${id}: ${JSON.stringify(rec)}`);
  }
  return rec;
}

// PURE core. opts = { evalRows, scoreOld, scoreNew, floors? }.
// scoreOld/scoreNew: (task_excerpt:string) -> { recommendation, ... } (the scoreTask shape).
// The SAME byte-identical task_excerpt feeds both legs (VERIFY CA-1).
function shadowEval(opts) {
  const { evalRows, scoreOld, scoreNew } = opts;
  const floors = { ...DEFAULT_FLOORS, ...(opts.floors || {}) };
  if (!Array.isArray(evalRows)) throw new Error('shadowEval: evalRows must be an array');
  if (typeof scoreOld !== 'function' || typeof scoreNew !== 'function') {
    throw new Error('shadowEval: scoreOld and scoreNew must be functions');
  }

  const perTask = [];
  const regressions = [];   // old-right -> new-wrong (LOAD-BEARING signal)
  const improvements = [];  // old-wrong -> new-right
  let oldCorrect = 0;
  let newCorrect = 0;
  let nGenuineRoot = 0;
  let nGenuineRoute = 0;
  let nBorderline = 0;
  let liveReproducing = 0;

  for (const row of evalRows) {
    const errs = validateEvalRow(row);
    if (errs.length > 0) {
      // Fail-closed-by-coverage: a malformed eval row is a LOUD fail, never a skip.
      throw new Error(`shadow-eval: malformed eval row ${row && row.id}: ${errs.join('; ')}`);
    }
    const correct = row.correct_route;
    if (correct === 'root') nGenuineRoot += 1;
    else if (correct === 'route') nGenuineRoute += 1;
    else nBorderline += 1;
    if (row.score_reproduces_live === true) liveReproducing += 1;

    // SAME byte-identical excerpt feeds both legs.
    const oldRoute = bandOf(scoreOld(row.task_excerpt), 'old', row.id);
    const newRoute = bandOf(scoreNew(row.task_excerpt), 'new', row.id);
    const oldRight = oldRoute === correct;
    const newRight = newRoute === correct;
    if (oldRight) oldCorrect += 1;
    if (newRight) newCorrect += 1;

    const rec = { id: row.id, correct_route: correct, old_route: oldRoute, new_route: newRoute, band: row.band };
    perTask.push(rec);
    if (oldRight && !newRight) regressions.push(rec);
    else if (!oldRight && newRight) improvements.push(rec);
  }

  // Per-band accuracy-vs-label with Wilson intervals (old + new).
  const byBand = {};
  for (const band of ROUTE_VALUES) {
    const rows = perTask.filter((r) => r.correct_route === band);
    const n = rows.length;
    const oldHits = rows.filter((r) => r.old_route === band).length;
    const newHits = rows.filter((r) => r.new_route === band).length;
    byBand[band] = {
      n,
      old_acc: accInterval(oldHits, n),
      new_acc: accInterval(newHits, n),
    };
  }

  const netTowardLabel = improvements.length - regressions.length;
  const anchors = {
    nGenuineRoot,
    nGenuineRoute,
    nBorderline,
    insufficientN: perTask.length < floors.minTotal,
    insufficientRootAnchors: nGenuineRoot < floors.minRootAnchors,
    insufficientRouteAnchors: nGenuineRoute < floors.minRouteAnchors,
  };
  // Under-powered = too few anchors to certify no-regression (VALIDATE H-3 / HON-MED-2).
  // On today's 200-char-prefix corpus the route axis has 0 anchors, so this is the
  // honest verdict until 1000-char rows accumulate — NOT a silent green.
  const underPowered = anchors.insufficientN || anchors.insufficientRootAnchors || anchors.insufficientRouteAnchors;

  // The GATE (VERIFY CA-2 / HON-MED-4): the per-task away-from-label move is the
  // LOAD-BEARING regression signal; the aggregate net is a SECONDARY tripwire
  // (subsumed by the per-task gate — net<0 implies regressions>0), not a score.
  const failReasons = [];
  if (regressions.length > 0) {
    failReasons.push(`${regressions.length} labeled task(s) moved AWAY from their correct route (per-task regression)`);
  }
  if (netTowardLabel < 0) {
    failReasons.push(`aggregate net-toward-label is negative (${netTowardLabel}) [secondary tripwire, subsumed]`);
  }
  const regression = regressions.length > 0;

  return {
    nRows: perTask.length,
    perTask,
    regressions,
    improvements,
    aggregate: { oldCorrect, newCorrect, netTowardLabel },
    byBand,
    anchors,
    liveReproducing: { n: liveReproducing, fraction: perTask.length ? liveReproducing / perTask.length : 0 },
    floors,
    regression,
    underPowered,
    // Clean certification requires BOTH no per-task regression AND sufficient anchors.
    pass: !regression && !underPowered,
    failReasons,
  };
}

// VERIFY CA-2: narrows-only is an ENFORCED gate, not prose. Fails if a line of the
// report co-locates a trust/correctness/benchmark claim with a pass-rate number
// (the bootcamp-gates.js:auditWording pattern). Returns the offending lines.
// Best-effort drift-guard on the harness's OWN machine report (VALIDATE L-1 +
// HON-MED-1): it does NOT police the README/plan/PR-description/human summaries —
// narrows-only framing THERE is a review responsibility, not a mechanical gate.
// Broadened to catch ratio/accuracy phrasings that dodge a bare '%'.
const TRUST_CLAIM = /\b(trust\s*score|trustworthy|route[- ]correctness|representative benchmark|benchmark shows|proven correct|correctness score|accuracy|hardens? trust|earns? a skip|certif)/i;
const PASSRATE = /(\d+(?:\.\d+)?\s*%|\bpass[- ]?rate\b|\b\d+\s*\/\s*\d+\b|\b\d+\s+(?:of|out of)\s+\d+\b|\b0\.\d{2,}\b)/i;
function auditReportWording(text) {
  const violations = [];
  for (const line of String(text || '').split('\n')) {
    if (TRUST_CLAIM.test(line) && PASSRATE.test(line)) violations.push(line.trim());
  }
  return violations;
}

function fmtAcc(acc) {
  if (!acc) return 'n=0';
  return `${acc.successes}/${acc.total} [${(acc.lower).toFixed(2)}-${(acc.upper).toFixed(2)} Wilson95]`;
}

// Human-readable, deliberately narrows-only report (no trust/pass-rate framing).
function buildReport(result, meta) {
  const L = [];
  L.push('Router-V2 shadow-eval — NARROWS-ONLY regression check (NOT a correctness benchmark).');
  L.push(`old=${(meta && meta.oldRef) || 'injected'} new=${(meta && meta.newRef) || 'injected'} rows=${result.nRows}`);
  L.push('');
  L.push('This proves ONLY: the candidate change does not REGRESS the labeled tasks');
  L.push('(an old-right -> new-wrong move) in this BIASED regression set. It does NOT');
  L.push('measure global route-correctness, and it cannot harden the advisory scorer.');
  L.push('');
  L.push(`Regressions (old-right -> new-wrong, LOAD-BEARING): ${result.regressions.length}`);
  for (const r of result.regressions) L.push(`  - ${r.id}: correct=${r.correct_route} old=${r.old_route} new=${r.new_route}`);
  L.push(`Improvements (old-wrong -> new-right): ${result.improvements.length}`);
  L.push(`Net toward label (secondary tripwire): ${result.aggregate.netTowardLabel}`);
  L.push('');
  L.push('Per-band agreement-with-label (old | new), Wilson 95% interval:');
  for (const band of ROUTE_VALUES) {
    const b = result.byBand[band];
    L.push(`  ${band}: old ${fmtAcc(b.old_acc)} | new ${fmtAcc(b.new_acc)}`);
  }
  L.push('');
  const a = result.anchors;
  L.push(`Anchors: root=${a.nGenuineRoot} route=${a.nGenuineRoute} borderline=${a.nBorderline}`);
  if (a.insufficientN) L.push('  WARNING: INSUFFICIENT-N (below the minimum total floor) — the check is under-powered.');
  if (a.insufficientRootAnchors) L.push('  WARNING: INSUFFICIENT-ROOT-ANCHORS — cannot reliably catch an over-routing regression.');
  if (a.insufficientRouteAnchors) L.push('  WARNING: INSUFFICIENT-ROUTE-ANCHORS — cannot reliably catch an under-routing regression.');
  L.push(`Live-reproducing rows (prefix re-score == stored live score): ${result.liveReproducing.n}/${result.nRows} ` +
    `(${(result.liveReproducing.fraction * 100).toFixed(0)}%) — only these tie to LIVE routing behavior.`);
  L.push('');
  let verdict;
  if (result.regression) verdict = 'REGRESSION — a labeled task moved AWAY from its correct route; do NOT ship this change.';
  else if (result.underPowered) verdict = 'UNDER-POWERED — insufficient anchors to certify no-regression on this corpus (the route axis stays dark until 1000-char rows accumulate).';
  else verdict = 'NO REGRESSION — this change does not regress the labeled tasks; safe to ship behind the EXISTING advisory gate.';
  L.push(`VERDICT: ${verdict}`);
  for (const reason of result.failReasons) L.push(`  detail: ${reason}`);
  return L.join('\n');
}

// --- CLI git-loader: load the scorer at a git ref (the pinned "old" leg) ---
// Writes the ref's route-decide.js + route-lexicon.json to a temp dir PRESERVING
// the kernel relative layout (algorithms/route-decide.js + _lib/route-lexicon.json)
// so the old scorer resolves ITS OWN lexicon via its DEFAULT_LEXICON_PATH — no
// global ROUTE_LEXICON_PATH env (which would also re-point the new scorer, and
// coerces `undefined` to the string 'undefined'). The pinned (code, lexicon) pair
// travels together (VERIFY CA-3). A pre-W1 ref had inline keywords + no lexicon
// file — the git-show fails-soft and the inline scorer needs no lexicon.
// Temp dirs cleaned at process exit (VALIDATE C-2 / L-2 leak fix).
const _tmpDirs = [];
process.on('exit', () => { for (const d of _tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

// Reject a `-`-leading or metachar ref — git interprets `-O<file>` etc. as an
// OPTION, a file-read/write oracle (VALIDATE H-1). The ref is a commit/branch/tag,
// not a path, so this charset (incl. git revsyntax ~^@{}) is permissive enough.
const SAFE_REF = /^[0-9A-Za-z_][0-9A-Za-z._/~^@{}-]*$/;
function loadScorerAtRef(ref, repoRoot) {
  if (typeof ref !== 'string' || !SAFE_REF.test(ref)) {
    throw new Error(`shadow-eval: unsafe --old-ref ${JSON.stringify(ref)} (must match ${SAFE_REF})`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-shadow-old-'));
  _tmpDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, 'algorithms'));
  fs.mkdirSync(path.join(tmp, '_lib'));
  const show = (p) => execFileSync('git', ['-C', repoRoot, 'show', `${ref}:${p}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const scorerPath = path.join(tmp, 'algorithms', 'route-decide.js');
  fs.writeFileSync(scorerPath, show('packages/kernel/algorithms/route-decide.js'));
  try { fs.writeFileSync(path.join(tmp, '_lib', 'route-lexicon.json'), show('packages/kernel/_lib/route-lexicon.json')); }
  catch { /* pre-W1 ref: inline keywords, no lexicon artifact */ }
  delete require.cache[require.resolve(scorerPath)];
  const mod = require(scorerPath);
  return (task) => mod.scoreTask(task);
}

function readEvalSet(p) {
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (t) rows.push(JSON.parse(t));
  }
  return rows;
}

module.exports = { shadowEval, auditReportWording, buildReport, loadScorerAtRef, readEvalSet, DEFAULT_FLOORS };

// --- main ---
if (require.main === module) {
  // VALIDATE H-2: neither leg may be env-steered into a self-comparison — an
  // inherited ROUTE_LEXICON_PATH would make the worktree scorer AND the ref scorer
  // both read the same lexicon, silently false-greening the one regression signal.
  delete process.env.ROUTE_LEXICON_PATH;
  const args = process.argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const evalPath = get('--eval-set', path.join(__dirname, 'route-eval-set.jsonl'));
  const oldRef = get('--old-ref', 'HEAD');
  const repoRoot = get('--repo', path.resolve(__dirname, '../../../..'));

  let result; let report;
  try {
    const evalRows = readEvalSet(evalPath);
    const newScorer = require('../../../kernel/algorithms/route-decide.js');
    const scoreNew = (task) => newScorer.scoreTask(task);
    const scoreOld = loadScorerAtRef(oldRef, repoRoot);
    result = shadowEval({ evalRows, scoreOld, scoreNew });
    report = buildReport(result, { oldRef, newRef: 'worktree' });
  } catch (err) {
    process.stderr.write(`shadow-eval: ${err.message}\n`);
    process.exit(2);
  }

  // Self-check: the report must not co-locate a trust/correctness claim with a pass-rate (narrows-only).
  const wordingViolations = auditReportWording(report);
  if (wordingViolations.length > 0) {
    process.stderr.write(`shadow-eval: narrows-only wording gate FAILED — the report co-located a trust claim with a pass-rate:\n${wordingViolations.map((v) => '  ' + v).join('\n')}\n`);
    process.exit(3);
  }

  process.stdout.write(report + '\n');
  // exit: 0 = certified no-regression; 1 = a per-task regression; 4 = under-powered
  // (insufficient anchors to certify — distinct from a regression; both are non-zero).
  if (result.regression) process.exit(1);
  if (result.underPowered) process.exit(4);
  process.exit(0);
}
