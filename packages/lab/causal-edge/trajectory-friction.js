#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W3 — trajectory capture + the resolution_friction friction map. PURE +
// DETERMINISTIC: the parser/metrics/cluster core, TDD'd with synthetic NDJSON
// fixtures shaped like the FIRSTHAND `claude -p --output-format stream-json`
// probe (plan RP-1). The LLM + the real capture are NEVER called here; the real
// capture/label live in trajectory-friction-run.js (out of the unit glob).
//
// IMPORT ALLOW-LIST (Linux-CI-safe): corpus.js (frozen W0) only. NO child_process,
// NO claude, NO *-run module.
//
// THE TRUST BOUNDARY: the actor grades a STRANGER's code that itself runs tools,
// so tool_name / tool_use.id / tool_result.content are adversary-shapeable bytes
// crossing into parseTrajectory (VERIFY-hacker F2). Defenses: a Map / hasOwnProperty
// keying (never a plain object keyed by an untrusted name → no prototype pollution);
// FIRST-tool_use-wins FIFO pairing (a forged/duplicate tool_result never overwrites
// an existing pairing); unknown-tool default to an unclassified phase.
//
// THE NEVER-BLEND / NEVER-BORROW DISCIPLINE: the recall-smell + friction map are
// DIAGNOSTIC, signal-with-error-bars MEASURED on this corpus (never the borrowed
// 87%/13% out-of-distribution analogue). The recall-smell fires on TWO signals,
// never trajectory-shape alone (the literature INVERTS the naive expectation:
// chaos = failure, not recall). Its validation is THREE-valued + fail-closed.

'use strict';

const crypto = require('crypto');
const { N_CLEAN_LARGE_MIN } = require('../issue-corpus/corpus');
// v3.11 W1 — the closed-set key primitive now lives in a neutral _lib module shared
// with the lesson key space (architect fold; a primitive feeding two one-way-door key
// spaces must not live inside one of them). Behavior is byte-identical to the prior
// local def (typeof-string guard before membership; off-enum -> INVALID).
const { safeEnumKey } = require('../_lib/enum-key');

const MAX_EMBEDDING_LEN = 4096;

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// FAIL-CLOSED (VALIDATE-hacker MEDIUM): a circular / non-serializable tool_input
// must degrade THIS digest to a sentinel, never abort scoreAttempt (the rest of
// the module is fail-closed; the trajectory axis is report-only).
function digest(x) {
  let s = '[uncomputable]';
  try { s = (x == null) ? '' : (typeof x === 'string' ? x : JSON.stringify(x)); } catch { /* circular/throwing -> sentinel */ }
  if (typeof s !== 'string') s = '[uncomputable]';               // JSON.stringify(fn/symbol) -> undefined
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// --------------------------------------------------------------------------
// Phase inference (Layer-1 structural classification; a deterministic function
// of tool_name + the Bash command). A non-test-like Bash is AMBIGUOUS, never a
// forced binary (VERIFY-arch F5: an ambiguous step must not manufacture a
// back_edge / loop oscillation downstream).
// --------------------------------------------------------------------------

// The action enum is RE-DERIVED from Claude Code's tool surface (plan §3.3 — not
// SWE-agent's open/scroll/edit names). Frozen; unknown tools => unclassified.
const TOOL_PHASE = Object.freeze({
  Read: 'localization', Grep: 'localization', Glob: 'localization',
  Edit: 'editing', Write: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing',
});
const FILE_TARGET_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']);

// A bounded test-like heuristic. Known blind spots (custom runners) are a MEASURED
// limitation feeding the error bar (VERIFY-arch F5), not a silent gap.
const TEST_LIKE = /(^|\s|\/)(pytest|tox|jest|unittest|nose2?|phpunit|rspec|mocha)\b|(npm|yarn|pnpm)\s+(run\s+)?test|go\s+test|cargo\s+test|python\s+-m\s+(pytest|unittest)|make\s+(test|check)|loom-run-tests|run[-_]tests|\.\/test/i;

function classifyBashPhase(command) {
  return TEST_LIKE.test(String(command == null ? '' : command)) ? 'validation' : 'ambiguous';
}

function phaseOf(name, input) {
  if (hasOwn(TOOL_PHASE, name)) return TOOL_PHASE[name];
  if (name === 'Bash') return classifyBashPhase(input && input.command);
  return null;
}

function extractTargetPath(name, input) {
  if (!FILE_TARGET_TOOLS.has(name) || !input || typeof input !== 'object') return null;
  const p = input.file_path || input.path || input.notebook_path || input.pattern;
  return (typeof p === 'string' && p.length > 0) ? p : null;
}

function coerceContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : JSON.stringify(b)).join('\n');
  }
  return JSON.stringify(content == null ? '' : content);
}

