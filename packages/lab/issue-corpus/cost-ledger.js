#!/usr/bin/env node

// @loom-layer: lab
//
// ③.2.2b — the actor cost-guard: a fail-closed per-run spend ledger for the metered
// `claude -p` actor (the API key is METERED, separate from the flat subscription, so a
// runaway loop is a real-money incident). PURE-ish: the JSONL ledger file is the only I/O,
// and its path is injectable for tests.
//
// LOAD-BEARING (VERIFY board, hacker #5 HIGH):
//   - The ledger is HOST-ONLY, OUTSIDE any bind-mount, chmod 600 — it must NEVER live under the
//     actor-writable /work clone, or the actor itself could corrupt it to defeat the cap.
//   - readLedgerTotal returns { total, malformed } — the malformed-line COUNT is SURFACED, never
//     silently swallowed. assertWithinBudget fails CLOSED on malformed > 0 (a corrupt ledger means
//     the cumulative CANNOT be proven under cap) AND on over-cap. "Skip the malformed line" alone is a
//     fail-OPEN lever: anyone who can corrupt a prior costly line drops the total toward 0.
//   - The per-run estimate is a FROZEN conservative default, NOT a caller-supplied value (a too-low
//     caller estimate lets a single run overshoot the cap by one full run's actual cost).
//
// The API key VALUE never enters this module's output: the ledger records cost, never the key.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The frozen budget floor. An absent / non-finite / <= 0 LOOM_COST_CAP_USD can NEVER fail-open to
// unbounded — it fail-safes to this default (the weight-source-gate frozen-default discipline).
const DEFAULT_COST_CAP_USD = 20;

// A FROZEN conservative per-run estimate for the pre-spend gate (the plan's ~$1.30/issue upper bound).
// NOT caller-supplied: the pre-spend check runs BEFORE the real cost is known, so it must assume a
// run could cost this much, else one run overshoots the cap by its full actual cost before recordCost.
const DEFAULT_ESTIMATED_USD = 1.30;

// Warn (not refuse) once the projected cumulative crosses this fraction of the cap.
const WARN_FRACTION = 0.80;

// Resolve the host-only ledger path. Default ~/.config/loom/cost-ledger.jsonl (sibling of the API key
// file, OUTSIDE the repo and outside any bind-mount). Override via LOOM_COST_LEDGER_PATH or the arg.
function resolveLedgerPath(override) {
  if (typeof override === 'string' && override.trim()) return override;
  const env = process.env.LOOM_COST_LEDGER_PATH;
  if (typeof env === 'string' && env.trim()) return env;
  return path.join(os.homedir(), '.config', 'loom', 'cost-ledger.jsonl');
}

// Resolve the cap from the env, fail-safe to the frozen default (never fail-open).
function resolveBudgetCap() {
  const raw = process.env.LOOM_COST_CAP_USD;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_COST_CAP_USD;
}

// Extract total_cost_usd from a claude -p run. Accepts the raw stream-json stdout (NDJSON string) OR a
// parsed events array. Returns the LAST event's finite total_cost_usd, else null (NEVER a fabricated 0
// that would hide a real spend — a missing cost is honestly unknown, handled by the caller).
function parseCostFromStreamJson(stdoutOrEvents) {
  let events = [];
  if (Array.isArray(stdoutOrEvents)) {
    events = stdoutOrEvents;
  } else if (typeof stdoutOrEvents === 'string') {
    for (const line of stdoutOrEvents.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { events.push(JSON.parse(t)); } catch { /* skip a partial/unparseable line */ }
    }
  } else {
    return null;
  }
  let cost = null;
  for (const ev of events) {
    if (ev && typeof ev === 'object' && Number.isFinite(ev.total_cost_usd)) cost = ev.total_cost_usd;
  }
  return cost;
}

// Sum costUsd over the ledger, SURFACING the malformed-line count (never silently skipping into a
// fail-open undercount). A non-blank line that does not parse to an object with a FINITE numeric
// costUsd increments `malformed`. An absent file is an empty ledger { total: 0, malformed: 0 }.
function readLedgerTotal({ ledgerPath } = {}) {
  const p = resolveLedgerPath(ledgerPath);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { total: 0, malformed: 0 };
    throw e; // a real read fault (perms) must NOT be silently treated as $0 spent
  }
  let total = 0;
  let malformed = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec = null;
    try { rec = JSON.parse(t); } catch { malformed += 1; continue; }
    // A finite NEGATIVE costUsd is corruption, NOT a valid line (VALIDATE hacker H1): a cost can never
    // be < 0, and a negative line would SUBTRACT from the total -> sink it below the cap -> fail OPEN.
    // Count it malformed so assertWithinBudget REFUSES (fail-closed), same as an unparseable line.
    if (!rec || typeof rec !== 'object' || !Number.isFinite(rec.costUsd) || rec.costUsd < 0) { malformed += 1; continue; }
    total += rec.costUsd;
  }
  return { total, malformed };
}

