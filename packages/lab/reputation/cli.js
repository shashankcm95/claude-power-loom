#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 2 — E4 reputation CLI: inspect the advisory-verdict DISTRIBUTION over kernel-attested
// spawns (display-only). It only READS (the projection is pure); it never writes, GATES, or itself
// dispatches a spawn ("routes" = the CLI performs the routing — it never does). `snapshot` and `narrow`
// produce a decision-INPUT the ORCHESTRATOR consults; neither gates. Emitting a `reroute`-bearing
// advisory is NOT a charter breach — do not "fix" `narrow` to exit non-zero on reroute (architect VERIFY F2).
//
// Subcommands:
//   show [--persona <name>]      print the LIVE per-subject-persona distribution (pure projection)
//   materialize                  write the A6 reputation SNAPSHOT off-hot-path (what the kernel reads)
//   snapshot [--personas a,b,c]  read the PRE-COMPUTED snapshot, optionally filtered to a candidate SET
//   narrow --personas a,b,c      the COMBINED advisory (reputation + breaker via recommendNarrowing):
//                                per-candidate proceed|down-weight|reroute. Narrows-only, NEVER a gate
//
// `snapshot` is the v3.4 advisory READ PATH consumed by the orchestrator persona-selection step (the
// A6-advise convention in agent-identity-reputation.md): it reads the snapshot the kernel records, NOT
// the live projection — display-only/advisory (§0a.3.1 line 173 "MAY recommend"), never gates, never
// widens. `--personas`/`--persona` filters to the candidate set in CALLER ORDER (NOT ranked, NOT a
// score — the orchestrator judges over the raw distributions). An absent snapshot → reputation-blind.
//
// Exit codes: 0 on success; 1 on usage / IO error (a clean message, never a stack dump).

'use strict';

const { projectReputation } = require('./project');
const { materializeSnapshot } = require('./materialize');
const { narrow } = require('./narrow');                             // item-6 — the combined recommendNarrowing advisory
const { DEFAULT_SOURCE } = require('../circuit-breaker/project');   // the pinned breaker source (for the starved-source warning)
const { readEvolutionSnapshot, resolveSnapshotPath } = require('../../kernel/_lib/evolution-snapshot-read');
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key');

// W4d Item 1d (CLI symmetry, folds architect-A4): the projection now emits the CANONICAL bare key
// (1a) even for a record made under the numbered form, so a --persona/--personas filter token is
// canonicalized too — a `--persona 13-node-backend` query still matches the now-canonical emitted
// rows. `|| raw` (NOT 'unknown') keeps an off-roster token raw (it then matches only a raw-keyed row).
function canonToken(tok) {
  return canonicalPersonaKey(tok) || tok;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
    }
  }
  return args;
}

// A6-advise read-consumer: collect requested persona names from --personas (comma-list) + --persona
// (single alias). Defensive (verify-plan code-reviewer Check 1): parseArgs yields `true` for a bare flag
// → typeof-guard; trim each, drop empties (handles whitespace / trailing-comma / 'a,,b'); dedup
// preserving first-occurrence order (Set is also prototype-safe — a "__proto__" name can't collide).
// An empty result → no filter (whole snapshot).
function collectPersonas(args) {
  const names = [];
  if (typeof args.personas === 'string') {
    for (const tok of args.personas.split(',')) { const n = tok.trim(); if (n) names.push(canonToken(n)); }
  }
  if (typeof args.persona === 'string') { const n = args.persona.trim(); if (n) names.push(canonToken(n)); }
  return [...new Set(names)];
}

