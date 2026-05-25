#!/usr/bin/env node

// PostToolUse:Agent|Task hook — captures a "spawn record" envelope to disk
// every time the parent invokes the Agent or Task tool. This is the empirical
// anchor for v3.0's parent-records design.
//
// RFC anchor: swarm/thoughts/shared/design/causal-recall-graph-rfc.md v3.2-LOCKED
//   §"Four-Class State Model"
//   §"L_spawn record — final shape after all pivots"
//   §"Pivot 1: Parent-records L_spawn"
//   §"Pivot 3: Axiom→Attestation discipline; reasoning is stochastic-sample"
//   §"Concurrency framing"
//   §"Side-effects declaration"
//
// Why it exists. Wave A Probe P2 confirmed plugin sub-agents cannot ship
// their own hooks (hooks/mcpServers/permissionMode unsupported for
// plugin-shipped agents per code.claude.com/docs/en/plugins-reference:70).
// So the PARENT must capture L_spawn observations from outside the spawn —
// which is exactly what PostToolUse:Agent|Task lets us do, and which
// kb-citation-gate.js already proves works end-to-end (hooks.json:175-183).
//
// Phase 1 prototype scope:
//   - Writes one JSON file per spawn under ~/.claude/spawn-state/<run_id>/
//   - Captures axioms (tool name + subagent type + prompt sha256 + bounded
//     metadata) + attestations envelope (bounded_output excerpts + delta
//     placeholder for Phase 2). The `samples[]` array is RESERVED for the
//     Phase 3 Dream-Lite stochastic-sample regeneration path; empty in
//     Phase 1. The architect review caught that bounded excerpts are
//     ATTESTATIONS-of-what-the-spawn-claimed, not stochastic samples in the
//     RFC's strict sense (M2 from the architect pair-review).
//   - Stores ONLY sha256s + bounded excerpts of the prompt/completion —
//     never raw payloads. Privacy + storage discipline (RFC §"Pivot 3").
//     Completion text is RUN THROUGH `scrubSecrets()` BEFORE excerpt
//     capture so leaked AWS/OpenAI/JWT credentials don't get immortalized
//     in spawn-state (code-reviewer HIGH-1).
//   - Spawn-state directory is created with `0o700` mode for shared-host
//     hygiene (code-reviewer HIGH-2). Existing directories are NOT chmod'd.
//   - Hook duration target: <50ms p99 (RFC §"Periodic sweep cadences");
//     measured around the FULL hook execution including disk I/O so the
//     stored metric matches the budget (code-reviewer HIGH-3 / PRINCIPLE).
//   - Fail-soft per ADR-0001: any error → exit 0 silently. Never block.
//
// Phase 1 deliberately deferred to P-Proto v2 / later phases:
//   - Delta capture (git-stash / path-list-sha256). attestations.delta_*
//     are nulled out with a note. RFC §"Pivot 2" + §"Concurrency framing"
//     define the eventual serial-only policy.
//   - parent_state_id chain. Set to null; the chain mechanism (linking
//     this spawn to the prior spawn's id within the same run) needs a
//     small run-scoped cursor. Architect M3: this is the only data-flow
//     gap to Phase 2's recall CLI (causal-chain walks need the chain).
//     Tracked in phase-1-probes.md §"RESUME HERE" as Wave D / Phase 2
//     entry-gate item.
//   - Sample regeneration (stochastic-sample re-derivation). Phase 3
//     Dream-Lite concern; `samples: []` reserved.
//   - Run-id derivation from session_id is the preferred eventual source;
//     for Phase 1 we hash the input.session_id when present, and fall back
//     to a ppid-keyed persistent file otherwise. The `_run-id.txt`
//     fallback file is written atomically via tmp+rename (code-reviewer
//     MEDIUM-1). Run-id source is exposed in diagnostics.run_id_source
//     so Phase 3 Dream-Lite consumers can secondary-key on session_id when
//     consolidating ppid_fallback-sourced records (architect L1).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { log } = require('./_log.js');
const logger = log('spawn-record');

