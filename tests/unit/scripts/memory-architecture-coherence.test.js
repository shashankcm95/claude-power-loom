#!/usr/bin/env node
/**
 * memory-architecture-coherence.test.js — external-readiness checkpoint, Track B1
 *
 * A STRUCTURAL regression assertion over the ADR-0018 memory-architecture chain.
 * Layer 1 (memory architecture) is BUILT + phase-closed (ADR-0018/19/20/21 merged,
 * #517-531); this test codifies its load-bearing structural claims so they cannot
 * silently drift. It is the durable form of the checkpoint's "memory-architecture
 * coherence CONFIRM" — see docs/phases/phase-external-readiness.md (L1 exit criterion)
 * and packages/specs/plans/2026-07-10-external-readiness-checklist.md (B1).
 *
 * What it asserts (and what breaks it):
 *   Group A — the ADR chain is coherent + ACTIVE
 *     T1  the 4 canonical memory ADRs exist as files
 *     T2  each reads `status: accepted`     (guards Track B2 from silently reverting)
 *     T3  each reads `superseded_by: null`  (live canon, not superseded)
 *     T4  `adr.js active` recognizes all 4  (the real end-to-end consequence of T2;
 *                                            adr.js gates active on status===accepted)
 *   Group B — the ADR-0020 correction (lifecycle built ONCE; single detection leaf)
 *     T5  the pure detection leaf packages/kernel/_lib/recurrence-lifecycle.js exists
 *     T6  ADR-0020 still records that it CORRECTS ADR-0018 invariant #1
 *   Group C — the two substrates exist and stay SEPARATE (ADR-0018 inv#4 + ADR-0021)
 *     T7  operating-memory substrate present   (scripts/memory.js)
 *     T8  lab causal-edge lesson substrate present (packages/lab/causal-edge/lesson-*)
 *     T9  the separation dam test exists (drafter-recall-disjointness.test.js)
 *     T10 ADR-0021 records the no-cross-substrate-auto-promotion trust ceiling
 *   Group D — the fork-ledger (ADR-0019)
 *     T11 docs/FORKS.md exists
 *
 * This is a coherence/fixture test in the shape of
 * tests/unit/scripts/ml-engineer-scope-coherence.test.js — plain node, no framework.
 * Auto-gated by the CI "Auxiliary unit tests (outside kernel/runtime/lab)" job.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const ADRS_DIR = path.join(REPO, 'packages/specs/adrs');
const ADR_JS = path.join(REPO, 'packages/runtime/orchestration/adr.js');

// Reuse the CANONICAL frontmatter parser — the same one adr.js uses (T4's real
// path). Extracted at H.8.7 (chaos H4) specifically to close divergent inline
// implementations; it strips YAML 1.2 inline `#` comments and returns JS `null`
// for the `null` literal. Reimplementing a regex here would reopen that bug class.
const { parseFrontmatter } = require(path.join(REPO, 'packages/kernel/_lib/frontmatter.js'));

// The 4 canonical memory ADRs (ADR-0018 chain). See MEMORY.md ## Canonical.
const MEMORY_ADR_IDS = ['0018', '0019', '0020', '0021'];

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

/** Resolve the ADR file path for a numeric id (files carry a slug after the id). */
function adrPathForId(id) {
  const match = fs.readdirSync(ADRS_DIR).find((f) => f.startsWith(id + '-') && f.endsWith('.md'));
  return match ? path.join(ADRS_DIR, match) : null;
}

process.stdout.write('\n[external-readiness B1] memory-architecture coherence (ADR-0018 chain)\n');

// ---- Group A: the ADR chain is coherent + active --------------------------
const adrPaths = {};
for (const id of MEMORY_ADR_IDS) {
  const p = adrPathForId(id);
  adrPaths[id] = p;
  assert(p !== null && fs.existsSync(p), `T1[${id}]: canonical memory ADR file exists`);
}

