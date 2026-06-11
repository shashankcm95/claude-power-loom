#!/usr/bin/env node

'use strict';

// examples/delta-promote-demo.js
//
// v3.7 W3 — the documented END-TO-END delta-promote workflow (operator-dogfood).
// Runs the REAL staging machinery against a hermetic demo repo it creates under
// the system temp dir, and narrates every step:
//
//   1. three simulated harness worktree-spawns produce filesystem deltas
//      (one doc edit = the SEED; one new file = merges CLEAN; one conflicting
//      edit of the same line the seed touched = CONFLICTS);
//   2. each delta is staged via the REAL producer (stageCandidate) — a genesis
//      provenance record is minted into the record-store and the delta is pinned
//      under a hidden refs/loom/candidates/<id> ref (worktrees are then REMOVED,
//      proving the pin outlives the harness cleanup);
//   3. the REAL human surface (integrate-cli.js) folds the candidates in declared
//      order onto the disposable loom/integration branch, with minting ON:
//      the CLEAN candidate is absorbed (a chained integration record), the
//      CONFLICTING one is quarantined to loom-promote/<id> (a reject-event —
//      the v3.7 W1 ledger);
//   4. HEAD / the working tree are asserted BYTE-UNTOUCHED by all of the above;
//   5. the HUMAN step: review loom/integration (log + diff) and deliberately
//      merge it into the demo repo's main; the quarantined branch stays parked
//      for manual review.
//
// Everything is hermetic: NOTHING outside the temp dir is written. SHADOW posture
// is preserved — the machinery only ever RECORDS + stages; the only promotion is
// the explicit human merge at step 5, inside the demo repo.
//
// Usage:
//   node examples/delta-promote-demo.js            narrated run (stdout)
//   node examples/delta-promote-demo.js --json     narration -> stderr; a JSON
//                                                  summary -> stdout (CI mode)
//   node examples/delta-promote-demo.js --keep     keep the temp dir (prints path)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const { stageCandidate } = require(path.join(REPO_ROOT, 'packages/kernel/spawn-state/stage-candidate.js'));
const { listByRun } = require(path.join(REPO_ROOT, 'packages/kernel/_lib/record-store.js'));
const { listRejectEvents } = require(path.join(REPO_ROOT, 'packages/kernel/_lib/reject-event-store.js'));
const INTEGRATE_CLI = path.join(REPO_ROOT, 'packages/kernel/spawn-state/integrate-cli.js');

const JSON_MODE = process.argv.includes('--json');
const KEEP = process.argv.includes('--keep');
const RUN_ID = 'loom-demo-run';
const PERSONA = 'demo-operator';

// Narration goes to stderr in --json mode so stdout stays a clean JSON document.
function say(line) {
  (JSON_MODE ? process.stderr : process.stdout).write(line + '\n');
}

function git(repo, args, input) {
  return execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
  }).trim();
}

// == step 1 ==  Init the hermetic demo repo: a tiny project, one base commit on main.
function initDemoRepo(repo) {
  say('== 1. the demo repo (hermetic; nothing outside the temp dir is written) ==');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'loom-demo@example.invalid']);
  git(repo, ['config', 'user.name', 'loom-demo']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo project\n\nstatus: draft\n');
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), "'use strict';\nmodule.exports = { name: 'demo' };\n");
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  say(`    ${repo} @ main: README.md + src/app.js`);
}

// Simulate one harness isolation:"worktree" spawn: a detached worktree off main
// in which the "agent" edits files. Returns the worktree path.
function spawnWorktree(repo, name, edit) {
  const wt = path.join(path.dirname(repo), `wt-${name}`);
  git(repo, ['worktree', 'add', '--detach', '-q', wt, 'main']);
  edit(wt);
  return wt;
}