// --------------------------------------------------------------------------
// parseTrajectory — stream-json NDJSON events -> ordered trajectory rows.
// Filters noise (system/*, result/*, rate_limit_event); pairs tool_use<->tool_result
// by id with FIRST-wins FIFO; step_idx is a GLOBAL monotonic counter over tool_use
// blocks in stream order (NOT per-message — VERIFY-arch F6); thought_digest is the
// NEAREST-PRECEDING thinking/text (reset after each tool_use).
// --------------------------------------------------------------------------

function parseTrajectory(streamEvents) {
  const rows = [];
  let dropped_noise = 0;
  let unbound_results = 0;
  const pending = new Map();                                      // id -> [rowIdx,...] FIFO of unconsumed tool_use (F2 poison-safe: a Map, not a plain object)
  let stepIdx = 0;
  const events = Array.isArray(streamEvents) ? streamEvents : [];

  for (const evt of events) {
    if (!evt || typeof evt !== 'object') { dropped_noise += 1; continue; }
    if (evt.type === 'assistant') {
      const content = (evt.message && Array.isArray(evt.message.content)) ? evt.message.content : [];
      let thoughtParts = [];
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        if (c.type === 'thinking') thoughtParts.push(String(c.thinking == null ? '' : c.thinking));
        else if (c.type === 'text') thoughtParts.push(String(c.text == null ? '' : c.text));
        else if (c.type === 'tool_use') {
          const name = String(c.name == null ? '' : c.name);
          rows.push({
            step_idx: stepIdx++,
            tool_name: name,
            tool_input_digest: digest(c.input),
            target_path: extractTargetPath(name, c.input),
            thought_digest: digest(thoughtParts.join('\n')),
            phase: phaseOf(name, c.input),
            observation_digest: null,
            is_error: false,
          });
          const id = typeof c.id === 'string' ? c.id : null;
          if (id !== null) { const q = pending.get(id) || []; q.push(rows.length - 1); pending.set(id, q); }
          thoughtParts = [];                                       // nearest-preceding: reset after a tool_use
        }
      }
    } else if (evt.type === 'user') {
      const content = (evt.message && Array.isArray(evt.message.content)) ? evt.message.content : [];
      for (const c of content) {
        if (!c || typeof c !== 'object' || c.type !== 'tool_result') continue;
        const id = typeof c.tool_use_id === 'string' ? c.tool_use_id : null;
        const q = id !== null ? pending.get(id) : null;
        if (q && q.length > 0) {
          const rowIdx = q.shift();                                // FIFO: a result consumes the EARLIEST unconsumed tool_use of that id
          rows[rowIdx].observation_digest = digest(coerceContent(c.content));
          rows[rowIdx].is_error = c.is_error === true;
        } else {
          unbound_results += 1;                                    // forged / unknown id / result-before-use / over-count
        }
      }
    } else {
      dropped_noise += 1;                                          // system/*, result/*, rate_limit_event, unknown
    }
  }

  const nullObs = rows.filter((r) => r.observation_digest === null).length;
  return { rows, dropped_noise, unpaired: unbound_results + nullObs };
}

// --------------------------------------------------------------------------
// computeProcessGraph — Layer-1 metrics from the phase sequence. The graph
// metrics (back_edge / loop_count) walk the RANKED sequence EXCLUDING ambiguous
// + null steps (F5), so phase-classification noise cannot manufacture a low-loop
// recall flag.
// --------------------------------------------------------------------------

const PHASE_RANK = Object.freeze({ localization: 0, editing: 1, validation: 2 });

