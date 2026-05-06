#!/usr/bin/env node
/**
 * H.7.0-prep — quality-factors-backfill.js
 *
 * One-shot, idempotent backfill: reconstructs `quality_factors_history`
 * for existing identities from spawn-recorder JSONL (`~/.claude/spawn-history.jsonl`).
 *
 * Why this exists: H.7.0-prep added `quality_factors_history` to the
 * identity schema. Existing identities have prior verdicts but no history
 * entries. The H.6.x cycle's spawn-recorder data has rich `extras` JSON
 * with the same axes — best-effort reconstruction preserves that signal.
 *
 * Behavior:
 *   - Reads ~/.claude/spawn-history.jsonl (read-only)
 *   - For each identity in ~/.claude/agent-identities.json:
 *     - If `quality_factors_history.length > 0`: SKIP (don't double-backfill)
 *     - Else: synthesize entries from spawn-recorder rows where verdict !== null
 *   - Idempotent — safe to re-run
 *
 * Usage:
 *   node scripts/agent-team/quality-factors-backfill.js [--dry-run]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_PATH = process.env.HETS_IDENTITY_STORE
  || path.join(os.homedir(), '.claude', 'agent-identities.json');
const SPAWN_HISTORY = path.join(os.homedir(), '.claude', 'spawn-history.jsonl');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    console.error(`No identity store at ${STORE_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function readSpawnHistory() {
  if (!fs.existsSync(SPAWN_HISTORY)) {
    console.error(`No spawn history at ${SPAWN_HISTORY} — nothing to backfill from`);
    process.exit(0);
  }
  const lines = fs.readFileSync(SPAWN_HISTORY, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return rows;
}

// Convert one spawn-history row into a quality-factors-history entry, or
// return null if this row doesn't have a recorded verdict (e.g., a "test
// started" row preceding the COMPLETED row).
function rowToEntry(row) {
  if (!row.verdict || !['pass', 'partial', 'fail'].includes(row.verdict)) return null;
  // The H.6.x cycle put rich data in `extras` (JSON object) — extract.
  const extras = row.extras || {};
  const findingsCount = (typeof extras.findings_count === 'number') ? extras.findings_count : null;
  const fileCitations = (typeof extras.file_citations === 'number') ? extras.file_citations : null;
  const tokens = (typeof row.tokens === 'number') ? row.tokens : null;
  // Cap-request actionability isn't directly recorded in spawn-recorder rows,
  // so leave it null for backfill (forward verdicts will populate).
  return {
    ts: row.ts || row.recorded_at || new Date().toISOString(),
    verdict: row.verdict,
    task_signature: row.task || null,
    findings_per_10k: (tokens && tokens > 0 && findingsCount) ? (findingsCount / (tokens / 10000)) : null,
    file_citations_per_finding: (fileCitations !== null && findingsCount && findingsCount > 0) ? (fileCitations / findingsCount) : null,
    cap_request_actionability: null,  // not captured in legacy data
    kb_provenance_verified: null,     // not captured in legacy data
    tokens: tokens,
  };
}

function main() {
  const store = readStore();
  const rows = readSpawnHistory();

  // Index spawn-history rows by identity, sorted oldest-first.
  const byIdentity = new Map();
  for (const row of rows) {
    if (!row.identity) continue;
    if (!byIdentity.has(row.identity)) byIdentity.set(row.identity, []);
    byIdentity.get(row.identity).push(row);
  }
  for (const arr of byIdentity.values()) {
    arr.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  }

  const summary = { backfilled: 0, skipped: 0, untouched: 0, perIdentity: {} };
  for (const [identityId, identity] of Object.entries(store.identities)) {
    if (!Array.isArray(identity.quality_factors_history)) {
      identity.quality_factors_history = [];
    }
    if (identity.quality_factors_history.length > 0) {
      summary.skipped += 1;
      summary.perIdentity[identityId] = { action: 'skipped (already has history)', existing: identity.quality_factors_history.length };
      continue;
    }
    const rowsForId = byIdentity.get(identityId) || [];
    const entries = [];
    for (const row of rowsForId) {
      const entry = rowToEntry(row);
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) {
      summary.untouched += 1;
      summary.perIdentity[identityId] = { action: 'untouched (no spawn-history with verdicts)', backfilled: 0 };
      continue;
    }
    if (!DRY_RUN) {
      identity.quality_factors_history = entries.slice(-50);  // honor cap
    }
    summary.backfilled += 1;
    summary.perIdentity[identityId] = { action: DRY_RUN ? 'would backfill' : 'backfilled', backfilled: entries.length };
  }

  if (!DRY_RUN) {
    const tmp = STORE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
  }

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    storePath: STORE_PATH,
    sourcePath: SPAWN_HISTORY,
    summary,
  }, null, 2));
}

main();
