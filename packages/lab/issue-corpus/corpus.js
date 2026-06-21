#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W0 — the issue-corpus forward contract. PURE + DETERMINISTIC: the no-LLM, no-sandbox substrate
// the retrospective bootcamp (RFC 2026-06-13-v3.9-retrospective-calibration-bootcamp.md) freezes before
// any actor runs. The LLM is NEVER called here, no network, no ContainerAdapter — the impure GitHub
// ingestion is a separate later module (the calibration-run.js analog). This module is the thing the
// deterministic suite tests.
//
// THE SECURITY BOUNDARY (the whole bootcamp's honesty rests on it): the actor sees ONLY PublicProblem;
// the oracle (accepted_diff, tests, rubric, ...) is SEALED grader-side. splitRecord is a WHITELIST-COPY
// (never a spread/delete) so no unlisted/aliased/Symbol/inherited sealed key can reach the public half.
// The partition is EXHAUSTIVE + THREE-WAY (PUBLIC / SEALED / METADATA) + a derived temporal_tier;
// an unknown raw key is a hard throw so a new field can never silently default public.

'use strict';

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

// ── The three input field classes (disjoint, exhaustive over a raw record) ──
const PUBLIC_FIELDS = Object.freeze(['id', 'repo', 'base_sha', 'problem_statement']);
const SEALED_FIELDS = Object.freeze([
  'accepted_diff', 'fail_to_pass', 'pass_to_pass', 'test_patch', 'is_negative_control',
  'repo_familiarity', 'per_repo_test_strength', 'repo_review_strictness',
  'rubric_refs', 'review_thread_ref', 'criteria_only_rubric', 'contamination_tier',
]);
const METADATA_FIELDS = Object.freeze(['resolved_at', 'perturbation_of', 'difficulty_bucket', 'provenance']);
// Derived OUTPUTS — computed by W0, written to the manifest instance, FORBIDDEN on a raw input record.
const DERIVED_FIELDS = Object.freeze(['temporal_tier']);
const INPUT_FIELD_SET = new Set([...PUBLIC_FIELDS, ...SEALED_FIELDS, ...METADATA_FIELDS]);
const DERIVED_FIELD_SET = new Set(DERIVED_FIELDS);
const PUBLIC_FIELD_SET = new Set(PUBLIC_FIELDS);

// ── Constants ──
const NEG_CONTROL_SENTINEL = '__LOOM_NEG_CONTROL__';
const MODEL_CUTOFF = '2026-01-01T00:00:00.000Z'; // OQ-1: the cutoff is itself error-barred; conservative self-reported boundary.
const GREY_BAND_MS = 1000 * 60 * 60 * 24 * 180;   // a 180-day training-vs-reliable band before the cutoff.
const N_CLEAN_LARGE_MIN = 20;                      // TODO(OQ-4): the committed clean-tier large-change floor is a mid-phase source decision.

const ENUMS = Object.freeze({
  repo_familiarity: ['novel', 'familiar', 'unknown'],
  per_repo_test_strength: ['strong', 'weak', 'unknown'],
  repo_review_strictness: ['strict', 'standard', 'unknown'],
  difficulty_bucket: ['lt1hr', '1to4hr', 'gt4hr'],
  provenance: ['backtest'], // W0 reserves 'backtest' only; 'live' is the v3.10 verdict-record value (RFC §6).
});

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isPlainString(v) { return typeof v === 'string'; }
function isIso8601(v) { return isPlainString(v) && !Number.isNaN(Date.parse(v)) && /\d{4}-\d{2}-\d{2}T/.test(v); }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// WHITELIST-COPY: only the named string keys of each class cross over. Symbol keys, inherited keys,
// and any unlisted key are structurally excluded — never copied, never deleted-after-spread. An
// ACCESSOR (getter/setter) on a copied field is REJECTED (VALIDATE-hacker P10): a getter that returns
// an innocent value at validate-time and the oracle at split-time would otherwise leak past the
// boundary. A legitimate corpus record (JSON-sourced) carries only data properties.
function copyClass(raw, dst, fields) {
  for (const k of fields) {
    if (!hasOwn(raw, k)) continue;
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (d.get !== undefined || d.set !== undefined) throw new Error('accessor-property: ' + k + ' is a getter/setter, not a data field');
    dst[k] = raw[k];
  }
}
function splitRecord(raw) {
  const out = { public: {}, sealed: {}, metadata: {} };
  copyClass(raw, out.public, PUBLIC_FIELDS);
  copyClass(raw, out.sealed, SEALED_FIELDS);
  copyClass(raw, out.metadata, METADATA_FIELDS);
  return out;
}

// Axis-1 ONLY (temporal, deterministic) — the only tier W0 writes. The '-pending-probe' suffix signals
// the model-driven axes 2/4 may DEMOTE it in W2/W3, never promote.
function assignTemporalTier(resolvedAt) {
  if (typeof resolvedAt !== 'string') throw new Error('resolved_at: must be an ISO-8601 string'); // VALIDATE P11: a bare number Date.parse-coerces, fail-open on the exported primitive.
  const t = Date.parse(resolvedAt);
  if (Number.isNaN(t)) throw new Error('resolved_at: not ISO-8601: ' + resolvedAt);
  const cutoff = Date.parse(MODEL_CUTOFF);
  if (t > cutoff) return 'clean-pending-probe';
  if (t > cutoff - GREY_BAND_MS) return 'grey';
  return 'stale';
}

