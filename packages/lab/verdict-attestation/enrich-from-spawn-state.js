#!/usr/bin/env node

// @loom-layer: lab
//
// v3.4 Wave 1 — the verdict-attestation ENRICHER. Resolves a stored verdict record's orchestrator-
// formed `agentId` → the kernel spawn-record's content-addressed `transaction_id`, by reading the
// kernel's spawn-state JOURNAL as a DATA FILE (the E1 pull pattern — Lab PULLS, nothing pushes in).
// It is the in-wave CONSUMER that closes the shadow loop: a verdict's claimed link (agentId) becomes
// a RESOLVABLE link (transaction_id). The resolution logic is CI-verified against the frozen journal
// contract via a fixture journal; resolution of a LIVE kernel-produced journal is dogfood-verified
// (not CI), and the kernel-side F4 canary guards the line shape both depend on.
//
// Layer discipline (K12, by PATH): `lab`. Imports kernel/_lib/path-canonicalize (the C1 guard —
// lab→kernel, legal) + the sibling ./store. It reads spawn-state by PATH ONLY — it require()s NO
// kernel STATE module (no spawn-state/*, no record-store, no transaction-record); store.test's +
// this test's containment scans enforce that. store.enrichRecord performs the ledger mutation (this
// module never writes the ledger directly), keeping the store the single ledger owner.
//
// ── FROZEN DATA CONTRACT (F4) — the kernel facts this enricher depends on. A kernel change to ANY of
//    these silently breaks the link UNLESS the canary test (tests/unit/kernel/.../resolver-journal-
//    contract) fails loudly. Each cites the producer line in packages/kernel/hooks/post/
//    spawn-close-resolver.js (read firsthand 2026-06-04):
//      1. base dir   = LOOM_SPAWN_STATE_DIR || ~/.claude/spawn-state            (resolver.js:85)
//      2. run subdir = sha256(session_id).slice(0,16)  [NOT orchestrator-derivable — rotates at
//                      compaction; we discover it by globbing, never compute it]  (resolver.js:153-179)
//      3. journal    = <base>/<runId>/resolver-journal-<agentId>.jsonl           (resolver.js:203-205)
//      4. link line  = { kind:'shadow-provenance-record', spawn_id:<agentId>, transaction_id:<txid>,
//                        record_appended, deduped }  — one JSON object per line   (resolver.js:522-541)
//    The journal is append-only + multi-line per spawn (verdict / provenance-record / -skipped /
//    -error kinds); ONLY `shadow-provenance-record` carries the link. We take the LAST such line.

'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { isSafePathSegment } = require('../../kernel/_lib/path-canonicalize');
const store = require('./store');

// Resolved ONCE at module-load (ENV-BEFORE-REQUIRE; tests set LOOM_SPAWN_STATE_DIR first). Mirrors
// the kernel's own resolution (spawn-close-resolver.js:85, record-store.js:77) — the frozen contract #1.
const SPAWN_STATE_BASE = process.env.LOOM_SPAWN_STATE_DIR || path.join(os.homedir(), '.claude', 'spawn-state');

const PROVENANCE_KIND = 'shadow-provenance-record';
// VALIDATE hacker M1 — a journal is attacker-influenceable (same-UID write to spawn-state; the worktree
// is not a sandbox — OQ-21/p-writescope). A legit journal is a handful of lines (~KB); cap the read so
// a planted 100MB+ file can't drive a 600MB+ RSS DoS / record-suppression (proven). Oversized → skip
// (fail-soft; the link just stays unresolved — advisory).
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

// Map the journal record-append flags → a coarse status the verdict record carries (LOW-6: a
// dedup-after-crash has record_appended:false but a VALID transaction_id pointing at the prior record).
function recordStatusOf(line) {
  if (line.record_appended === true) return 'appended';
  if (line.deduped === true) return 'deduped';
  return 'not-appended';
}

/**
 * Resolve an agentId → its kernel spawn-record link by reading the spawn-state journal.
 *
 * @param {string} agentId  the orchestrator-formed harness id (== kernel record writer_spawn_id)
 * @returns {{agentId, runId, transactionId, recordStatus, collision?}|null}
 *          null when no `shadow-provenance-record` line exists for the agentId (read-only /
 *          non-completed / uncloseable spawn — no committed work-record to link).
 * @throws  if agentId is not a safe path segment (defense-in-depth; the #215/C1 trap-class)
 */