const SPAWN_STATE_DIR = path.join(os.homedir(), '.claude', 'spawn-state');
const RUN_ID_FALLBACK_FILE = path.join(SPAWN_STATE_DIR, '_run-id.txt');
const HOOK_VERSION = 'v3.0-phase-1-prototype-1';
// Two-axis versioning (architect M1):
//   SCHEMA_VERSION bumps ONLY on incompatible envelope shape changes.
//   SCHEMA_PHASE is a lifecycle tag for human + dashboard consumption.
// Recall-CLI walkers key off SCHEMA_VERSION; humans read SCHEMA_PHASE.
const SCHEMA_VERSION = 'v1';
const SCHEMA_PHASE = 'phase-1-prototype';
const EXCERPT_HEAD = 512;
const EXCERPT_TAIL = 256;
const MAX_STDIN_BYTES = 10 * 1024 * 1024;  // 10MB defensive cap (code-reviewer MED-3)
const DIR_MODE = 0o700;                    // hygienic mode for spawn-state (code-reviewer HIGH-2)

// Secret-pattern scrub (code-reviewer HIGH-1). Applied to completion text
// BEFORE bounded-excerpt capture. The sha256 is computed on the unscrubbed
// text so fingerprints remain honest; the EXCERPT is what we sanitize. This
// is a coarse net, not exhaustive — defense-in-depth, not a primary control.
// The user's MEMORY.md captures the broader secret-management discipline
// (BYO-credentials Cloudflare deployment goal); per-user-keys MUST NOT leak
// into spawn-state envelopes that are world-readable on shared hosts.
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g,                                              // AWS access key id
  /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,  // AWS secret
  /sk-[a-zA-Z0-9\-_]{20,}/g,                                        // OpenAI / Anthropic key prefix
  /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/g,          // JWT
  /ghp_[a-zA-Z0-9]{36}/g,                                           // GitHub personal access token
  /gho_[a-zA-Z0-9]{36}/g,                                           // GitHub OAuth token
  /xox[abprs]-[a-zA-Z0-9-]{10,}/g,                                  // Slack token family
];

function scrubSecrets(text) {
  if (!text) return text;
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[REDACTED]');
  return out;
}

function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch (err) { logger('stdin-read-failed', { error: err.message }); return null; }
  if (!raw) return null;
  // Defensive size cap (code-reviewer MED-3). Oversized payloads short-circuit
  // to a fail-soft approve without spending CPU on JSON.parse.
  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
    logger('stdin-oversized', { bytes: Buffer.byteLength(raw, 'utf8') });
    return null;
  }
  try { return JSON.parse(raw); }
  catch (err) { logger('stdin-parse-failed', { error: err.message }); return null; }
}

function emitApprove() {
  // We do NOT block on this hook; emit a minimal approve envelope so the
  // parent's PostToolUse chain composes cleanly with the kb-citation-gate
  // hook running on the same matcher.
  process.stdout.write(JSON.stringify({ decision: 'approve' }) + '\n');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Mirror of kb-citation-gate's extractor (deliberately duplicated rather
 * than shared to keep each hook independently auditable + restartable).
 * Handles plain string / array of blocks / { text } / { content } shapes.
 */
function extractResultText(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  if (Array.isArray(toolResponse)) {
    return toolResponse
      .map(c => (c && typeof c === 'object' ? (c.text || c.content || '') : String(c)))
      .join('\n');
  }
  if (typeof toolResponse === 'object') {
    if (typeof toolResponse.text === 'string') return toolResponse.text;
    if (typeof toolResponse.content === 'string') return toolResponse.content;
    if (Array.isArray(toolResponse.content)) {
      return toolResponse.content
        .map(c => (c && typeof c === 'object' ? (c.text || '') : String(c)))
        .join('\n');
    }
    try { return JSON.stringify(toolResponse); } catch { return ''; }
  }
  return String(toolResponse);
}

function normalizeSubagentType(rawSubagentType) {
  if (!rawSubagentType) return '';
  const lower = String(rawSubagentType).toLowerCase();
  // Plugin-prefix normalization: "power-loom:architect" → "architect"
  return lower.includes(':') ? lower.split(':').pop() : lower;
}

