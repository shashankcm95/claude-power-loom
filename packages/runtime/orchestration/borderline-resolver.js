#!/usr/bin/env node
// packages/runtime/orchestration/borderline-resolver.js
//
// Router-V2 W2 — the Runtime inference layer at the borderline seam. Reads the A4
// scorer's (route-decide.js) JSON output as a DATA contract (it NEVER imports the
// kernel — runtime depends on the kernel's output shape, not its code) and makes the
// semantic escalation: the scorer-borderline band (and the zero-signal `uncertain`
// case) defaults to ROUTE (HETS) as a NUDGE, carrying a demote-if-trivial valve for
// the in-loop orchestrator to act on.
//
// Design (VERIFY board 2026-06-19, plan 2026-06-19-router-v2-w2-runtime-borderline):
//   - STRUCTURED FIELDS, not a forcing-instruction marker (W2 is a reader, not an
//     emitter; the family stays at 10/15).
//   - ADVISORY only (OQ-NS-6): returns a recommendation + a valve, never a block.
//   - NO LLM call: the in-loop Claude is the inference.
//   - SCOPE: fires ONLY on `recommendation==='borderline'` OR `uncertain===true`.
//     A `root` recommendation is passed through UNTOUCHED — the 555-row root-misclass
//     is W3's job, not W2's. `substrate_meta_detected` ALONE does NOT escalate (it is
//     a score-suppression catch-22 artifact, not an under-routing signal).
//   - FAIL-OPEN: any unparseable/empty/invalid scorer JSON -> route (mirrors the bash
//     gate's script-missing branch); W2 must never throw + halt the Step-0 gate.

'use strict';

const ROUTE = 'route';
const ROOT = 'root';
const BORDERLINE = 'borderline';

// The fail-open default (VERIFY W2-M2): on any unparseable/empty/invalid scorer JSON,
// default to route — an advisory layer must never become an availability risk.
const FAIL_OPEN = Object.freeze({
  resolved_recommendation: ROUTE,
  escalated: false,
  policy: 'fail-open',
  reasoning: 'route-decide JSON unparseable/absent; defaulting to route (fail-open)',
});

const DEMOTE_VALVE = 'Demote to root ONLY if you judge the FULL task genuinely trivial '
  + '(the A4 scorer saw a 200-char prefix + lexicon only).';

/**
 * Resolve the borderline seam. PURE.
 * @param {object|null|undefined} scorerJson the parsed route-decide output
 * @returns {{resolved_recommendation:string, escalated:boolean, policy:string, reasoning:string}}
 */
function resolveBorderline(scorerJson) {
  if (!scorerJson || typeof scorerJson !== 'object' || Array.isArray(scorerJson)) {
    return { ...FAIL_OPEN };
  }
  const rec = scorerJson.recommendation;
  const isBorderline = rec === BORDERLINE;
  const isUncertain = scorerJson.uncertain === true;

  // Pass-through: a definite route/root recommendation is honored as-is. W2 does NOT
  // touch the root band (the 555-row dominant misclass is W3's scope boundary).
  if (!isBorderline && !isUncertain) {
    if (rec === ROUTE || rec === ROOT) {
      return {
        resolved_recommendation: rec,
        escalated: false,
        policy: 'passthrough',
        reasoning: `scorer recommendation '${rec}' honored (W2 fires only on borderline/uncertain).`,
      };
    }
    return { ...FAIL_OPEN }; // an unknown/missing recommendation -> fail-open to route
  }

  // The NUDGE: escalate -> route, with the demote-if-trivial valve. The policy basis
  // differs by trigger and is named honestly: the borderline band is corpus-supported
  // (80% of scorer-borderline rows are route-labeled); the uncertain case is policy-
  // driven (escalate on uncertainty) and composes with the kernel's own instruction.
  const score = typeof scorerJson.score_total === 'number' ? scorerJson.score_total : null;
  const signals = Array.isArray(scorerJson.signals_matched) ? scorerJson.signals_matched.slice(0, 3) : [];
  const sigPart = signals.length ? ` [signals: ${signals.join(', ')}]` : '';

  if (isBorderline) {
    return {
      resolved_recommendation: ROUTE,
      escalated: true,
      policy: 'borderline-escalate-to-hets',
      reasoning: `scorer-borderline band (score ${score})${sigPart} -> escalated to route (HETS) `
        + `per the borderline->HETS policy. ${DEMOTE_VALVE}`,
    };
  }
  // isUncertain (typically rec==='root' with zero signals) — compose with, do not
  // re-state, the kernel's [ROUTE-DECISION-UNCERTAIN] instruction.
  return {
    resolved_recommendation: ROUTE,
    escalated: true,
    policy: 'uncertain-escalate-to-hets',
    reasoning: `zero-signal uncertain task (scorer rec '${rec}') -> escalated to route (HETS) `
      + `as the under-routing mitigation. ${DEMOTE_VALVE}`,
  };
}

module.exports = { resolveBorderline, FAIL_OPEN };

// ---------- CLI ----------
// Reads the route-decide JSON from --json '<string>' or STDIN (the bash Step-0 gate
// pipes it). Emits the resolved object as JSON on stdout. ALWAYS exits 0 (advisory).
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--json');
  const fromFlag = flagIdx >= 0 && argv[flagIdx + 1] ? argv[flagIdx + 1] : null;

  const run = (raw) => {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; } // fail-open on bad JSON
    process.stdout.write(JSON.stringify(resolveBorderline(parsed)) + '\n');
  };

  if (fromFlag !== null) {
    run(fromFlag);
  } else {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => run(buf.trim()));
    // If stdin is a TTY with no input, end fires on close; guard an empty no-stdin run.
    if (process.stdin.isTTY) { process.stdin.emit('end'); }
  }
}
