'use strict';

// packages/kernel/_lib/k9-journal.js
//
// K9 — append-only reverse-cherrypick journal (v3.0-alpha, PR 3).
//
// One of the 3 mandatory-split K9 modules (plan line 138). SRP role = DURABLE
// AUDIT. DAG leaf: MUST NOT import k9-promote-deltas (no back-edge).
//
// v6 spec anchor: §"reverse-cherrypick journal format + recovery algorithm are
// v3.0-alpha implementation deliverables (not specified at blueprint level)"
// (v6 line 1402). This module IS that deliverable. INV-19-WALAppendOnly governs
// it: the journal is append-only — entries are never mutated or deleted in
// place; undo is a forward `git revert <promoted_sha>` replayed from the ledger,
// NOT a rewrite of history.
//
// Durability primitive: writeAtomicString from _lib/atomic-write.js (symlink-safe
// tmp+rename, cleanup-on-error) — the same atomic discipline the WAL uses (F15).
// Append is realized as read-existing + concat + atomic-rewrite so a reader never
// observes a half-written journal (a crash mid-append leaves the prior file
// intact) AND prior bytes are preserved exactly (INV-19 byte-prefix invariant).
// Serialization through JSON.stringify per record (F13 ordering: never string
// concatenation of untrusted fields into the JSONL).

const fs = require('fs');
const crypto = require('crypto');
const { writeAtomicString } = require('./atomic-write');

const JOURNAL_SCHEMA_VERSION = 'k9-journal-v1';

// A git object name is 40 (sha1) or 64 (sha256) lowercase hex chars. The journal
// is a DAG leaf and MUST NOT import k9-path-guard (no back-edge —
// kb:architecture/crosscut/acyclic-dependencies), so the one-line pattern is
// duplicated here DELIBERATELY: a security boundary must validate locally, not
// depend on the orchestrator having run admitPromoteRequest first (defense-in-
// depth — boundary validation must not be call-order-dependent). Without it, a
// caller invoking buildJournalEntry directly with promoted_sha = '; rm -rf /'
// would mint reverse_op = 'git revert ; rm -rf /' — a shell-injection payload
// stored at rest in the undo ledger PR 4's recovery-sweep replays.
const PROMOTED_SHA_PATTERN = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

// Outcome enum for a journal entry.
const JOURNAL_OUTCOMES = Object.freeze(['PROMOTED', 'ABORTED', 'NOOP_ALREADY_PRESENT']);

// The append-only reverse-cherrypick journal record shape. Every field is
// REQUIRED unless marked optional. This is the canonical undo ledger: given a
// PROMOTED entry, `git revert <promoted_sha>` in <worktree_root> reverses it.
const JOURNAL_REQUIRED_FIELDS = Object.freeze([
  'schema_version',
  'entry_id',
  'promoted_sha',
  'pre_state_hash',
  'worktree_root',
  'outcome',
  'timestamp_iso',
]);

/**
 * Deterministic content hash of an entry MINUS its own entry_id field, so the
 * id is a stable function of the recorded facts (and self-referential inclusion
 * is impossible). Sorted-key JSON keeps the hash stable across key ordering.
 *
 * @param {object} entryWithoutId
 * @returns {string} 64-char lowercase hex sha256
 */
function computeEntryId(entryWithoutId) {
  const sortedKeys = Object.keys(entryWithoutId).sort();
  const canonical = JSON.stringify(entryWithoutId, sortedKeys);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Build (but do not write) a journal entry from the promote outcome. Pure —
 * computes entry_id as a content hash and fills derived fields. Lets tests
 * assert the schema without touching the filesystem.
 *
 * reverse_op is present ONLY for a PROMOTED outcome (`git revert <sha>`); for
 * ABORTED / NOOP_ALREADY_PRESENT there is nothing to reverse, so it is null.
 *
 * @param {object} fields  promote-outcome fields (see schema in JOURNAL_REQUIRED_FIELDS)
 * @returns {object} a complete journal entry
 */
function buildJournalEntry(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('K9 buildJournalEntry: fields object is required');
  }
  const outcome = fields.outcome;
  const promotedSha = fields.promoted_sha;
  const isPromoted = outcome === 'PROMOTED';
  // Fail-closed SHA-shape guard (security PRINCIPLE/LOW): promoted_sha is
  // interpolated into reverse_op for a PROMOTED entry and stored at rest for
  // every entry. Reject a non-hex / shell-metachar SHA HERE so the undo ledger
  // can never encode an injection payload regardless of call path (the
  // orchestrator already gates via admitPromoteRequest, but a direct caller of
  // this exported function must not be able to bypass it).
  if (typeof promotedSha !== 'string' || !PROMOTED_SHA_PATTERN.test(promotedSha)) {
    throw new Error('K9 buildJournalEntry: promoted_sha must be 40- or 64-char lowercase hex');
  }
  const entryWithoutId = {
    schema_version: JOURNAL_SCHEMA_VERSION,
    promoted_sha: promotedSha,
    pre_state_hash: fields.pre_state_hash,
    post_state_hash: isPromoted ? (fields.post_state_hash || null) : null,
    worktree_root: fields.worktree_root,
    outcome,
    reverse_op: isPromoted ? ('git revert ' + promotedSha) : null,
    abort_reason: outcome === 'ABORTED' ? (fields.abort_reason || null) : null,
    timestamp_iso: fields.timestamp_iso || new Date().toISOString(),
  };
  return { entry_id: computeEntryId(entryWithoutId), ...entryWithoutId };
}

