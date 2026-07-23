#!/usr/bin/env node

// @loom-layer: lab
//
// Wave A / item-8 Part-A - the PURE fold + transition-legality + boundary VALIDATION for the solve-queue
// lifecycle store. NO I/O, NO kernel imports: the closed state enum, the legal-transition table, the field
// validators (owned HERE so the store and the fold share ONE definition - DRY), and the fold that replays
// an entry's events (in LINE ORDER, the authoritative sequence) into its current state + a PER-FIELD-
// accumulated evidence blob. Kept separate from solve-queue-store.js (I/O + lock) per SRP.
//
// verify-on-read (store-is-not-a-sandbox, #273): the fold TREATS THE LOG AS HOSTILE INPUT. It re-validates
// every event's field CONTENT (not just the transition enum): a bad repo/issue_ref SKIPS the event (the
// entry never surfaces from a tampered identity); a malformed evidence field is DROPPED (never copied into
// the folded evidence). So `list`/`get`/`claimNext` can never surface a `../`-bearing repo, an out-of-bounds
// issue_ref, or a mistyped candidate_patch_sha (the Wave-B join key) from a hand-tampered log.
//
// SHADOW / weight-inert: the queue gates NOTHING and MUST NEVER become a weight/trust input. Ordering is
// LINE ORDER, never the audit-only `ts`.

'use strict';

// The closed lifecycle enum. `minted` is terminal; `disposed` is re-openable (retry).
const STATES = Object.freeze(['queued', 'solving', 'drafted', 'in_flight', 'merged', 'minted', 'disposed']);

const LEGAL = Object.freeze({
  queued: Object.freeze(['solving', 'disposed']),
  solving: Object.freeze(['drafted', 'disposed']),
  drafted: Object.freeze(['in_flight', 'disposed']),
  in_flight: Object.freeze(['merged', 'disposed']),
  merged: Object.freeze(['minted', 'disposed']),
  minted: Object.freeze([]),
  disposed: Object.freeze(['queued']),
});

// candidate_patch_sha is the Wave-B join key (resolveCapturedSignatureForAttest joins on it) - carried, NOT
// a generic ref. persona is a plain advisory label in Wave A (Wave C decides the non-identity-pin form).
const EVIDENCE_FIELDS = Object.freeze([
  'persona', 'candidate_patch_sha', 'lesson_signature', 'pr_url', 'pr_number', 'merge_sha', 'reason',
]);

const GH_REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;      // owner/repo (repoSlug-normalized form)
const HEX64 = /^[0-9a-f]{64}$/;
const MAX = Object.freeze({ repo: 256, issue_ref: 1e9, pr_url: 2048, pr_number: 1e9, persona: 128, lesson_signature: 512, merge_sha: 64, reason: 256 });

// GitHub owner/repo never contains `..`; reject it explicitly (defense-in-depth vs the #215 raw-segment
// trap, even though entry_id is hash-derived so no path segment ever reaches the filesystem).
function validRepo(repo) { return typeof repo === 'string' && repo.length <= MAX.repo && GH_REPO_SLUG_RE.test(repo) && !repo.includes('..'); }
function validIssueRef(n) { return Number.isInteger(n) && n >= 1 && n <= MAX.issue_ref; }

// One evidence field well-shaped? (absent is fine - callers only set what a transition produces.)
function validEvidenceField(k, v) {
  if (!EVIDENCE_FIELDS.includes(k)) return false;
  if (k === 'candidate_patch_sha') return typeof v === 'string' && HEX64.test(v);
  if (k === 'pr_number') return Number.isInteger(v) && v >= 1 && v <= MAX.pr_number;
  return typeof v === 'string' && v.length >= 1 && v.length <= MAX[k];
}

// Whole-evidence validator (write boundary). Returns a bad-field token or null.
function badEvidence(evidence) {
  if (evidence === undefined) return null;
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return 'evidence-not-object';
  for (const k of Object.keys(evidence)) {
    if (!EVIDENCE_FIELDS.includes(k)) return `unknown-field:${k}`;
    if (!validEvidenceField(k, evidence[k])) return `bad-${k}`;
  }
  return null;
}