function resolveKernelRecord(agentId) {
  // Guard the RAW segment PRE-join — a stored record's agent_id is validated non-empty at record
  // time but NOT path-validated, so the enricher self-defends (the #215 class: path.join collapses
  // '..' before any post-join check could see it).
  if (!isSafePathSegment(agentId)) {
    throw new Error(`resolveKernelRecord: agentId ${JSON.stringify(agentId)} is not a safe path segment — no separators or '..' allowed`);
  }
  let runDirs;
  try {
    // withFileTypes so we can drop non-dirs + symlinked dirs (VALIDATE hacker M3 + code-reviewer
    // MEDIUM): a Dirent for a symlink has isDirectory()===false, so the filter excludes symlinked
    // run-dirs by construction; a plain file masquerading as a run subdir is also dropped.
    runDirs = fs.readdirSync(SPAWN_STATE_BASE, { withFileTypes: true });
  } catch {
    return null; // base dir absent/unreadable → nothing to resolve (fail-soft)
  }
  const journalName = `resolver-journal-${agentId}.jsonl`;
  const hits = [];
  for (const d of runDirs) {
    if (!d.isDirectory()) continue; // skip files + symlinked dirs (M3)
    const journalPath = path.join(SPAWN_STATE_BASE, d.name, journalName);
    let st;
    try {
      st = fs.lstatSync(journalPath); // lstat, NOT stat — so a symlinked journal is detected
    } catch {
      continue; // ENOENT (no journal in this run) etc → skip
    }
    if (st.isSymbolicLink()) continue;        // M3: never follow a symlinked journal (link-confusion)
    if (!st.isFile()) continue;               // not a regular file → skip
    if (st.size > MAX_JOURNAL_BYTES) continue; // M1: oversized → skip (DoS guard; advisory fail-soft)
    hits.push({ runId: d.name, journalPath });
  }
  if (hits.length === 0) return null;
  // agentId is ~2^68 globally unique — a 2-hit is near-impossible. Sort for a DETERMINISTIC pick
  // (not raw readdir order — M3 collision-steering), flag it, and let enrichLedger REFUSE to persist
  // an ambiguous link (an ambiguous link is no link — the safe advisory default).
  hits.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const collision = hits.length > 1;
  const hit = hits[0];

  let raw;
  try {
    raw = fs.readFileSync(hit.journalPath, 'utf8');
  } catch {
    return null; // journal vanished between lstat + read (fail-soft)
  }
  // Parse JSONL fail-soft; keep ONLY provenance-record lines that actually carry a transaction_id;
  // the LAST one is the most recent resolution (F2/HIGH-2 — the journal is append-only multi-line).
  const provLines = raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((o) => o && o.kind === PROVENANCE_KIND && typeof o.transaction_id === 'string' && o.transaction_id.length > 0);
  if (provLines.length === 0) return null; // verdict-only / skipped / error journal → no committed link
  const last = provLines[provLines.length - 1];

  const result = { agentId, runId: hit.runId, transactionId: last.transaction_id, recordStatus: recordStatusOf(last) };
  if (collision) result.collision = true;
  return result;
}

/**
 * Enrich every unenriched (transaction_id == null) LIVE verdict record whose agentId resolves to a
 * kernel record. ADVISORY pull pass — resolves ALL records OUTSIDE the lock (fs reads), then persists
 * the whole batch in ONE locked write via store.enrichRecords (VALIDATE code-reviewer MEDIUM — O(ledger),
 * not O(records × ledger)). Fail-soft per record (an unsafe agentId / missing journal / ambiguous
 * collision is skipped, never fatal). @returns {{enriched, unresolved, skipped}}
 */
function enrichLedger(opts) {
  const o = opts || {};
  const unenriched = store
    .listVerdicts({ now: o.now })
    .filter((r) => r.evidence_refs && r.evidence_refs.transaction_id == null);
  const updates = [];
  let unresolved = 0;
  let skipped = 0;
  for (const rec of unenriched) {
    let resolved;
    try {
      resolved = resolveKernelRecord(rec.evidence_refs.agent_id);
    } catch {
      skipped += 1; // unsafe agent_id — leave it unenriched, keep going
      continue;
    }
    if (!resolved) { unresolved += 1; continue; }
    if (resolved.collision) { skipped += 1; continue; } // M3: ambiguous link = no link — refuse to persist
    updates.push({
      attestationId: rec.attestation_id,
      runId: resolved.runId,
      transactionId: resolved.transactionId,
      recordStatus: resolved.recordStatus,
    });
  }
  const res = store.enrichRecords(updates); // one locked read-modify-write for the whole batch
  return { enriched: res.enriched, unresolved: unresolved + res.notFound, skipped: skipped + res.skipped };
}

module.exports = { resolveKernelRecord, enrichLedger, SPAWN_STATE_BASE, MAX_JOURNAL_BYTES };