function computeProcessGraph(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const phases = list.map((r) => (r && typeof r.phase === 'string') ? r.phase : null);

  const localization_reads = [];
  let n_localization = 0; let n_editing = 0; let n_validation = 0; let n_ambiguous = 0;
  for (const r of list) {
    const ph = r && r.phase;
    if (ph === 'localization') { n_localization += 1; if (r.target_path) localization_reads.push(r.target_path); }
    else if (ph === 'editing') n_editing += 1;
    else if (ph === 'validation') n_validation += 1;
    else if (ph === 'ambiguous') n_ambiguous += 1;
  }

  const ranked = phases.filter((p) => p in PHASE_RANK).map((p) => PHASE_RANK[p]);
  let loop_count = 0;
  for (let i = 1; i < ranked.length; i++) if (ranked[i] < ranked[i - 1]) loop_count += 1; // a rank DECREASE = a back-edge oscillation
  const back_edge = loop_count > 0;
  const avg_loop_length = ranked.length > 0 ? ranked.length / (loop_count + 1) : 0;
  const reached_validation_before_submit = phases.includes('validation');

  return {
    phases, loop_count, avg_loop_length, back_edge, reached_validation_before_submit,
    localization_reads, n_localization, n_editing, n_validation, n_ambiguous,
  };
}

// --------------------------------------------------------------------------
// Path normalization (VERIFY-hacker F4) — both namespaces to repo-relative so a
// `./src/foo.py` actor read matches an `src/foo.py` accepted-diff path. Without
// this the membership test wrong-direction FALSE-FLAGS recall on an honest run.
// --------------------------------------------------------------------------

function normalizeRepoPath(p, { cloneRoot } = {}) {
  let s = String(p == null ? '' : p);
  if (cloneRoot && s.startsWith(cloneRoot)) s = s.slice(cloneRoot.length);
  s = s.replace(/^\.?\/+/, '');                                    // strip a leading ./ or /
  return s;
}

function baseName(p) { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }

// A relevant file counts as READ if a localization read matches it exactly
// (normalized) OR shares its basename / ends with `/basename`. The basename-suffix
// fallback is LOAD-BEARING (VALIDATE-hacker HIGH): the actor logs ABSOLUTE per-issue
// paths (`/private/var/.../clone/src/foo.py`) the repo-relative accepted_diff cannot
// exact-match even with a cloneRoot, so an exact-only test wrong-direction FALSE-FLAGS
// recall on an honest run that DID read the file. Safe-direction bounded heuristic: a
// same-basename read in a DIFFERENT dir SUPPRESSES a smell (a false-NEGATIVE — the
// safer error for a hedged diagnostic; it under-claims recall, never over-inflates the
// FP rate F1 measures).
function readCovers(f, reads) {
  if (reads.includes(f)) return true;
  const b = baseName(f);
  return reads.some((r) => r === b || r.endsWith(`/${b}`));
}

// --------------------------------------------------------------------------
// detectRecallSmell — the TWO-signal heuristic, fail-closed. Flag recall ONLY
// when (low loop_count + reached resolution) AND (relevant files unread). NEVER
// trajectory-shape alone. With no relevantFiles we CANNOT tell => UNKNOWN, never
// a smell. `localization_reads` is actor-ASSERTED (a logged Read != proof of a
// read) => the smell measures CLAIMED reads, an upper bound (F4 caveat).
// `relevant_files_unread` is anchored on the accepted_diff's file set => it shares
// leg C's anti-anchor caveat: a valid DIVERGENT fix may trip it (F8a).
// --------------------------------------------------------------------------

function detectRecallSmell({ processGraph, relevantFiles, reachedResolution, lowLoopMax = 1, cloneRoot } = {}) {
  const pg = processGraph || {};
  const low_loop = Number(pg.loop_count || 0) <= lowLoopMax;
  const reached = reachedResolution === true;
  const rel = (Array.isArray(relevantFiles) ? relevantFiles : []).map((f) => normalizeRepoPath(f, { cloneRoot }));
  const reads = (Array.isArray(pg.localization_reads) ? pg.localization_reads : []).map((f) => normalizeRepoPath(f, { cloneRoot }));

  let relevant_files_unread;
  let recall_smell;
  if (rel.length === 0) { relevant_files_unread = 'UNKNOWN'; recall_smell = false; } // fail-closed
  else { relevant_files_unread = rel.every((f) => !readCovers(f, reads)); recall_smell = low_loop && reached && relevant_files_unread === true; }

  return { recall_smell, signals: { low_loop, reached_resolution: reached, relevant_files_unread } };
}

// --------------------------------------------------------------------------
// resolution_friction — a NEW, SEPARATE closed-enum block (§3.6 — NOT an
// ADR-0015 failed_criterion_id extension; INV-FS-CriterionEnumMirrorsR9 untouched).
// --------------------------------------------------------------------------

