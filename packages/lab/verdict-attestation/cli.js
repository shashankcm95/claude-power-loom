#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 1 — verdict-attestation CLI: the dogfood vehicle + the entry point an orchestrator uses
// to record an advisory verdict's EMISSION ATTESTATION (evidence-linked to a kernel spawn-record via
// agentId), inspect the ledger, and run the enricher (resolve agentId→transaction_id). ADVISORY:
// every subcommand only records/reads/enriches/prunes the Lab-owned ledger; nothing here blocks.
//
// Subcommands:
//   record --verdict pass|partial|fail --subject-persona P --verifier-identity I
//          --verifier-kind K --agent-id A [--expires-after-days N]
//                                       record one verdict-emission attestation
//   record-review --subject-persona P --agent-id A --review "I|K|V" [--review ...]
//                 [--expires-after-days N] [--no-enrich]
//                                       batch-record one subject's verdicts from N verifiers
//                                       (e.g. a 3-lens review), then auto-enrich
//   enrich                               resolve unenriched records' agentId → kernel transaction_id
//   list                                 print live (non-expired) verdicts as JSON
//   prune                                drop expired records; print the count
//   stats                                summarize live verdicts (by persona / verdict / kind / enriched)
//
// Exit codes: 0 on success; 1 on usage / validation / IO error (a clean message, never a stack dump).

'use strict';

const {
  recordVerdict, listVerdicts, pruneExpired, VALID_VERDICTS, MAX_FIELD_LEN,
} = require('./store');
const { enrichLedger } = require('./enrich-from-spawn-state');

// record-review bounds (VALIDATE hacker M-2 + L-1): cap the batch so N× whole-ledger re-serializations
// can't be driven O(N²) (a real review is ≤ ~5 verifiers); cap the expiry so a typo can't make a record
// effectively immortal. Both are CLI-boundary guards on the advisory producer.
const MAX_REVIEWS_PER_BATCH = 64;
const MAX_EXPIRES_DAYS = 36500; // ~100 years — generous; bounds the L-1 absurd-magnitude/hex footgun

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

function tally(records, keyFn) {
  const out = {};
  for (const r of records) { const k = keyFn(r); out[k] = (out[k] || 0) + 1; }
  return out;
}

// ── record-review: a DEDICATED arg walk (parseArgs is last-wins → it CANNOT collect a repeatable
// flag; touching it would break every single-value caller). This walk collects EVERY --review
// occurrence into an array and reads the single-value flags + the boolean --no-enrich. Mirrors
// parseArgs' "--flag VALUE" / "--flag (bare→true)" convention so the surface is consistent.
function parseReviewArgs(argv) {
  const out = { reviews: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    if (key === 'review') {
      if (hasValue) { out.reviews.push(next); i += 1; }
      // a bare --review (no value) stays an invalid (non-3-part) triple → caught in validation
      else out.reviews.push('');
    } else if (hasValue) {
      out[key] = next; i += 1;
    } else {
      out[key] = true; // boolean flag (e.g. --no-enrich)
    }
  }
  return out;
}

// A bounded, non-empty scalar per the store's EXPORTED cap — the all-or-nothing pre-validation basis.
function isValidField(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_LEN;
}

// Parse the raw --expires-after-days string → a positive number, or undefined when absent (the store
// applies its default). Mirrors the `record` subcommand's NaN guard: Number('abc') is NaN and NaN
// silently survives the store's `typeof === 'number'` check, so reject it HERE with a clear message.
// Throws on a bad value (the dispatch maps the throw → a clean exit 1, before any write).
function parseExpiresAfterDays(raw) {
  if (raw === undefined || raw === true) return undefined; // absent / bare flag → store default
  // VALIDATE hacker L-1: decimal whole-number only (reject hex/exponent footguns like 0x10 / 1e9) +
  // a sane ceiling (an absurd magnitude would make a record effectively immortal).
  if (!/^\d+$/.test(String(raw))) {
    throw new Error('--expires-after-days must be a positive whole number of days');
  }
  const n = Number(raw);
  if (n <= 0 || n > MAX_EXPIRES_DAYS) {
    throw new Error(`--expires-after-days must be between 1 and ${MAX_EXPIRES_DAYS} days`);
  }
  return n;
}

