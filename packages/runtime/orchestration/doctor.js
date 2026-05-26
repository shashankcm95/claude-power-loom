#!/usr/bin/env node

// doctor.js — v2.9.0 Phase C.1 (FIX-I4) agent-team health dispatcher.
//
// Per architect.theo HIGH-3 (v2.9.0 design review): REJECT `library-migrate
// doctor` subverb; this umbrella owns the health-probe surface. Each probe
// is a separate module under `./doctor/probes/*.js` that owns ONE concern.
//
// USAGE
//   node doctor.js                          # run all probes, human-readable
//   node doctor.js --json                   # run all probes, JSON output
//   node doctor.js --probe env-inheritance  # run only one probe
//   node doctor.js --strict                 # exit 1 on any 'fail'
//   node doctor.js --probe X --strict       # combine
//
// OUTPUT JSON SHAPE
//   {
//     doctor_version: 1,
//     ran_at: <ISO timestamp>,
//     probes: {
//       <name>: { status: 'pass'|'warn'|'fail'|'not-implemented', details: {...} }
//     },
//     summary: { pass: N, warn: N, fail: N, not_implemented: N },
//     exit_code: 0|1
//   }
//
// STATUS ENUM (4-value; the 4th surfaces probes that are registered or
// requested but not yet built — `not-implemented` is explicit-unknown vs
// silent-skip per kb:architecture/discipline/error-handling-discipline):
//   pass             — probe ran; no issue surfaced
//   warn             — probe ran; non-fatal issue surfaced
//   fail             — probe ran; substantive issue requires action
//   not-implemented  — probe was requested but no module exists / module
//                      acknowledges its capability gap explicitly
//
// EXIT-CODE SEMANTICS
//   0 if all probes pass (or only warn / not-implemented) AND --strict
//     was not passed with any fail
//   1 if any probe fails AND --strict was passed
//   (warn + not-implemented are NEVER fatal; --strict only escalates fail)
//
// DESIGN ANCHORS (architect.theo HIGH-3):
//   - kb:architecture/crosscut/single-responsibility — each probe owns one concern
//   - kb:architecture/discipline/error-handling-discipline — fail-fast at startup
//     with clear diagnostic > silent degradation later

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function loadProbes() {
  const probesDir = path.join(__dirname, 'doctor', 'probes');
  if (!fs.existsSync(probesDir)) return {};
  const registry = {};
  for (const f of fs.readdirSync(probesDir)) {
    if (!f.endsWith('.js')) continue;
    const name = f.replace(/\.js$/, '');
    try {
      const mod = require(path.join(probesDir, f));
      if (mod && typeof mod.run === 'function') {
        registry[name] = mod;
      }
    } catch (err) {
      // A broken probe should not crash the dispatcher; surface it as
      // not-implemented with the error in details (still observability).
      registry[name] = {
        name,
        run: () => ({ status: 'not-implemented', details: { error: String(err && err.message || err) } }),
      };
    }
  }
  return registry;
}

function runProbe(probeName, probe, args) {
  try {
    const result = probe.run(args);
    if (!result || typeof result.status !== 'string') {
      return { status: 'not-implemented', details: { error: 'probe returned malformed result' } };
    }
    return result;
  } catch (err) {
    return { status: 'fail', details: { error: String(err && err.message || err), probe: probeName } };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const probes = loadProbes();
  const result = {
    doctor_version: 1,
    ran_at: new Date().toISOString(),
    probes: {},
    summary: { pass: 0, warn: 0, fail: 0, not_implemented: 0 },
    exit_code: 0,
  };

  let toRun;
  if (args.probe) {
    if (probes[args.probe]) {
      toRun = { [args.probe]: probes[args.probe] };
    } else {
      // Explicit-unknown: requested probe doesn't exist in registry.
      result.probes[args.probe] = {
        status: 'not-implemented',
        details: { reason: `no probe registered under name '${args.probe}'`, available: Object.keys(probes) },
      };
      result.summary.not_implemented += 1;
      toRun = null;
    }
  } else {
    toRun = probes;
  }

  if (toRun) {
    for (const [name, probe] of Object.entries(toRun)) {
      const r = runProbe(name, probe, args);
      result.probes[name] = r;
      if (r.status === 'pass') result.summary.pass += 1;
      else if (r.status === 'warn') result.summary.warn += 1;
      else if (r.status === 'fail') result.summary.fail += 1;
      else result.summary.not_implemented += 1;
    }
  }

  // Exit-code semantics: --strict escalates fail (only). warn + not-implemented
  // are NEVER fatal — they're observability signals, not gates.
  if (args.strict && result.summary.fail > 0) {
    result.exit_code = 1;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // Human-readable summary
    process.stdout.write(`agent-team doctor (v${result.doctor_version}) — ${result.ran_at}\n\n`);
    for (const [name, r] of Object.entries(result.probes)) {
      const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '!' : r.status === 'fail' ? '✗' : '?';
      process.stdout.write(`  ${icon} ${name}: ${r.status}\n`);
      if (r.details && typeof r.details === 'object') {
        for (const [k, v] of Object.entries(r.details)) {
          process.stdout.write(`      ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}\n`);
        }
      }
    }
    process.stdout.write(`\nSummary: ${result.summary.pass} pass, ${result.summary.warn} warn, ${result.summary.fail} fail, ${result.summary.not_implemented} not-implemented\n`);
  }

  // Emit warnings to stderr for the warn case (per architect HIGH-3 spec).
  for (const [name, r] of Object.entries(result.probes)) {
    if (r.status === 'warn') {
      process.stderr.write(`[doctor] WARN ${name}: ${JSON.stringify(r.details)}\n`);
    }
  }

  process.exit(result.exit_code);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, loadProbes, runProbe };