/**
 * Run id resolution.
 *
 *   1. Prefer hash of input.session_id (most stable when present).
 *   2. Fall back to a ppid-keyed file at ~/.claude/spawn-state/_run-id.txt
 *      so spawn records from the same CLI invocation cluster together.
 *   3. If both fail, mint a fresh uuid keyed by current ms (degraded mode).
 *
 * Returns { run_id, source } so the envelope can record provenance.
 */
function resolveRunId(input) {
  const sessionId = input && (input.session_id || input.sessionId);
  if (sessionId && typeof sessionId === 'string') {
    return { run_id: sha256(sessionId).slice(0, 16), source: 'session_id_sha256' };
  }

  // ppid-keyed fallback: persist a single run-id keyed by current parent pid.
  // Single-line K=V format; we read/write the whole file (small; bounded by
  // ppid recycling). Note: this is best-effort; a ppid collision across long
  // sessions is the documented limitation surfaced in the envelope.
  const ppid = String(process.ppid || 0);
  try {
    fs.mkdirSync(SPAWN_STATE_DIR, { recursive: true, mode: DIR_MODE });
    let map = {};
    if (fs.existsSync(RUN_ID_FALLBACK_FILE)) {
      const raw = fs.readFileSync(RUN_ID_FALLBACK_FILE, 'utf8');
      for (const line of raw.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) map[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    if (!map[ppid]) {
      map[ppid] = crypto.randomUUID();
      const out = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      // Atomic write via tmp+rename (code-reviewer MED-1) — match the
      // envelope-write discipline so two near-simultaneous hooks with the
      // same ppid don't last-writer-wins different run_ids.
      const tmp = RUN_ID_FALLBACK_FILE + '.tmp';
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, RUN_ID_FALLBACK_FILE);
    }
    return { run_id: map[ppid].slice(0, 16), source: 'ppid_fallback' };
  } catch (err) {
    logger('run-id-fallback-failed', { error: err.message });
    return { run_id: crypto.randomUUID().slice(0, 16), source: 'fresh_uuid_degraded' };
  }
}

function buildSpawnId() {
  // Timestamp-prefixed UUID — sortable on disk; no external deps.
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

/**
 * Bounded excerpt — code-point-aware to avoid lone-surrogate splits at
 * UTF-16 surrogate boundaries (code-reviewer MED-2). Operates on code points
 * via `Array.from` so emoji / extended CJK at the cut point don't produce
 * ill-formed UTF-8 in the stored JSON.
 */
function safeExcerpt(text, head, tail) {
  if (!text) return { head: '', tail: '' };
  const codePoints = Array.from(text);
  if (codePoints.length <= head + tail) return { head: text, tail: '' };
  return {
    head: codePoints.slice(0, head).join(''),
    tail: codePoints.slice(-tail).join(''),
  };
}

/**
 * Pure envelope construction — no clock side effects, no I/O. The diagnostics
 * block sets `hook_duration_ms: null` here; main() backfills it AFTER
 * writeEnvelope so the metric reflects the full I/O cost (code-reviewer
 * HIGH-3 + PRINCIPLE).
 */
function buildEnvelope({ input, toolName, toolInput, toolResponse }) {
  const rawSubagentType =
    toolInput.subagent_type || toolInput.subagent || toolInput.type || '';
  const subagentBase = normalizeSubagentType(rawSubagentType);

  const promptText = String(
    toolInput.prompt || toolInput.input || toolInput.task || ''
  );
  const description = String(toolInput.description || '').slice(0, 200);

  const completionRaw = extractResultText(toolResponse);
  // Compute sha256 on UNSCRUBBED text so the fingerprint stays honest;
  // scrub before excerpt capture so leaked secrets don't land on disk.
  const completionScrubbed = scrubSecrets(completionRaw);
  const excerpt = safeExcerpt(completionScrubbed, EXCERPT_HEAD, EXCERPT_TAIL);

  return {
    schema_version: SCHEMA_VERSION,
    schema_phase: SCHEMA_PHASE,
    spawn_id: buildSpawnId(),
    parent_state_id: null,
    captured_at: new Date().toISOString(),
    axioms: {
      tool_name: toolName,
      subagent_type: subagentBase,
      subagent_type_raw: String(rawSubagentType),
      input_prompt_sha256: promptText ? sha256(promptText) : null,
      input_prompt_chars: promptText.length,
      input_description: description,
      session_id: input.session_id || input.sessionId || null,
      cwd: input.cwd || input.workspace || null,
    },
    // Architect M2: bounded excerpts are ATTESTATIONS (claims about what the
    // spawn produced), NOT stochastic samples in the RFC §"Pivot 3" sense.
    // The samples[] array stays empty in Phase 1; it's reserved for the
    // Phase 3 Dream-Lite re-derivation path. This locks in the RFC's
    // four-class discipline at the schema boundary before any consumer is
    // built — so Phase 2 walkers do not need a rename migration.
    theorems: [],
    samples: [],
    attestations: {
      status: 'ok',
      bounded_output: {
        completion_sha256: completionRaw ? sha256(completionRaw) : null,
        completion_chars: completionRaw.length,
        excerpt_head: excerpt.head,
        excerpt_tail: excerpt.tail,
        scrubbed: completionRaw !== completionScrubbed,
      },
      delta_capture_mode: 'none-in-phase-1-prototype',
      delta_sha: null,
      delta_bytes: null,
      note:
        'Phase 1 prototype: delta capture deferred to P-Proto v2; envelope only here. ' +
        'See RFC §"Pivot 2" and §"Concurrency framing" for the eventual serial-only policy.',
    },
    diagnostics: {
      hook_duration_ms: null,   // backfilled in main() after writeEnvelope
      hook_version: HOOK_VERSION,
    },
  };
}

function writeEnvelope(envelope, runId) {
  const dir = path.join(SPAWN_STATE_DIR, runId);
  const file = path.join(dir, `spawn-${envelope.spawn_id}.json`);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // Atomic-ish write: stage to tmp then rename. Cheap insurance against
  // a torn read by an in-progress recall CLI walker. Same-filesystem
  // (both paths under SPAWN_STATE_DIR/<runId>/) so rename is POSIX atomic.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

function computeDurationMs(startedAt) {
  return Math.max(0, Number(process.hrtime.bigint() - startedAt) / 1e6) | 0;
}

function main() {
  const startedAt = process.hrtime.bigint();
  const input = readStdin();
  if (!input) { emitApprove(); return; }

  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};
  const toolResponse =
    input.tool_response || input.toolResponse || input.tool_result || input.toolResult;

  if (toolName !== 'Agent' && toolName !== 'Task') {
    emitApprove();
    return;
  }

  try {
    const { run_id, source } = resolveRunId(input);
    const envelope = buildEnvelope({ input, toolName, toolInput, toolResponse });
    envelope.diagnostics.run_id_source = source;
    const file = writeEnvelope(envelope, run_id);
    // Backfill duration AFTER all I/O so the stored metric matches the
    // <50ms p99 budget the RFC §"Periodic sweep cadences" defines.
    envelope.diagnostics.hook_duration_ms = computeDurationMs(startedAt);
    // Re-write with the final duration. Second tiny write; acceptable
    // because it's the same atomic tmp+rename path and the consumer reads
    // the FINAL file. Keeps the metric inside the envelope (single source
    // of truth) instead of in a sidecar log only.
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      logger('duration-backfill-failed', { error: err.message, file });
    }
    logger('spawn-record-written', {
      file,
      run_id,
      spawn_id: envelope.spawn_id,
      subagent: envelope.axioms.subagent_type,
      duration_ms: envelope.diagnostics.hook_duration_ms,
    });
  } catch (err) {
    // Fail-soft: never block the session on hook failures.
    logger('spawn-record-failed', { error: err.message, stack: err.stack });
  }

  emitApprove();
}

if (require.main === module) main();

module.exports = {
  // Exported for unit/integration tests + the smoke harness. Not used by
  // the hook runtime path (which calls main() directly).
  __test__: {
    buildEnvelope,
    normalizeSubagentType,
    extractResultText,
    resolveRunId,
    sha256,
    safeExcerpt,
    scrubSecrets,
    computeDurationMs,
  },
};