// Parse + validate ONE "identity|kind|verdict" triple. Returns { identity, kind, verdict } or throws
// an Error naming the bad value (the caller maps the throw → a clean exit 1). EXACTLY 3 non-empty
// parts; verdict ∈ VALID_VERDICTS; each field bounded. Pipe is a safe delimiter — no legal
// identity/kind/verdict contains it.
function parseReviewTriple(raw) {
  const parts = String(raw).split('|');
  const allPartsPresent = parts.length === 3 && parts.every((p) => p.length > 0);
  if (!allPartsPresent) {
    throw new Error(`--review ${JSON.stringify(raw)} must be "identity|kind|verdict" — exactly 3 non-empty pipe-delimited parts`);
  }
  const [identity, kind, verdict] = parts;
  if (!isValidField(identity) || !isValidField(kind)) {
    throw new Error(`--review ${JSON.stringify(raw)}: identity and kind must each be 1..${MAX_FIELD_LEN} chars`);
  }
  if (!VALID_VERDICTS.includes(verdict)) {
    throw new Error(`--review ${JSON.stringify(raw)}: verdict must be ${VALID_VERDICTS.join('|')} (got ${JSON.stringify(verdict)})`);
  }
  return { identity, kind, verdict };
}

/**
 * Batch over record + enrich: record ONE subject persona's verdicts from many verifiers (a 3-lens
 * review), then auto-enrich (resolve agentId→transaction_id) unless disabled. ALL-OR-NOTHING FOR
 * VALIDATION: every triple + the subject/agentId are pre-validated against the store's exported
 * constants BEFORE any write, so an INVALID input persists nothing. (Not transactional: a rare
 * mid-batch store I/O throw is advisory + dedup-safe on re-run, not rolled back.) ADVISORY — nothing gates.
 *
 * @param {object} opts
 * @param {string} opts.subjectPersona  the JUDGED persona (reputation subject)
 * @param {string} opts.agentId         the SUBJECT spawn's agentId (the §0a.3.1 evidence-link)
 * @param {string[]} opts.reviews       raw "identity|kind|verdict" strings (≥1 required)
 * @param {number} [opts.expiresAfterDays]
 * @param {boolean} [opts.enrich=true]  run enrichLedger after recording
 * @returns {{recorded, deduped, skipped, enriched, unresolved, enrichError?}}  enriched/unresolved
 *          are null when enrich was skipped (--no-enrich) OR threw post-record; on a throw, enrichError
 *          holds the message (the caller prints the warning + still exits 0 — recording succeeded).
 * @throws  Error on ANY validation failure (empty/over-cap batch, bad subject/agentId, malformed
 *          triple) — thrown BEFORE the first write, so a validation failure leaves the ledger
 *          untouched (all-or-nothing for the validation class; a mid-batch store I/O throw is not
 *          rolled back — advisory + dedup-safe on re-run).
 */
function recordReviewBatch(opts) {
  const o = opts || {};
  if (!isValidField(o.subjectPersona)) {
    throw new Error(`--subject-persona is required and must be 1..${MAX_FIELD_LEN} chars`);
  }
  if (!isValidField(o.agentId)) {
    throw new Error(`--agent-id (the subject spawn's evidence-link) is required and must be 1..${MAX_FIELD_LEN} chars`);
  }
  const rawReviews = Array.isArray(o.reviews) ? o.reviews : [];
  if (rawReviews.length === 0) {
    throw new Error('at least one --review "identity|kind|verdict" is required');
  }
  if (rawReviews.length > MAX_REVIEWS_PER_BATCH) { // VALIDATE hacker M-2: bound the O(N²) batch cost
    throw new Error(`too many --review (${rawReviews.length}); max ${MAX_REVIEWS_PER_BATCH} per batch`);
  }
  // Pre-validate EVERY triple FIRST (all-or-nothing — any throw happens before the first write).
  const triples = rawReviews.map(parseReviewTriple);

  let recorded = 0;
  let deduped = 0;
  let skipped = 0; // VALIDATE code-reviewer LOW: a lock-contended {skipped} result is NOT persisted
  for (const t of triples) {
    const res = recordVerdict({
      verdict: t.verdict,
      subject: { persona: o.subjectPersona },
      verifier: { identity: t.identity, kind: t.kind },
      agentId: o.agentId,
      expiresAfterDays: o.expiresAfterDays,
    });
    if (res && res.deduped) deduped += 1;
    else if (res && res.skipped) skipped += 1; // lock-contended — never counted as recorded
    else recorded += 1;
  }

  if (o.enrich === false) return { recorded, deduped, skipped, enriched: null, unresolved: null };
  // Records already persisted (the load-bearing part). enrich is idempotent + re-runnable, so a
  // throw here is NON-FATAL: report it, but the batch succeeded. Catch HERE (the implementer owns
  // the enrich-failed semantics); the thin dispatch only formats the warning.
  try {
    const e = enrichLedger();
    return { recorded, deduped, skipped, enriched: e.enriched, unresolved: e.unresolved };
  } catch (err) {
    return {
      recorded, deduped, skipped, enriched: null, unresolved: null, enrichError: err.message,
    };
  }
}