function validateEnum(raw, key) {
  if (!ENUMS[key].includes(raw[key])) {
    throw new Error(key + ': must be one of [' + ENUMS[key].join(', ') + '], got ' + JSON.stringify(raw[key]));
  }
}

function validateOne(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('record must be a plain object');

  // 1. unknown-field + accessor — string keys outside the input union, derived-output keys, any Symbol
  //    key, and any getter/setter (the P10 validate-vs-split divergence vector — rejected before any
  //    value is read, so a side-effecting getter never even fires).
  if (Object.getOwnPropertySymbols(raw).length > 0) throw new Error('unknown-field: a Symbol key is never a legitimate corpus field');
  for (const k of Object.getOwnPropertyNames(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (d.get !== undefined || d.set !== undefined) throw new Error('accessor-property: ' + k + ' is a getter/setter, not a data field');
    if (DERIVED_FIELD_SET.has(k)) throw new Error('unknown-field: ' + k + ' is a derived-output, not a raw-input key');
    if (!INPUT_FIELD_SET.has(k)) throw new Error('unknown-field: ' + k);
  }

  // 2. shape — required PUBLIC + METADATA, typed; enums; contamination_tier MUST be absent at W0.
  for (const k of PUBLIC_FIELDS) { if (!hasOwn(raw, k) || !isPlainString(raw[k]) || raw[k].length === 0) throw new Error(k + ': required non-empty string'); }
  if (!/^[0-9a-f]{40}$/.test(raw.base_sha)) throw new Error('base_sha: must be 40-hex lowercase');
  if (!isIso8601(raw.resolved_at)) throw new Error('resolved_at: must be ISO-8601');
  if (!(raw.perturbation_of === null || isPlainString(raw.perturbation_of))) throw new Error('perturbation_of: must be a string or null');
  validateEnum(raw, 'difficulty_bucket');
  validateEnum(raw, 'provenance');
  if (hasOwn(raw, 'contamination_tier')) throw new Error('contamination_tier: reserved-sealed, must be ABSENT at W0 (populated by W2/W3 demotion)');

  // sealed shape (validate the present ones)
  if (typeof raw.is_negative_control !== 'boolean') throw new Error('is_negative_control: must be boolean');
  if (!Array.isArray(raw.fail_to_pass)) throw new Error('fail_to_pass: must be an array');
  if (!Array.isArray(raw.pass_to_pass)) throw new Error('pass_to_pass: must be an array');
  for (const k of ['repo_familiarity', 'per_repo_test_strength', 'repo_review_strictness']) validateEnum(raw, k);
  for (const k of ['accepted_diff', 'test_patch', 'review_thread_ref']) { if (!isPlainString(raw[k])) throw new Error(k + ': must be a string'); }
  for (const k of ['rubric_refs', 'criteria_only_rubric']) { if (raw[k] === null || typeof raw[k] !== 'object' || Array.isArray(raw[k])) throw new Error(k + ': must be a plain object (not null/array)'); }

  // 3. oracle-leak (defense-in-depth TRIPWIRE — currently UNREACHABLE): the whitelist-copy splitRecord
  //    + step-2's required-non-empty-string guard already make pub == PUBLIC_FIELDS exactly, so this
  //    never fires today. It is RETAINED as a refactoring assertion: if splitRecord ever changes to a
  //    spread/delete, this catch fires before a leak ships. (The ACTIVE leak defense is the accessor
  //    rejection in step 1 + copyClass.)
  const { public: pub } = splitRecord(raw);
  if (Object.getOwnPropertySymbols(pub).length > 0) throw new Error('oracle-leak: a Symbol key reached the public output');
  const pubKeys = Object.keys(pub).sort();
  const want = [...PUBLIC_FIELDS].sort();
  if (pubKeys.length !== want.length || pubKeys.some((k, i) => k !== want[i])) {
    throw new Error('oracle-leak: public output key-set != PUBLIC_FIELDS (got [' + pubKeys.join(', ') + '])');
  }

  // 4. fail_to_pass conditional sentinel — EXACT-set, never .includes.
  const fp = raw.fail_to_pass;
  if (raw.is_negative_control === true) {
    const ok = fp.length === 0 || (fp.length === 1 && fp[0] === NEG_CONTROL_SENTINEL);
    if (!ok) throw new Error('negative-control: fail_to_pass must be [] or [SENTINEL] exactly');
  } else {
    if (fp.some((x) => x === NEG_CONTROL_SENTINEL)) throw new Error('negative-control sentinel present without is_negative_control');
    if (fp.length === 0) throw new Error('fail_to_pass: must be non-empty unless is_negative_control');
  }
}

function validateIssueCorpus(records) {
  if (!Array.isArray(records)) throw new Error('records: must be an array');
  for (const raw of records) validateOne(raw);
  return records.length;
}

// ③.2.2a (open/closed addition — does NOT touch validateOne / the SEALED boundary): the PUBLIC-ONLY
// record validator. A live OPEN issue has no sealed oracle (accepted_diff/fail_to_pass/test_patch), so
// the live puller produces a record carrying ONLY the four PUBLIC_FIELDS — which validateIssueCorpus
// structurally REJECTS (it is a full raw-record validator: it requires every SEALED+METADATA field and
// hard-throws on any key outside the input union). validatePublicRecord is the gate for that shape:
// EXACTLY the four PUBLIC_FIELDS (no extra key — a smuggled sealed field is rejected, not silently
// carried), each a non-empty string, base_sha a 40-hex commit. Mirrors validateOne's anti-leak
// discipline (Symbol + accessor rejection) so a getter/aliased key cannot slip the exact-shape check.
// Throws on any violation (the live puller's per-item loop drops on throw); returns true on success.
function validatePublicRecord(rec) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('public-record: must be a plain object');
  if (Object.getOwnPropertySymbols(rec).length > 0) throw new Error('public-record: a Symbol key is never a legitimate public field');
  for (const k of Object.getOwnPropertyNames(rec)) {
    const d = Object.getOwnPropertyDescriptor(rec, k);
    if (d.get !== undefined || d.set !== undefined) throw new Error('public-record: ' + k + ' is an accessor (getter/setter), not a data field');
    if (!PUBLIC_FIELD_SET.has(k)) throw new Error('public-record: unexpected field ' + k + ' (expected exactly PUBLIC_FIELDS)');
  }
  for (const k of PUBLIC_FIELDS) {
    if (!hasOwn(rec, k) || !isPlainString(rec[k]) || rec[k].length === 0) throw new Error('public-record: ' + k + ' required non-empty string');
  }
  if (!/^[0-9a-f]{40}$/.test(rec.base_sha)) throw new Error('public-record: base_sha must be 40-hex lowercase');
  return true;
}

