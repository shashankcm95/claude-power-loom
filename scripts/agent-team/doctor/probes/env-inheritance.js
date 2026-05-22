'use strict';

// doctor/probes/env-inheritance.js — v2.9.0 Phase C.1 (FIX-I4)
//
// Surfaces the env-leak failure mode caught by bench/control-runs/v2.8.5-control
// + v2.8.5-treatment: a Bash sub-process inherits a shell where `[ -n $X ]`
// returned truthy but `${#X}` was 0. Result: Phase 3-4 spawn silently
// degraded to stubs because the gate that should have aborted didn't.
//
// MVP scope: spawn a Bash sub-shell from Node + check whether expected
// env-var conventions hold. Coverage: 'partial' since cross-process env
// probing is platform-specific (architect HIGH-3 documented this limit).
//
// Test mode: when AGENT_TEAM_DOCTOR_TEST=1 we use a synthetic check that
// always passes (so unit tests don't depend on the user's actual env).

const { spawnSync } = require('child_process');
// v2.9.0 Phase C.2 (FIX-I7) — placeholder detection lives in canonical
// _lib helper. Single source of truth; tested separately under
// tests/unit/scripts/env-placeholder.test.js.
const { isPlaceholderEnvValue } = require('../../_lib/env-placeholder');

function run(args) {
  // Test-mode short circuit. Surfaces a synthetic pass with coverage:partial
  // so the unit-test suite doesn't depend on the runner's actual environment.
  if (process.env.AGENT_TEAM_DOCTOR_TEST === '1') {
    return {
      status: 'pass',
      details: {
        mode: 'test-fixture',
        coverage: 'partial',
        notes: 'Test-mode synthetic check — set AGENT_TEAM_DOCTOR_TEST=0 to exercise live env probe.',
      },
    };
  }

  // Live mode: spawn a Bash sub-shell that mirrors the v2.8.5-control bug.
  // For every env var listed in --vars=<csv> (or a default set), report:
  //   - Whether `[ -n $VAR ]` returns truthy in Bash sub-shell
  //   - Whether `${#VAR}` is non-zero
  //   - Whether the value looks like a placeholder (`<your-key>` etc.)
  //
  // A var is "leaked" if it passes the truthy guard but has zero length
  // OR is a placeholder — both are silent-degradation surfaces.
  const requested = (args && args.vars) ? String(args.vars).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const checks = [];
  let anyFail = false;
  let anyWarn = false;

  // If no --vars specified, run a structural meta-check: confirm Bash
  // sub-shell from Node works at all. The substantive value comes from
  // operators passing --vars explicitly in CI / Phase-0 invocations.
  if (requested.length === 0) {
    const meta = spawnSync('bash', ['-c', 'echo OK'], { encoding: 'utf8' });
    if (meta.status === 0 && (meta.stdout || '').trim() === 'OK') {
      return {
        status: 'pass',
        details: {
          mode: 'meta-only',
          coverage: 'partial',
          notes: 'No --vars supplied; ran meta-check only. Pass `--vars FOO,BAR` to validate inheritance for specific env vars.',
        },
      };
    }
    return {
      status: 'fail',
      details: { mode: 'meta-only', error: 'Bash sub-shell did not return OK', stderr: meta.stderr },
    };
  }

  for (const v of requested) {
    // Spawn a Bash sub-shell exactly like the v2.8.5-control bug context.
    const r = spawnSync('bash', ['-c', `if [ -n "$${v}" ]; then echo "truthy:${ '${#'+v+'}' }"; else echo "falsy"; fi`], {
      encoding: 'utf8',
      env: process.env,
    });
    const out = (r.stdout || '').trim();
    const value = process.env[v];
    const isPlaceholder = isPlaceholderEnvValue(value);
    const truthy = out.startsWith('truthy:');
    const lengthClaim = truthy ? out.split(':')[1] : null;
    // Bug pattern: truthy guard reports truthy + length 0 → silent leak.
    const silentLeak = truthy && lengthClaim === '0';
    let status = 'pass';
    if (silentLeak || isPlaceholder) {
      status = 'fail';
      anyFail = true;
    } else if (!value || value.length === 0) {
      status = 'warn';  // Not set at all — degraded but explicit.
      anyWarn = true;
    }
    checks.push({ var: v, status, truthy_bash_guard: truthy, length: lengthClaim, isPlaceholder, valueSample: value ? value.slice(0, 3) + '...' : null });
  }

  const overall = anyFail ? 'fail' : (anyWarn ? 'warn' : 'pass');
  return {
    status: overall,
    details: { mode: 'live', checks, coverage: 'partial', notes: 'MVP scope: Bash sub-shell only. Other paths (Node spawn, container init) not yet probed.' },
  };
}

module.exports = { name: 'env-inheritance', run };