// Append one JSONL record. The cumulative is RE-DERIVED from the on-disk total + this cost (never
// trusts a caller-supplied cumulative). `now` is injected for deterministic tests. The dir is created
// 0o700 and the file written 0o600 (host-only secret-adjacent hygiene). Returns a FRESH record object.
function recordCost({ ledgerPath, runId, issueId, costUsd, now } = {}) {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error('recordCost: costUsd must be a finite non-negative number');
  const p = resolveLedgerPath(ledgerPath);
  const prior = readLedgerTotal({ ledgerPath: p });
  const cumulativeUsd = prior.total + costUsd;
  const ts = new Date(typeof now === 'number' ? now : Date.now()).toISOString();
  const record = Object.freeze({
    ts,
    runId: runId == null ? null : String(runId),
    issueId: issueId == null ? null : String(issueId),
    costUsd,
    cumulativeUsd,
  });
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(p, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  // The `mode` option above is IGNORED for a PRE-EXISTING file (CodeRabbit #391) — enforce 0o600/0o700
  // explicitly so a ledger/dir created with broader perms (or by another tool) is re-hardened every write
  // (fail-closed; the dir is secret-adjacent — it also holds the API key).
  fs.chmodSync(dir, 0o700);
  fs.chmodSync(p, 0o600);
  return record;
}

// The pre-spend gate. Fail-CLOSED on BOTH:
//   (a) a corrupt ledger (malformed > 0) — the cumulative cannot be PROVEN under cap, so REFUSE
//       rather than run on an under-counted total (hacker #5);
//   (b) the projected cumulative (current total + the conservative per-run estimate) exceeds the cap.
// Returns a FRESH { ok, total, projected, capUsd, warn } on pass; THROWS a bounded (non-secret) error
// on refuse. Cost numbers are safe to surface; the API key never reaches here.
function assertWithinBudget({ ledgerPath, capUsd, estimatedUsd } = {}) {
  const cap = Number.isFinite(capUsd) && capUsd > 0 ? capUsd : resolveBudgetCap();
  // `> 0` not `>= 0` (CodeRabbit #391): a caller passing estimatedUsd=0 would zero the pre-spend margin
  // and bypass the conservative floor — a 0/negative/absent estimate MUST fall back to the frozen default.
  const est = Number.isFinite(estimatedUsd) && estimatedUsd > 0 ? estimatedUsd : DEFAULT_ESTIMATED_USD;
  const { total, malformed } = readLedgerTotal({ ledgerPath });
  if (malformed > 0) {
    throw new Error(`cost-ledger: REFUSE — ${malformed} malformed ledger line(s); cumulative cannot be proven under the $${cap} cap (fail-closed)`);
  }
  const projected = total + est;
  if (projected > cap) {
    throw new Error(`cost-ledger: REFUSE — projected $${projected.toFixed(4)} (spent $${total.toFixed(4)} + est $${est.toFixed(2)}) exceeds the $${cap} cap (fail-closed)`);
  }
  return Object.freeze({ ok: true, total, projected, capUsd: cap, warn: projected >= cap * WARN_FRACTION });
}

// Resolve the Anthropic API key from the host-only key file (chmod 600, gitignored, OUTSIDE the repo).
// Returns the trimmed key string or null (absent/empty). The VALUE is returned ONLY to the in-process
// caller that injects it into the docker child env — never logged, never persisted.
function resolveActorApiKey({ keyPath } = {}) {
  const p = (typeof keyPath === 'string' && keyPath.trim())
    ? keyPath
    : (process.env.LOOM_ANTHROPIC_KEY_FILE && process.env.LOOM_ANTHROPIC_KEY_FILE.trim())
      || path.join(os.homedir(), '.config', 'loom', 'anthropic-api-key');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return null; // genuinely absent -> no key (caller skips)
    throw e; // EACCES / a real read fault is a MISCONFIG that must surface, NOT a silent "no key"
  }
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

module.exports = {
  resolveLedgerPath, resolveBudgetCap, parseCostFromStreamJson, readLedgerTotal,
  recordCost, assertWithinBudget, resolveActorApiKey,
  DEFAULT_COST_CAP_USD, DEFAULT_ESTIMATED_USD, WARN_FRACTION,
};