const FRICTION_CLASS = Object.freeze([
  'wrong-file', 'wrong-edit-location', 'incorrect-implementation', 'over-editing',
  'incomplete-fix', 'instruction-misread', 'hallucinated-api', 'gave-up',
  'cant-reproduce', 'ran-out-of-budget',
]);
const FRICTION_PHASE = Object.freeze(['localization', 'editing', 'validation']);
const DETECTION_LEG = Object.freeze(['behavioral', 'semantic-lens', 'reference-anchor']);

function validEmbedding(e) {
  return Array.isArray(e) && e.length > 0 && e.length <= MAX_EMBEDDING_LEN && e.every((x) => typeof x === 'number' && Number.isFinite(x));
}

function buildResolutionFriction({ friction_class, friction_phase, detection_leg, expected, observed, human_message, embedding } = {}) {
  if (!FRICTION_CLASS.includes(friction_class)) throw new Error(`unknown friction_class: ${friction_class}`);
  if (!FRICTION_PHASE.includes(friction_phase)) throw new Error(`unknown friction_phase: ${friction_phase}`);
  if (!DETECTION_LEG.includes(detection_leg)) throw new Error(`unknown detection_leg: ${detection_leg}`);
  const block = {
    friction_class, friction_phase, detection_leg,
    // Free-form diagnostics live under _diagnostic — the deterministic clusterer
    // MUST NOT parse them (§3.6). They are descriptive, never a cluster key.
    _diagnostic: Object.freeze({
      expected: expected == null ? null : String(expected),
      observed: observed == null ? null : String(observed),
      human_message: human_message == null ? null : String(human_message),
    }),
  };
  // The OPTIONAL semantic embedding is the depth layer (NEVER the key). A
  // malformed embedding is DROPPED (fail-closed to no-embedding) — never throws
  // the whole block on a depth-only field (F7).
  if (validEmbedding(embedding)) block.embedding = Object.freeze(embedding.slice());
  return Object.freeze(block);
}

// A boundary guard for an INJECTED friction label (VALIDATE-honesty LOW): the scorer
// trusts an injected frictionFn's return, so re-check the closed-enum shape before it
// lands in the Path-1 record. Returns the block if its three enum fields are valid,
// else null (fail-closed — a malformed/unvalidated leg writes NO friction).
function isValidResolutionFriction(block) {
  return !!block && typeof block === 'object'
    && FRICTION_CLASS.includes(block.friction_class)
    && FRICTION_PHASE.includes(block.friction_phase)
    && DETECTION_LEG.includes(block.detection_leg);
}
function validateResolutionFriction(block) { return isValidResolutionFriction(block) ? block : null; }

// --------------------------------------------------------------------------
// The dual-representation clusterer. The closed-enum 3-tuple is the deterministic
// dedup/cluster KEY (analogous to E11's dedup-by-(persona, agent_id)); a semantic
// embedding is an OPTIONAL depth layer, NEVER the key. frictionClusterKey reads
// ONLY the three named enum fields by explicit access — never a JSON.stringify of
// the block (which would re-admit the attacker-influenceable _diagnostic free-text
// into the deterministic key — F7).
// --------------------------------------------------------------------------

// Reads ONLY the three named enum fields, each coerced through a closed-set guard
// (VALIDATE-hacker LOW): a RAW block bypassing buildResolutionFriction could otherwise
// inject extra `|` separators via an object's toString or seat a poison token as a key
// component. An off-enum/non-string field => the literal `INVALID` (a deterministic,
// closed key component), never the attacker's bytes.
function frictionClusterKey(block) {
  return `${safeEnumKey(block.friction_class, FRICTION_CLASS)}|${safeEnumKey(block.friction_phase, FRICTION_PHASE)}|${safeEnumKey(block.detection_leg, DETECTION_LEG)}`;
}

function clusterFriction(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const clusters = Object.create(null);                           // null-proto: a tuple containing a poison token can never pollute
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const key = frictionClusterKey(b);
    if (!clusters[key]) clusters[key] = { friction_class: b.friction_class, friction_phase: b.friction_phase, detection_leg: b.detection_leg, count: 0, members: [] };
    clusters[key].count += 1;
    clusters[key].members.push(i);
  }
  return { clusters, n: Object.keys(clusters).length };
}