// Present a recordReviewBatch summary: on a post-record enrich throw, warn (but exit 0 — recording
// is the load-bearing part + enrich is re-runnable); print the {recorded,deduped,enriched,unresolved}
// summary (the internal enrichError stays off the printed object — built explicitly, not stripped).
// Keeps the dispatch a thin router.
function emitReviewSummary(summary) {
  if (summary.enrichError) {
    process.stderr.write(`record-review: records persisted; enrich failed: ${summary.enrichError}; run \`enrich\` to resolve links\n`);
  }
  const out = {
    recorded: summary.recorded,
    deduped: summary.deduped,
    skipped: summary.skipped,
    enriched: summary.enriched,
    unresolved: summary.unresolved,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

const USAGE = 'Usage: cli.js <record --verdict V --subject-persona P --verifier-identity I --verifier-kind K --agent-id A [--expires-after-days N] | record-review --subject-persona P --agent-id A --review "I|K|V" [--review ...] [--expires-after-days N] [--no-enrich] | enrich | list | prune | stats>\n';

function main(argv) {
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (cmd === 'record') {
    // Validate --expires-after-days up front: Number('abc') is NaN, and NaN silently falls back to
    // the default inside the store (typeof NaN === 'number'), so a typo would be swallowed.
    let expiresAfterDays;
    if (args['expires-after-days'] !== undefined) {
      expiresAfterDays = Number(args['expires-after-days']);
      if (!Number.isFinite(expiresAfterDays) || expiresAfterDays <= 0) {
        process.stderr.write('verdict-attestation: --expires-after-days must be a positive number\n');
        process.exit(1);
        return;
      }
    }
    let rec;
    try {
      rec = recordVerdict({
        verdict: args.verdict,
        subject: { persona: args['subject-persona'] },
        verifier: { identity: args['verifier-identity'], kind: args['verifier-kind'] },
        agentId: args['agent-id'],
        expiresAfterDays,
      });
    } catch (e) {
      // Validation failure (bad verdict / missing agentId / verifier / subject) — a clean error.
      process.stderr.write(`verdict-attestation: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
    process.exit(0);
  }

  if (cmd === 'record-review') {
    const a = parseReviewArgs(argv.slice(1));
    try {
      const summary = recordReviewBatch({
        subjectPersona: a['subject-persona'],
        agentId: a['agent-id'],
        reviews: a.reviews,
        expiresAfterDays: parseExpiresAfterDays(a['expires-after-days']),
        enrich: a['no-enrich'] !== true,
      });
      emitReviewSummary(summary);
    } catch (e) {
      process.stderr.write(`record-review: ${e.message}\n`); // usage/validation/record fail → exit 1
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'enrich') {
    // enrich READS spawn-state + WRITES the ledger (store.enrichRecord) — a disk error must surface
    // as a clean exit 1, not a raw stack dump.
    try {
      process.stdout.write(`${JSON.stringify(enrichLedger(), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: enrich failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'list') {
    // list READS only (readLedger swallows IO), but JSON.stringify of a manually-corrupted ledger
    // could throw — surface it as a clean exit 1, not a stack dump.
    try {
      process.stdout.write(`${JSON.stringify(listVerdicts(), null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: list failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'prune') {
    try {
      process.stdout.write(`${JSON.stringify({ pruned: pruneExpired() }, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: prune failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  if (cmd === 'stats') {
    try {
      const live = listVerdicts();
      process.stdout.write(`${JSON.stringify({
        live: live.length,
        enriched: live.filter((r) => r.evidence_refs && r.evidence_refs.transaction_id).length,
        unenriched: live.filter((r) => !r.evidence_refs || !r.evidence_refs.transaction_id).length,
        by_subject_persona: tally(live, (r) => (r.subject && r.subject.persona) || 'unknown'),
        by_verdict: tally(live, (r) => r.verdict || 'unknown'),
        by_verifier_kind: tally(live, (r) => (r.verifier && r.verifier.kind) || 'unknown'),
      }, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`verdict-attestation: stats failed: ${e.message}\n`);
      process.exit(1);
      return;
    }
    process.exit(0);
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  main, parseArgs, parseReviewArgs, parseReviewTriple, recordReviewBatch,
};