// == step 2 ==  Three spawns produce deltas: the seed, a clean add, a conflicter.
function runWorktreeSpawns(repo) {
  say('');
  say('== 2. three simulated worktree-spawns produce deltas ==');
  const worktrees = {
    'demo-seed': spawnWorktree(repo, 'seed', (wt) => {
      fs.writeFileSync(path.join(wt, 'README.md'), '# demo project\n\nstatus: reviewed by the seed spawn\n');
    }),
    'demo-logger': spawnWorktree(repo, 'logger', (wt) => {
      fs.writeFileSync(path.join(wt, 'src', 'logger.js'), "'use strict';\nmodule.exports = { log: (m) => process.stderr.write(m + '\\n') };\n");
    }),
    'demo-conflict': spawnWorktree(repo, 'conflict', (wt) => {
      fs.writeFileSync(path.join(wt, 'README.md'), '# demo project\n\nstatus: REWRITTEN by the conflicting spawn\n');
    }),
  };
  say('    demo-seed     edits README.md (the seed: adopted whole as candidate-0)');
  say('    demo-logger   adds src/logger.js (disjoint -> merges CLEAN)');
  say('    demo-conflict edits the SAME README.md line the seed edited (-> CONFLICTS)');
  return worktrees;
}

// Stage one spawn's delta through the REAL producer. Throws on a non-staged
// result (the demo asserts the happy path; fail-soft reasons surface here).
function stage(wt, agentId, stateDir) {
  const result = stageCandidate({
    harnessWorktreePath: wt,
    agentId,
    toolResponse: { status: 'completed' },
    runId: RUN_ID,
    stateDir,
    personaId: PERSONA,
    schemaVersion: 'v3',
  });
  if (!result.staged) {
    throw new Error(`stageCandidate(${agentId}) did not stage: ${result.reason}`);
  }
  say(`    staged ${agentId}: ref=${result.ref}`);
  say(`      genesis transaction_id=${result.transaction_id.slice(0, 16)}... post_state_hash=${result.post_state_hash.slice(0, 16)}...`);
}

// == step 3 ==  Stage all three, remove the worktrees, prove the pins survive.
function stageAllCandidates(repo, worktrees, stateDir) {
  say('');
  say('== 3. stage each delta via the REAL producer (stageCandidate) ==');
  for (const [agentId, wt] of Object.entries(worktrees)) stage(wt, agentId, stateDir);
  for (const wt of Object.values(worktrees)) git(repo, ['worktree', 'remove', '--force', wt]);
  const refs = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/loom/candidates/']).split('\n');
  say(`    worktrees REMOVED (harness-cleanup simulation); ${refs.length} hidden candidate refs survive:`);
  refs.forEach((r) => say(`      ${r}`));
  say(`    (git branch sees none of them: [${git(repo, ['branch', '--list', 'loom*']) || 'empty'}])`);
  return refs.length;
}