/**
 * Is `from -> to` a legal lifecycle transition? `from === null|undefined` (no prior events) admits only
 * `-> queued`.
 */
function isLegalTransition(from, to) {
  if (!STATES.includes(to)) return false;
  if (from === null || from === undefined) return to === 'queued';
  const allowed = LEGAL[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Fold one entry's events (already filtered to a single entry_id, in LINE ORDER) into its current state.
 * Defensive + forward-compatible + verify-on-read: SKIPS a malformed event, an unknown `to_state`, an
 * illegal in-sequence transition, OR an event whose repo/issue_ref is invalid (identity is set only from a
 * CONTENT-VALID event). Evidence accumulates per-field but is RESET on a `-> queued` (re-open), so a stale
 * `reason`/`pr_url` from a failed attempt never leaks onto a later successful run. A malformed evidence
 * field is dropped. Returns `{ entry_id, repo, issue_ref, state, evidence, updated_at, rev }` or null.
 *
 * `updated_at` = the `ts` of the LAST ACCEPTED event (audit-only: the dispose-on-failure sweep reads it to
 * decide STALENESS). It reflects ONLY the last accepted event's `ts` - a non-finite/missing ts leaves it
 * `undefined` (the sweep then skips the entry, fail-SAFE: an entry whose latest event has a corrupt ts must
 * NOT look staler than it is via an older prior ts). It is NEVER an ordering/sort key (the fold's load-
 * bearing invariant is LINE ORDER; claimNext orders by the queued line index, not this) and NEVER folded
 * into a content-addressed identity (a wall-clock ts in a content_hash is the retry-collision class
 * merge-promote.js warns of - consumers pass explicit fields, never the whole entry).
 *
 * `rev` = the COUNT of accepted events (a strictly-monotonic, clock-INDEPENDENT version token). It is the
 * compare-and-swap key for the dispose-sweep: unlike `updated_at`, it changes on EVERY accepted transition
 * even within the same wall-clock millisecond, so a `solving -> disposed -> queued -> solving` cycle can
 * never present a stale snapshot as current (the ms-collision the ts-based CAS was vulnerable to).
 * @param {Array<object>} events
 * @returns {{entry_id: string, repo: string, issue_ref: number, state: string, evidence: object, updated_at: number|undefined, rev: number} | null}
 */
function foldEntry(events) {
  if (!Array.isArray(events)) return null;
  let state = null;
  let entry_id = null;
  let repo = null;
  let issue_ref = null;
  let evidence = {};
  let updated_at;                                                 // audit-only: ts of the last ACCEPTED event
  let rev = 0;                                                    // monotonic count of accepted events (CAS version)
  for (const evt of events) {
    if (!evt || typeof evt !== 'object' || Array.isArray(evt)) continue;
    if (!STATES.includes(evt.to_state)) continue;                 // unknown to_state -> skip (forward-compat)
    if (!isLegalTransition(state, evt.to_state)) continue;        // illegal in-sequence -> skip (defensive)
    if (state === null && !(validRepo(evt.repo) && validIssueRef(evt.issue_ref))) continue; // bad identity -> skip (H1)
    state = evt.to_state;
    rev += 1;                                                     // one more accepted transition
    if (entry_id === null) { entry_id = evt.entry_id; repo = evt.repo; issue_ref = evt.issue_ref; }
    updated_at = (typeof evt.ts === 'number' && Number.isFinite(evt.ts)) ? evt.ts : undefined; // last-event ts (fail-safe)
    if (evt.to_state === 'queued') evidence = {};                 // re-open resets transient evidence
    if (evt.evidence && typeof evt.evidence === 'object' && !Array.isArray(evt.evidence)) {
      for (const f of EVIDENCE_FIELDS) {
        if (validEvidenceField(f, evt.evidence[f])) evidence[f] = evt.evidence[f]; // drop a malformed field (H1)
      }
    }
  }
  if (state === null) return null;
  return { entry_id, repo, issue_ref, state, evidence, updated_at, rev };
}

module.exports = {
  STATES, LEGAL, EVIDENCE_FIELDS, MAX, HEX64,
  validRepo, validIssueRef, validEvidenceField, badEvidence, isLegalTransition, foldEntry,
};