const USAGE = [
  'Usage:',
  '  cli.js show [--persona <name>]        the LIVE advisory-verdict distribution (pure projection)',
  '  cli.js materialize                    write the A6 reputation SNAPSHOT (off-hot-path; the kernel reads it)',
  '  cli.js snapshot [--personas a,b,c]    read the PRE-COMPUTED snapshot, optionally filtered to a candidate',
  '                                        SET in caller order (the A6-advise read; NOT ranked, NOT a score)',
  '  cli.js narrow --personas a,b,c        the COMBINED advisory (reputation + breaker): per-candidate',
  '                                        proceed|down-weight|reroute (recommendNarrowing). Narrows-only, NEVER a gate',
  '  cli.js verify-snapshot                A6 M1 provenance check: exit 0 iff present AND witnessed by a',
  '                                        materialize event (witnessed != authentic-beyond-same-uid)',
  '',
].join('\n');

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'show') {
    try {
      const out = projectReputation();
      if (typeof args.persona === 'string') {
        const want = canonToken(args.persona);
        out.personas = out.personas.filter((p) => p.persona === want);
      }
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`reputation: show failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'materialize') {
    try {
      const out = materializeSnapshot({});
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`reputation: materialize failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'verify-snapshot') {
    // The operator/gate surface for the A6 M1 provenance check (v3.8b W2). Exit 0 ONLY when the
    // snapshot is present AND witnessed — unlike `snapshot` (where absent = benign reputation-blind),
    // an explicit verify is a GATE question, so absent/forged/unwitnessed all exit 1.
    const snap = readEvolutionSnapshot({ verifyProvenance: true });
    process.stdout.write(`${JSON.stringify({ path: resolveSnapshotPath(), ...snap }, null, 2)}\n`);
    if (snap.present && snap.provenance === 'witnessed') process.exit(0);
    process.stderr.write('reputation: verify-snapshot FAILED — the snapshot is absent or not witnessed by a materialize event (heal: re-run `reputation materialize`).\n');
    process.exit(1);
  }

  if (cmd === 'snapshot') {
    // The advisory read path: read the PRE-COMPUTED A6 snapshot (NOT the live projection). An absent
    // snapshot is NOT an error (reputation-blind is the safe default) → exit 0. Optional --personas/
    // --persona filters to a candidate SET (the A6-advise consumer): caller-order, NOT ranked/sorted.
    const snap = readEvolutionSnapshot();
    const requested = collectPersonas(args);
    if (requested.length === 0 || !snap.present || !Array.isArray(snap.value)) {
      // No filter, OR blind (absent snapshot), OR no value array → return the envelope UNCHANGED.
      // (Conflating "no snapshot at all" with "these personas unmeasured" would mislead — Check 3.)
      process.stdout.write(`${JSON.stringify({ path: resolveSnapshotPath(), ...snap }, null, 2)}\n`);
      process.exit(0);
    }
    // Map-lookup over the REQUESTED array → caller order (snap.value is alpha-sorted; .filter() would
    // keep snapshot order — Check 2). The Map is prototype-safe (Check 5 — never obj[name]). An absent
    // persona → an explicit no-data marker, NEVER dropped (no-data != low-rep — D3 / E11-M1). No sort,
    // no derived score (the NOT-A-SCORE invariant; the orchestrator judges over the raw distributions).
    const byPersona = new Map(snap.value.map((p) => [p.persona, p]));
    const value = requested.map((name) => byPersona.get(name) || { persona: name, status: 'no-data' });
    process.stdout.write(`${JSON.stringify({
      path: resolveSnapshotPath(),
      ...snap,
      value,
      filter: {
        requested,
        note: 'distributions in CALLER ORDER - NOT ranked, NOT a score; the orchestrator judges. no-data / pending_enrichment>0 means UNMEASURED: neither better NOR worse than a measured distribution - do NOT prefer OR deselect on absence alone; when candidates differ only by measured-vs-unmeasured, fall back to lens-fit (VALIDATE hacker M2).',
      },
    }, null, 2)}\n`);
    process.exit(0);
  }

  if (cmd === 'narrow') {
    // item-6 — the COMBINED advisory: reputation distribution + breaker -> per-candidate proceed|down-weight|reroute
    // (the pure recommendNarrowing, fed the LIVE lane). NARROWS-ONLY, NEVER A GATE (§0a.3.1-clean; the orchestrator
    // MAY consult it to narrow its OWN choice among lens-equals). Exit 0 on a resolved read (an empty store -> all
    // proceed/insufficient-evidence is VALID, not an error); a projectReputation FAULT fails LOUD (exit 1, MED-1).
    const requested = collectPersonas(args);
    if (requested.length === 0) {
      process.stderr.write('reputation: narrow requires a candidate SET via --personas a,b,c (or --persona <name>)\n');
      process.exit(1);
      return;
    }
    let recs;
    try {
      recs = narrow(requested, {});          // MED-1: a store-read throw propagates here -> exit 1 (a fault, never `proceed`)
    } catch (e) {
      process.stderr.write(`reputation: narrow failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    // HIGH-2: a STARVED live source giving a false-clear must be VISIBLE — never let it masquerade as a clean advisory.
    if (recs.some((r) => r && r.evidence && r.evidence.source_starved === true)) {
      process.stderr.write(`reputation: WARNING the pinned breaker source '${DEFAULT_SOURCE}' is STARVED (its producer is probe-dead) - the reroute axis is NOT a safety signal for this read; only the reputation axis is live.\n`);
    }
    process.stdout.write(`${JSON.stringify({
      recommendations: recs,
      note: 'ADVISORY - narrows-only (proceed | down-weight | reroute), NEVER a hard gate: the orchestrator MAY consult it to narrow its OWN spawn choice among lens-equals; nothing acts on it automatically. A SHADOW read of the LIVE reputation lane (integrity-not-provenance, #273-open) + the pinned verdict-fail breaker. Candidate tokens are CANONICALIZED to the reputation store keys.',
    }, null, 2)}\n`);
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