// == step 4 ==  The human surface: integrate-cli folds the candidates (minting ON).
// A CLI failure (exit!=0) is converted into a named, bounded diagnostic throw.
function foldCandidates(repo, stateDir) {
  say('');
  say('== 4. the HUMAN surface: integrate-cli folds the candidates (minting ON) ==');
  let cliOut;
  try {
    cliOut = execFileSync(process.execPath, [
      INTEGRATE_CLI, 'demo-seed', 'demo-logger', 'demo-conflict',
      '--root', repo, '--run-id', RUN_ID, '--state-dir', stateDir,
    ], { encoding: 'utf8', cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).slice(0, 400) : String(err.stdout || '').slice(0, 400);
    throw new Error(`integrate-cli failed (exit ${err.status}): ${detail}`);
  }
  const report = JSON.parse(cliOut);
  say(`    integrated:  ${JSON.stringify(report.integratedIds)}  (tip ${String(report.tip).slice(0, 12)}...)`);
  say(`    quarantined: ${JSON.stringify(report.quarantinedIds)}  -> refs/heads/loom-promote/demo-conflict`);
  return report;
}

// == step 5 ==  The W1 ledger: the absorb record + the reject-event.
function readLedger(stateDir) {
  say('');
  say('== 5. the W1 ledger: one absorbed -> integration record; one quarantined -> reject-event ==');
  const appendRecords = listByRun({ runId: RUN_ID, stateDir }).filter((r) => r.operation_class === 'APPEND');
  const rejects = listRejectEvents({ runId: RUN_ID, stateDir });
  say(`    chained integration records (absorb side, mechanical/display-only): ${appendRecords.length}`);
  appendRecords.forEach((r) => say(`      APPEND ${r.transaction_id.slice(0, 16)}... writer=${r.writer_spawn_id}`));
  say(`    reject-events (the kernel-DECIDED denial source; v3.8 breaker input): ${rejects.length}`);
  rejects.forEach((e) => say(`      ${e.outcome} ${e.reject_event_id.slice(0, 16)}... candidate=${e.candidate_safe_id}`));
  return { appendRecords, rejects };
}

// == step 7 ==  The human reviews + merges — the deliberate promotion.
function humanReviewAndMerge(repo) {
  say('');
  say('== 7. the HUMAN reviews + merges (the deliberate promotion; the only HEAD write) ==');
  say('    $ git log --oneline main..loom/integration');
  git(repo, ['log', '--oneline', 'main..loom/integration']).split('\n').forEach((l) => say(`      ${l}`));
  say('    $ git diff --stat main...loom/integration');
  git(repo, ['diff', '--stat', 'main...loom/integration']).split('\n').forEach((l) => say(`      ${l}`));
  git(repo, ['merge', '-q', '--no-ff', '-m', 'merge loom/integration (human-reviewed)', 'loom/integration']);
  const mergedFiles = git(repo, ['ls-tree', '--name-only', '-r', 'HEAD']).split('\n').sort();
  say(`    merged. main now has: ${mergedFiles.join(', ')}`);
  say('    the quarantined delta stays PARKED on loom-promote/demo-conflict for manual review:');
  say('      $ git diff main...loom-promote/demo-conflict   (-> the conflicting README rewrite)');
  return mergedFiles.includes('src/logger.js')
    && git(repo, ['show', 'HEAD:README.md']).includes('reviewed by the seed spawn');
}

// The ~40-line sequencer: each narrative step is a named function above, so a
// throw names the step (code-reviewer HIGH fold: main() was over the 50-line cap).
function main() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-demo-'));
  const repo = path.join(baseDir, 'demo-repo');
  const stateDir = path.join(baseDir, 'spawn-state');
  const summary = { demoDir: baseDir };

  try {
    initDemoRepo(repo);
    const worktrees = runWorktreeSpawns(repo);
    summary.stagedCandidates = stageAllCandidates(repo, worktrees, stateDir);

    const headBefore = git(repo, ['rev-parse', 'HEAD']);
    const statusBefore = git(repo, ['status', '--porcelain']);
    const report = foldCandidates(repo, stateDir);
    summary.integratedIds = report.integratedIds;
    summary.quarantinedIds = report.quarantinedIds;

    const { appendRecords, rejects } = readLedger(stateDir);
    summary.integrationRecords = appendRecords.length;
    summary.rejectEvents = rejects.map((e) => ({ outcome: e.outcome, candidate: e.candidate_safe_id }));

    say('');
    say('== 6. NEVER-TOUCH-HEAD: the fold wrote refs, never the checkout ==');
    summary.headUntouchedDuringFold = git(repo, ['rev-parse', 'HEAD']) === headBefore
      && git(repo, ['status', '--porcelain']) === statusBefore;
    if (!summary.headUntouchedDuringFold) throw new Error('HEAD/working tree changed during the fold');
    say(`    HEAD ${headBefore.slice(0, 12)}... and the working tree are byte-unchanged. OK`);

    summary.mergedClean = humanReviewAndMerge(repo);
    summary.quarantineParked = git(repo, ['rev-parse', '--verify', 'refs/heads/loom-promote/demo-conflict']).length > 0;

    say('');
    say('== done: producer -> integrator -> ledger -> human review -> deliberate merge ==');
    summary.ok = summary.headUntouchedDuringFold && summary.mergedClean && summary.quarantineParked
      && summary.integrationRecords === 1 && summary.rejectEvents.length === 1
      && summary.rejectEvents[0].outcome === 'quarantined';
    if (JSON_MODE) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return summary.ok ? 0 : 1;
  } finally {
    if (KEEP) say(`(kept: ${baseDir})`);
    else fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

process.exit(main());
