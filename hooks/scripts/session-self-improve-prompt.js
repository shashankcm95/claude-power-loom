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
const { spawnSync } = require('child_process');
const { log } = require('./_log.js');
const logger = log('session-self-improve-prompt');

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const PENDING_PATH = path.join(os.homedir(), '.claude', 'checkpoints', 'self-improve-pending.json');

function resolveSelfImproveScript() {
  const candidates = [
    path.join(__dirname, '..', '..', 'scripts', 'self-improve-store.js'),
    path.join(__dirname, '..', 'scripts', 'self-improve-store.js'),
    path.join(os.homedir(), '.claude', 'scripts', 'self-improve-store.js'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.F_OK); return c; } catch { /* next */ }
  }
  return null;
}

function loadPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8')); }
  catch { return null; }
}

function writeAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function buildReminder(candidates) {
  // Group by risk so the user sees auto-graduated (cheap, audit-only) up top
  // and pending-approval items below — minimizing decision load.
  const auto = candidates.filter((c) => c.status === 'auto-graduated');
  const queued = candidates.filter((c) => c.status === 'pending');

  const lines = [];
  lines.push('[SELF-IMPROVE QUEUE]');
  lines.push(`The auto self-improve loop has ${candidates.length} unreviewed candidate(s) from prior sessions.`);
  lines.push('');

  if (auto.length > 0) {
    lines.push(`Auto-graduated (low-risk, already logged to ~/.claude/checkpoints/observations.log):`);
    for (const c of auto.slice(0, 5)) {
      lines.push(`  • ${c.summary} (kind: ${c.kind})`);
    }
    if (auto.length > 5) lines.push(`  ... and ${auto.length - 5} more`);
    lines.push('');
  }

  if (queued.length > 0) {
    lines.push(`Pending your decision (medium/high risk, needs explicit approval):`);
    for (const c of queued.slice(0, 5)) {
      lines.push(`  • [${c.id}] ${c.summary}`);
      lines.push(`    risk: ${c.risk} | kind: ${c.kind} | ${c.proposedAction}`);
    }
    if (queued.length > 5) lines.push(`  ... and ${queued.length - 5} more`);
    lines.push('');
    lines.push('Surface this to the user once with options: approve specific IDs, dismiss all, or invoke /self-improve to triage. Use:');
    lines.push('  node ~/.claude/scripts/self-improve-store.js promote --id <id>');
    lines.push('  node ~/.claude/scripts/self-improve-store.js dismiss --id <id>');
  } else {
    lines.push('No items requiring approval — auto-graduated entries are informational.');
  }
  lines.push('[/SELF-IMPROVE QUEUE]');
  return lines.join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  // Default: pass-through unchanged. Only inject when (a) there's a pending
  // queue AND (b) we haven't shown it yet this session.
  let suffix = '';
  try {
    const pending = loadPending();
    if (!pending) {
      // No queue file yet — first run after install. Nothing to surface.
      logger('no_queue_file');
    } else if (pending.lastShownInSessionId === SESSION_ID) {
      // Already nudged this session.
      logger('already_shown');
    } else {
      const visible = (pending.candidates || []).filter((c) => c.status === 'pending' || c.status === 'auto-graduated');
      if (visible.length === 0) {
        logger('queue_empty');
      } else {
        suffix = '\n\n' + buildReminder(visible) + '\n';
        // Mark as shown for this session — atomic write.
        pending.lastShownInSessionId = SESSION_ID;
        pending.lastShownAt = new Date().toISOString();
        writeAtomic(PENDING_PATH, pending);
        logger('injected', { sessionId: SESSION_ID, candidateCount: visible.length });
      }
    }
  } catch (err) {
    logger('error', { error: err.message });
  }
  process.stdout.write(input + suffix);
});