/**
 * Validate a journal entry against the required-field set + outcome enum +
 * reverse_op consistency (reverse_op present iff outcome === 'PROMOTED').
 *
 * @param {object} entry
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateJournalEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['entry must be a non-null object'] };
  }
  for (const field of JOURNAL_REQUIRED_FIELDS) {
    if (!(field in entry) || entry[field] === null || entry[field] === undefined) {
      errors.push('missing required field: ' + field);
    }
  }
  if (!JOURNAL_OUTCOMES.includes(entry.outcome)) {
    errors.push('invalid outcome: ' + String(entry.outcome));
  }
  if (entry.schema_version !== JOURNAL_SCHEMA_VERSION) {
    errors.push('schema_version must be ' + JOURNAL_SCHEMA_VERSION);
  }
  // reverse_op present IFF outcome is PROMOTED.
  const hasReverseOp = entry.reverse_op !== null && entry.reverse_op !== undefined;
  if (entry.outcome === 'PROMOTED' && !hasReverseOp) {
    errors.push('PROMOTED entry must carry a reverse_op');
  }
  if (entry.outcome !== 'PROMOTED' && hasReverseOp) {
    errors.push('reverse_op must be present only for a PROMOTED outcome');
  }
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

/**
 * Append one entry to the append-only journal at journalPath. INV-19: existing
 * bytes are never rewritten; the entry is JSON.stringify'd onto a new line.
 * Durable via the atomic tmp+rename primitive (read-existing + concat + rewrite).
 *
 * @param {string} journalPath
 * @param {object} entry
 * @returns {{appended: boolean, lineCount: number}}
 */
function appendJournalEntry(journalPath, entry) {
  if (typeof journalPath !== 'string' || journalPath.length === 0) {
    throw new Error('K9 appendJournalEntry: journalPath is required');
  }
  const validation = validateJournalEntry(entry);
  if (!validation.valid) {
    throw new Error('K9 appendJournalEntry: invalid entry — ' + validation.errors.join('; '));
  }
  let prior = '';
  try {
    prior = fs.readFileSync(journalPath, 'utf8');
  } catch {
    prior = ''; // first write — file does not exist yet
  }
  // Guard the INV-19 byte-prefix invariant: if a prior crash left an
  // un-terminated tail, normalize to a newline boundary before appending so the
  // new entry is a clean line (the torn fragment is preserved as bytes but the
  // append never splices INTO it).
  const base = prior.length > 0 && !prior.endsWith('\n') ? prior + '\n' : prior;
  const next = base + JSON.stringify(entry) + '\n';
  writeAtomicString(journalPath, next);
  const lineCount = next.length === 0 ? 0 : next.split('\n').filter((l) => l.length > 0).length;
  return { appended: true, lineCount };
}

/**
 * Read all journal entries (parsed). Tolerates a torn final line (crash mid
 * append) by discarding an un-terminated / unparseable tail rather than throwing.
 *
 * @param {string} journalPath
 * @returns {object[]}
 */
function readJournal(journalPath) {
  let raw;
  try {
    raw = fs.readFileSync(journalPath, 'utf8');
  } catch {
    return []; // no journal yet
  }
  if (raw.length === 0) return [];
  const lines = raw.split('\n');
  // A correctly-appended journal ends with '\n', so the final split element is
  // ''. If the file does NOT end with '\n', the last element is a torn tail
  // (crash mid-append) — drop it. Any line that fails to parse is likewise
  // discarded (defense-in-depth; never throws).
  const lastIsTorn = !raw.endsWith('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const isLastNonEmpty = i === lines.length - 1;
    if (isLastNonEmpty && lastIsTorn) continue; // discard the torn tail
    try {
      entries.push(JSON.parse(line));
    } catch {
      // unparseable line — skip (torn/corrupt); do not abort the read
    }
  }
  return entries;
}

module.exports = {
  buildJournalEntry,
  validateJournalEntry,
  appendJournalEntry,
  readJournal,
  JOURNAL_SCHEMA_VERSION,
  JOURNAL_OUTCOMES,
  JOURNAL_REQUIRED_FIELDS,
};
