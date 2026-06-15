#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W0' Prototype-1 (a v3.10-retriever SPIKE, OUT of CI) -- the FIRST read that runs on the
// REAL persisted recall nodes, and the first read that EXPOSES the persona axis (empty on the 11
// pre-axis nodes -- all UNATTRIBUTED; a TAGGED node groups by author, as the unit test shows).
//
//   - retrieve() over listNodes()  -> the store->retrieve loop, finally on real nodes (not synthetic).
//   - personaView(listNodes())     -> group the real nodes by built_by author (A5/HO2: EXPOSES the
//                                     persona axis -- empty on the 11 pre-axis nodes, populated for a
//                                     tagged node).
//   - renderNodeForPrompt(node)    -> M1 (VERIFY-hacker): a retrieved node that ever reaches an actor
//                                     prompt MUST be rendered through an EXPLICIT field whitelist --
//                                     NEVER JSON.stringify(node), which would leak built_by/graded_by
//                                     (provenance metadata) into the prompt, a cross-persona strategy-
//                                     leak surface the single-tenant design never faced.
//
// This is a READ-ONLY demo: it does NOT feed any node into an actor prompt (the whitelist render is
// codified + tested NOW so the future render path is safe). All nodes are provenance=backtest;
// nothing here hardens trust (OQ-NS-6 narrows only).

'use strict';

const { listNodes } = require('../recall-graph-store');
const { retrieve } = require('./retrieve');

// M1 -- the ONLY fields a retrieved node may surface into a prompt. built_by/graded_by are NOT here.
function renderNodeForPrompt(node) {
  const ref = (node && node.worked_example_ref) || {};
  return `PRIOR EXAMPLE: repo=${ref.repo || '?'} issue=${ref.issue_id || '?'}`;
}

// personaView -- the read that SEES the persona axis: count nodes per (role.roster_name) author.
function personaView(nodes) {
  const by = Object.create(null);
  for (const n of (nodes || [])) {
    const b = n && n.built_by;
    const key = b && typeof b === 'object' ? `${b.role}.${b.roster_name || 'na'}` : 'absent';
    by[key] = (by[key] || 0) + 1;
  }
  return by;
}

// classifyRetrieval -- the pre-registered Part-1 outcome (HO1). The honest question is NOT "top minus
// second" (two RELEVANT siblings can be close, e.g. more-itertools 0.429/0.333 -- both beat the 0.000
// distractor floor: that is a DISCRIMINATION WIN, not near-random). It is "did the best match have REAL
// topic overlap" -- a strong absolute Jaccard means slug-lexical FOUND it; a weak one (a generic token
// only, e.g. wcwidth 'width' 0.077) is where a similarity surface would earn its keep. STRONG_MATCH is a
// heuristic label only; the full ranked VECTOR is printed and is the truth.
const STRONG_MATCH = 0.20;
function classifyRetrieval(ranked, hasDelim) {
  if (!hasDelim) return 'd:degenerate (issue_id not __-slug -> opaque tokenizer)';
  const scored = (ranked || []).filter((r) => r.score > 0);
  if (scored.length === 0) return 'a:repo-gate eliminated all (no same-repo node) -> null';
  const top = scored[0].score;
  if (top >= STRONG_MATCH) return `b:STRONG lexical match (top=${top.toFixed(3)}) -> slug-Jaccard discriminates; UNDERCUTS "need a similarity surface"`;
  return `c:WEAK lexical match (top=${top.toFixed(3)}, generic tokens only) -> supports "need a similarity surface"`;
}

module.exports = { renderNodeForPrompt, personaView, classifyRetrieval };

// --------------------------------------------------------------------------
// CLI demo -- run against the REAL backtest store; print personaView + a retrieval outcome table.
// --------------------------------------------------------------------------
if (require.main === module) {
  const out = (s) => process.stdout.write(`${s}\n`);
  const nodes = listNodes({});
  out(`=== v3.10-W0' Prototype-1 read-wire demo -- ${nodes.length} real persisted nodes ===\n`);

  out('--- personaView (the persona axis EXPOSED -- the 11 real nodes are all pre-axis, UNATTRIBUTED) ---');
  const view = personaView(nodes);
  for (const [k, v] of Object.entries(view)) out(`  ${v}x  built_by=${k}`);
  out('  (all "absent" -> the 11 pre-persona-axis nodes; UNATTRIBUTED at the read layer)\n');

  // Part 1: retrieve over the real nodes for a sample query from each repo present.
  out('--- retrieve() over listNodes() -- the FIRST store->retrieve on real nodes (HO1 outcome per query) ---');
  const queries = [
    { repo: 'jquast/wcwidth', title: 'Cap grapheme final width at 2 (foot, ghostty, terminal.exe)' },
    { repo: 'more-itertools/more-itertools', title: 'Fix numeric_range slicing with negative step returning empty range' },
    { repo: 'r1chardj0n3s/parse', title: 'parse loses microsecond precision on timestamps' },
  ];
  for (const q of queries) {
    const { ranked } = retrieve(q, nodes);
    const inRepo = ranked.filter((r) => r.repoMatch);
    const hasDelim = nodes.filter((n) => (n.worked_example_ref.issue_id || '').includes('__')).length === nodes.length;
    out(`\n  query[${q.repo}] "${q.title.slice(0, 48)}..."  (${inRepo.length} same-repo nodes)`);
    for (const r of inRepo.slice(0, 4)) out(`    ${r.score.toFixed(3)}  shared=[${r.shared.join(',')}]  ${r.node.worked_example_ref.issue_id}`);
    out(`    -> OUTCOME ${classifyRetrieval(ranked, hasDelim)}`);
  }
  // M1 demonstration: the whitelist render carries NO persona token.
  out('\n--- M1: renderNodeForPrompt() is whitelist-only (no persona leak) ---');
  if (nodes[0]) out(`  ${renderNodeForPrompt(nodes[0])}   (built_by/graded_by absent from the render by construction)`);
  out('\n=== demo complete (read-only; provenance=backtest; OQ-NS-6 narrows only) ===');
  process.exit(0);
}