function stripManifestHash(i) {
  const out = {};
  for (const k of Object.keys(i)) if (k !== 'manifest_hash') out[k] = i[k];
  return out;
}

// Order-independent by SORTING (id then base_sha) then canonicalizing the sorted array — never by
// object-keying on id (which would launder a duplicate and last-write-wins an id-collision).
function computeManifestHash(instances) {
  if (!Array.isArray(instances)) throw new Error('instances: must be an array');
  const seen = new Set();
  for (const i of instances) {
    // CodeRabbit #310: guard the entry is a plain object BEFORE reading i.id, so [null]/[undefined]/[42]
    // fail with a CONTROLLED contract error, not a raw TypeError (fail-closed discipline).
    if (i === null || typeof i !== 'object' || Array.isArray(i)) throw new Error('instance: must be a plain object');
    // VALIDATE P6d/P5a: a non-string id makes the comparator non-transitive (order-dependent hash) AND
    // a duplicate-by-object-ref slips Set.has — type-guard the forward-contract primitive.
    if (typeof i.id !== 'string' || i.id.length === 0) throw new Error('instance-id: must be a non-empty string');
    if (seen.has(i.id)) throw new Error('duplicate-instance-id: ' + i.id);
    seen.add(i.id);
  }
  const sorted = instances.map(stripManifestHash).sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return (a.base_sha || '') < (b.base_sha || '') ? -1 : 1;
  });
  try {
    return sha256hex(canonicalJsonSerialize(sorted));
  } catch (e) {
    throw new Error('manifest-uncomputable: ' + e.message); // fail-closed past the depth/node bound.
  }
}

// The two-part floor, REPORTED not ENFORCED (enforcement waits on OQ-4). Reads ONLY the committed
// difficulty_bucket — no diff-parse, no model. NEVER throws on VALIDATED raw records.
// @param records — validated RAW corpus records (carry resolved_at); NOT manifest instances.
function reportStratification(records) {
  let cleanLargeN = 0;
  let familiarLargeN = 0;
  for (const r of records) {
    if (r.difficulty_bucket === 'lt1hr') continue; // not a large change
    const tier = assignTemporalTier(r.resolved_at);
    if (tier !== 'clean-pending-probe') continue;   // only temporally-clean records count toward the floor
    if (r.repo_familiarity === 'novel') cleanLargeN++;
    else if (r.repo_familiarity === 'familiar') familiarLargeN++;
  }
  return {
    clean_large_n: cleanLargeN,
    familiar_large_n: familiarLargeN,
    insufficient_n: cleanLargeN < N_CLEAN_LARGE_MIN,
    n_clean_large_min: N_CLEAN_LARGE_MIN,
  };
}

module.exports = {
  splitRecord, validateIssueCorpus, validatePublicRecord, assignTemporalTier, computeManifestHash, reportStratification,
  PUBLIC_FIELDS, SEALED_FIELDS, METADATA_FIELDS, DERIVED_FIELDS,
  NEG_CONTROL_SENTINEL, MODEL_CUTOFF, N_CLEAN_LARGE_MIN, ENUMS,
};