for (const id of MEMORY_ADR_IDS) {
  const p = adrPaths[id];
  const text = p ? fs.readFileSync(p, 'utf8') : '';
  const status = parseFrontmatter(text).frontmatter.status;
  assert(status === 'accepted', `T2[${id}]: status is accepted (got: ${JSON.stringify(status)}) — guards B2`);
}

for (const id of MEMORY_ADR_IDS) {
  const p = adrPaths[id];
  const text = p ? fs.readFileSync(p, 'utf8') : '';
  const superseded = parseFrontmatter(text).frontmatter.superseded_by;
  assert(superseded === null, `T3[${id}]: superseded_by is null (got: ${JSON.stringify(superseded)}) — live canon`);
}

// T4: the real end-to-end consequence — adr.js active must list all 4.
{
  let activeIds = [];
  let ok = true;
  try {
    const out = execFileSync('node', [ADR_JS, 'active'], { cwd: REPO, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    activeIds = (parsed.adrs || []).map((a) => String(a.adr_id));
  } catch (err) {
    ok = false;
    process.stdout.write('    (adr.js active failed: ' + err.message + ')\n');
  }
  for (const id of MEMORY_ADR_IDS) {
    assert(ok && activeIds.includes(id),
      `T4[${id}]: adr.js active recognizes the ADR (status->active consequence)`);
  }
}

// ---- Group B: the ADR-0020 correction (lifecycle built ONCE) --------------
{
  const leaf = path.join(REPO, 'packages/kernel/_lib/recurrence-lifecycle.js');
  assert(fs.existsSync(leaf),
    'T5: the single detection leaf packages/kernel/_lib/recurrence-lifecycle.js exists (ADR-0020: extracted once)');
}

{
  const p = adrPaths['0020'];
  const text = p ? fs.readFileSync(p, 'utf8') : '';
  // ADR-0020's load-bearing job is correcting ADR-0018 invariant #1.
  const correctsInv1 = /CORRECTS?\s+ADR-0018\s+invariant\s+#?1/i.test(text);
  assert(correctsInv1,
    'T6: ADR-0020 still records that it CORRECTS ADR-0018 invariant #1 (the built-once correction)');
}

// ---- Group C: two substrates, kept SEPARATE -------------------------------
{
  const opMem = path.join(REPO, 'scripts/memory.js');
  assert(fs.existsSync(opMem),
    'T7: operating-memory substrate present (scripts/memory.js)');
}

{
  const causalEdgeDir = path.join(REPO, 'packages/lab/causal-edge');
  const hasDir = fs.existsSync(causalEdgeDir) && fs.statSync(causalEdgeDir).isDirectory();
  const hasLessonStore = hasDir &&
    fs.readdirSync(causalEdgeDir).some((f) => /^lesson-.*\.js$/.test(f));
  assert(hasDir && hasLessonStore,
    'T8: lab causal-edge lesson substrate present (packages/lab/causal-edge/lesson-*.js)');
}

{
  const dam = path.join(REPO, 'tests/unit/lab/persona-experiment/drafter-recall-disjointness.test.js');
  assert(fs.existsSync(dam),
    'T9: the separation dam test exists (drafter-recall-disjointness.test.js) — recall stays disjoint from the drafter');
}

{
  const p = adrPaths['0021'];
  const text = p ? fs.readFileSync(p, 'utf8') : '';
  // ADR-0021: a machine-minted lesson NEVER auto-graduates across the substrate boundary.
  const noAutoPromote = /never\s+auto-?graduat/i.test(text) || /no\s+cross-substrate\s+auto-?promot/i.test(text);
  assert(noAutoPromote,
    'T10: ADR-0021 records the no-cross-substrate-auto-promotion trust ceiling (lesson !-> hard rule)');
}

// ---- Group D: the fork-ledger (ADR-0019) ----------------------------------
{
  const forks = path.join(REPO, 'docs/FORKS.md');
  assert(fs.existsSync(forks),
    'T11: docs/FORKS.md exists (ADR-0019 branching-continuity fork-ledger)');
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
