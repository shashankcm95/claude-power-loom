#!/usr/bin/env node

// UserPromptSubmit hook (H.4.1): on the first user prompt of each session,
// check the self-improve pending queue. If non-empty, inject a single batched
// reminder so Claude can surface candidates to the user — one approval moment
// per session, not per event.
//
// Design constraints:
//   - Idempotent within a session: marks pending.lastShownInSessionId after
//     first injection so repeated UserPromptSubmits don't re-nudge.
//   - Best-effort: failures here never break the prompt pipeline; we always
//     pass the user's prompt through unchanged.
//   - Quiet when there's nothing to surface (no log spam, no injection).
//
// Forcing-instruction class: 2 (operator notice) — emits [SELF-IMPROVE QUEUE].
// Status surface for pending self-improve candidates; NOT a Claude-side
// semantic action ask. Per Convention G (skills/agent-team/patterns/validator-
// conventions.md). Catalog: skills/agent-team/patterns/forcing-instruction-
// family.md.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('../_lib/_log.js');
const logger = log('session-self-improve-prompt');
// HT.audit-followup H4: writeAtomic migrated to `_lib/atomic-write.js` shared
// primitive (pid + hrtime + crypto nonce; collision-resistant under PID-reuse
// + async-retry races). First cross-tree relative require from hooks/scripts/
// to packages/kernel/_lib/ following the HT.2.3 precedent in session-end-nudge.js.
const { writeAtomic } = require('../../_lib/atomic-write');

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const PENDING_PATH = path.join(os.homedir(), '.claude', 'checkpoints', 'self-improve-pending.json');

function loadPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); }
  catch { return null; }
}

// writeAtomic — see require at top of file (migrated to `_lib/atomic-write.js`
// at HT.audit-followup H4)

// Ghost Heartbeat W1 (2026-06-19) — the surface GATE. Only converged
// HIGH-VALUE candidates auto-surface: `rule-candidate` (a `drift:`/`rule:`/
// `rule-recurrence:` signal converged) and `agent-evolution`. The retired
// frequency kinds (`observation-log` from `filePath:`, `skill-candidate` from
// `command:`) are EXCLUDED by construction — they never reach the prompt
// pipeline, closing the 2026-05-30 91.5%-dismissal-noise failure mode even if a
// stray such candidate ever re-enters the queue. Both allowlisted kinds are
// `high` risk, which never auto-graduate, so `status === 'pending'` is the only
// reachable surfacing path. Low-risk items remain inspectable via
// `self-improve-store.js pending`.
const HIGH_VALUE_KINDS = new Set(['rule-candidate', 'agent-evolution']);

function buildReminder(candidates) {
  // All inputs are high-value, pending candidates (gated upstream).
  const lines = [];
  lines.push('[SELF-IMPROVE QUEUE]');
  lines.push(`The self-improve loop has ${candidates.length} converged candidate(s) awaiting your decision.`);
  lines.push('');
  for (const c of candidates.slice(0, 8)) {
    lines.push(`  • [${c.id}] ${c.summary}`);
    lines.push(`    risk: ${c.risk} | kind: ${c.kind} | ${c.proposedAction}`);
  }
  if (candidates.length > 8) lines.push(`  ... and ${candidates.length - 8} more`);
  lines.push('');
  lines.push('Surface this to the user once: approve specific IDs, dismiss, or invoke /self-improve to triage. Use:');
  lines.push('  node ~/.claude/packages/kernel/spawn-state/self-improve-store.js promote --id <id>');
  lines.push('  node ~/.claude/packages/kernel/spawn-state/self-improve-store.js dismiss --id <id>');
  lines.push('[/SELF-IMPROVE QUEUE]');
  return lines.join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  // UserPromptSubmit contract (matches the working sibling prompt-enrich-
  // trigger.js): stdin is the JSON event envelope ({ prompt, session_id, ... });
  // stdout is ADDED to the model's context — we never echo the prompt back.
  // Emit ONLY the reminder (or nothing). Fail-open: any parse/IO error -> emit
  // nothing, never throw (the harness keeps the user's prompt intact).
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || SESSION_ID;
    const pending = loadPending();
    if (!pending) { logger('no_queue_file'); return; }
    if (pending.lastShownInSessionId === sessionId) { logger('already_shown'); return; }
    const visible = (pending.candidates || []).filter(
      (c) => c.status === 'pending' && HIGH_VALUE_KINDS.has(c.kind));
    if (visible.length === 0) { logger('queue_empty'); return; }
    process.stdout.write(buildReminder(visible) + '\n');
    // Mark as shown for this session — atomic write (best-effort).
    pending.lastShownInSessionId = sessionId;
    pending.lastShownAt = new Date().toISOString();
    writeAtomic(PENDING_PATH, pending);
    logger('injected', { sessionId, candidateCount: visible.length });
  } catch (err) {
    logger('error', { error: err.message });
  }
});