// --------------------------------------------------------------------------
// validateRecallSmellAgainstControls — the RFC §3.3 "validate BEFORE trusting it"
// mandate, realized as a THREE-valued verdict (F1). Per-track: neg-control FP is
// partly STRUCTURAL (a neg-control ~never reaches resolution + has an empty
// accepted_diff => relevantFiles empty => UNKNOWN => FP ~0 BY CONSTRUCTION), so
// the discrimination claim rests on CLEAN-TRACK true-positive shape, not the
// structural neg-control ~0. The FP threshold + TP floor are PROVISIONAL on-this-
// corpus design choices, NOT literature constants; the labeler error bar is
// UNKNOWN-until-measured (never the borrowed 87%/13%).
// --------------------------------------------------------------------------

function validateRecallSmellAgainstControls(labeled, { fpThreshold = 0.1, tpFloor = 0.5, minN = N_CLEAN_LARGE_MIN } = {}) {
  const list = Array.isArray(labeled) ? labeled : [];
  const neg = list.filter((x) => x && x.is_negative_control === true);
  const clean = list.filter((x) => x && x.is_negative_control !== true);
  const cleanExpected = clean.filter((x) => x.expected_recall === true);

  const neg_control_fp_rate = neg.length ? neg.filter((x) => x.recall_smell === true).length / neg.length : null;
  const clean_track_tp_rate = cleanExpected.length ? cleanExpected.filter((x) => x.recall_smell === true).length / cleanExpected.length : null;

  let discriminates;
  if (neg.length < minN || cleanExpected.length < minN) discriminates = 'INSUFFICIENT-N';
  // explicit null-guard (VALIDATE-reviewer MEDIUM): a null rate must NOT coerce to 0
  // and silently mint DISCRIMINATES with no evidence (e.g. a minN=0 caller, 0 controls).
  else if (neg_control_fp_rate === null || clean_track_tp_rate === null) discriminates = 'INSUFFICIENT-N';
  else if (neg_control_fp_rate <= fpThreshold && clean_track_tp_rate >= tpFloor) discriminates = 'DISCRIMINATES';
  else discriminates = 'DOES-NOT-DISCRIMINATE';

  return {
    neg_control_fp_rate, clean_track_tp_rate,
    n_neg: neg.length, n_clean: clean.length, n_clean_expected: cleanExpected.length,
    fp_threshold: fpThreshold, tp_floor: tpFloor, min_n: minN,
    discriminates, detector_validated: discriminates === 'DISCRIMINATES',
    error_bar: 'UNKNOWN-until-measured',                          // never the borrowed 87%/13% OOD analogue
  };
}

// --------------------------------------------------------------------------
// buildFrictionLabelerInput — the PUBLIC-SAFE projection handed to the impure
// frictionFn (VERIFY-hacker F3): the problem digest + the candidate patch + the
// process-graph METRICS only. The path list (target_paths / localization_reads)
// + any sealed field are STRIPPED — the label lens is grader-side but must never
// receive the grader-side oracle (accepted_diff) nor the raw target paths.
// --------------------------------------------------------------------------

function buildFrictionLabelerInput({ problem_statement_digest, candidate_patch, processGraph } = {}) {
  const pg = processGraph || {};
  return {
    problem_statement_digest: problem_statement_digest == null ? null : String(problem_statement_digest),
    candidate_patch: String(candidate_patch == null ? '' : candidate_patch),
    process_graph: {                                               // METRICS ONLY — localization_reads (the path list) is deliberately omitted
      loop_count: pg.loop_count, avg_loop_length: pg.avg_loop_length, back_edge: pg.back_edge,
      reached_validation_before_submit: pg.reached_validation_before_submit,
      n_localization: pg.n_localization, n_editing: pg.n_editing, n_validation: pg.n_validation, n_ambiguous: pg.n_ambiguous,
      phases: Array.isArray(pg.phases) ? pg.phases.slice() : [],
    },
  };
}

module.exports = {
  parseTrajectory, computeProcessGraph, normalizeRepoPath, detectRecallSmell,
  TOOL_PHASE, classifyBashPhase,
  FRICTION_CLASS, FRICTION_PHASE, DETECTION_LEG, buildResolutionFriction, validateResolutionFriction,
  frictionClusterKey, clusterFriction, validateRecallSmellAgainstControls,
  buildFrictionLabelerInput,
};
