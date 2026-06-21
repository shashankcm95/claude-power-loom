#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9.x (real-E2E spike) — the pytest test-runner adapter. The W1 ContainerAdapter
// left the per-framework runner to "W2" (its default expects a `loom-run-tests.js`
// wrapper a real repo never has); a real resolved issue needs a runner that drives
// the repo's actual pytest suite. This is that runner for Python/pytest — the
// minimal piece that lets the behavioral leg grade a REAL repo.
//
// CONTRACT: `resolveTestCommand({workDir, test_ids})` returns the
// `{command, argv, wallClockMs, cpuSec, maxPids}` shape the sandbox backend runs;
// the command is `python3 -c <WRAPPER> <nodeid>...`. The WRAPPER runs `pytest.main`
// IN-PROCESS (no nested subprocess — pid-budget-friendly) with a tiny result-collector
// plugin, then prints the SAME `__LOOM_TEST_RESULT__{<nodeid>:'pass'|'fail'}` sentinel
// line `parseTestStatus` already parses (single-source: the prefix is imported, never
// re-typed). An unrequested / un-run test stays `missing` (honest — never a false pass).
//
// HARDENING for the network-denied, write-scoped sandbox: `sys.dont_write_bytecode`
// (the repo dir is read-only under the sandbox — no `__pycache__` writes); `-o addopts=`
// clears the repo's pyproject `addopts` (coverage/xdist plugins that would need deps the
// network-denied sandbox can't install); `-p no:cacheprovider` (no `.pytest_cache` write).

'use strict';

const { execFileSync } = require('child_process');
const { LOOM_TEST_RESULT_PREFIX } = require('./container-adapter');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_CPU_SEC = 60;
const DEFAULT_MAX_PIDS = 512;

// The in-process pytest wrapper. `python3 -c <this> <nodeid>...` => sys.argv[1:] are the
// nodeids. The collector maps each to pass/fail by the `call`-phase outcome (a setup /
// collection FAILURE also marks fail); anything never reported stays absent => `missing`.
const PYTEST_WRAPPER = [
  'import sys',
  'sys.dont_write_bytecode = True',
  'import os, json',
  // The sandbox DENIES writes to every standard temp dir (/tmp, /var/folders, ...) — pytest
  // needs a writable tmp or it dies at startup ("No usable temporary directory"). Point TMPDIR
  // + --basetemp at a writable subdir UNDER .loom-out (the one write-allowed path), before pytest.
  "_tmp = os.path.join(os.getcwd(), '.loom-out', 'pytmp')",
  'try:',
  '    os.makedirs(_tmp, exist_ok=True)',
  "    os.environ['TMPDIR'] = _tmp; os.environ['TMP'] = _tmp; os.environ['TEMP'] = _tmp",
  '    import tempfile; tempfile.tempdir = _tmp',
  'except Exception as _e:',
  "    sys.stderr.write('tmp-setup-error: ' + repr(_e))",
  // ③.2.1a close #4: pin the harness BEFORE `import pytest`. Disable entry-point plugin autoload (closes
  // the pytest11 / committed-*.egg-info vector — a candidate-planted plugin can hijack the report) and
  // clear host-inherited PYTEST_ADDOPTS/PYTEST_PLUGINS (operator-infra defense-in-depth: either can
  // re-add a named plugin even under autoload-disable). Must precede `import pytest` or it no-ops.
  "os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'",
  "os.environ.pop('PYTEST_ADDOPTS', None)",
  "os.environ.pop('PYTEST_PLUGINS', None)",
  'ids = sys.argv[1:]',
  'res = {}',
  'class _Loom:',
  '    def pytest_runtest_logreport(self, report):',
  '        nid = report.nodeid',
  "        if report.when == 'call':",
  "            res[nid] = 'pass' if report.outcome == 'passed' else 'fail'",
  "        elif report.outcome == 'failed' and nid not in res:",
  "            res[nid] = 'fail'",
  'rc = 99',
  'try:',
  '    import pytest',
  // --confcutdir pinned to the ABSOLUTE workDir (os.getcwd()) stops pytest walking UP into parent-dir
  // conftest.py files; an in-tree conftest is covered by the diff-scope close. _Loom stays the explicit
  // collector (plugins=[...]) so autoload-disable does not starve the result channel.
  "    rc = pytest.main(['-p', 'no:cacheprovider', '-q', '--no-header', '-o', 'addopts=', '--confcutdir', os.getcwd(), '--basetemp', _tmp, *ids], plugins=[_Loom()])",
  'except Exception as e:',
  "    sys.stderr.write('pytest-wrapper-error: ' + repr(e))",
  'out = {t: res.get(t, "missing") for t in ids}',
  `sys.stdout.write("\\n${LOOM_TEST_RESULT_PREFIX}" + json.dumps(out) + "\\n")`,
  'sys.stdout.flush()',
  '',
].join('\n');

// Resolve a real python3 (full path — a bare `python3` may not resolve on the sandbox's
// PATH). Impure; the spike/runner calls it once and threads the result into buildPytestCommand.
function resolvePython(bin) {
  if (bin) return bin;
  try { return execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim() || 'python3'; }
  catch { return 'python3'; }
}

// PURE: build the `{command, argv, limits}` the backend's runTests consumes. test_ids are
// pytest nodeids (e.g. `tests/test_more.py::Cls::test_x`); non-string/empty ids are dropped.
function buildPytestCommand({ test_ids, pythonBin = 'python3', wallClockMs = DEFAULT_TIMEOUT_MS, cpuSec = DEFAULT_CPU_SEC, maxPids = DEFAULT_MAX_PIDS } = {}) {
  const ids = (Array.isArray(test_ids) ? test_ids : []).filter((t) => typeof t === 'string' && t.length > 0);
  return { command: pythonBin, argv: ['-c', PYTEST_WRAPPER, ...ids], wallClockMs, cpuSec, maxPids };
}

// A `resolveTestCommand` closure to inject into createSandboxExecBackend({resolveTestCommand}).
function makePytestResolver({ pythonBin } = {}) {
  const py = resolvePython(pythonBin);
  return function resolveTestCommand({ test_ids }) { return buildPytestCommand({ test_ids, pythonBin: py }); };
}

module.exports = { buildPytestCommand, makePytestResolver, resolvePython, PYTEST_WRAPPER };
