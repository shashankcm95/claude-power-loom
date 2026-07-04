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
const { log } = require('../hooks/_lib/_log.js');
// F5 (post-compact PR-1 R1): migrate 3 .tmp+rename sites to writeAtomicString.
// writeAtomicString encapsulates the write-tmp + rename pattern (with
// best-effort cleanup-on-error per H.9.8) — closes torn-read race + simplifies
// audit trail.
const { writeAtomicString } = require('../_lib/atomic-write.js');
// ③.0-W2: the shared canonical secret classes (high-precision, prefix-anchored; no FP).
// Factory call (NOT a shared const) so the scrubber owns FRESH RegExp instances — no
// /g lastIndex bleed with the validator's copy.
// ③.1-W4d Item 2a: the COARSE scrubber-only extras are now ALSO hoisted into the SSOT
// (getScrubberOnlyClasses) so the lab scrubber (scrub-lab-secrets.js) reaches the same
// full surface. Both factories hand out fresh /g instances — this module owns its copies.
const { getCanonicalSecretClasses, getScrubberOnlyClasses } = require('../_lib/secret-patterns.js');
// v3.4 Wave 3 (A6): the kernel reads the lab-materialized reputation snapshot AS A FILE (K12-clean —
// no lab import; the §3.6 Lab→Kernel mediation). The reader is bounded + fail-open + self-verifying;
// it NEVER throws and NEVER reads the ledger (O(1)) — fits the <50ms p99 close-hook budget.
const { readEvolutionSnapshot } = require('../_lib/evolution-snapshot-read.js');
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
// v3.4 Wave 3 (A6): byte-cap the INLINE reputation snapshot value in the envelope. The snapshot is
// small (~18 personas) so this rarely fires; past the cap we drop the inline `value` but keep the
// content_hash pin (replay can still verify WHICH snapshot) + watermark. Measured in UTF-8 BYTES
// (verify-plan CR-HIGH-1) to match on-disk encoding, NOT String.length (UTF-16 code-units).
const MAX_INLINE_SNAPSHOT_BYTES = 64 * 1024;

// Secret-pattern scrub (code-reviewer HIGH-1). Applied to completion text
// BEFORE bounded-excerpt capture. The sha256 is computed on the unscrubbed
// text so fingerprints remain honest; the EXCERPT is what we sanitize. This
// is a coarse net, not exhaustive — defense-in-depth, not a primary control.
// The user's MEMORY.md captures the broader secret-management discipline
// (BYO-credentials Cloudflare deployment goal); per-user-keys MUST NOT leak
// into spawn-state envelopes that are world-readable on shared hosts.
// F22 (post-compact PR-1 R1) — extended pattern enumeration per ADR-0011 §F22.
// The plan + ADR explicitly enumerate the additions; impl MUST match the
// ADR's enumeration (no more, no less) — rationale-before-code discipline.
// ③.0-W2: the scrub set = the shared CANONICAL classes (gh*, github_pat_, glpat-, AIza,
// sk-ant-, slack, stripe-live, AKIA, JWT, PEM — gaining github_pat_/ghs_/ghr_/ghu_/glpat-/
// AIza/PEM the old hand-list missed) PLUS the coarse SCRUBBER-ONLY extras (URL-embedded
// password, coarse sk-, Stripe TEST sk_test_/rk_test_, AWS-secret assignment) — patterns the
// CANONICAL set does NOT carry because they are too FP-prone for the BLOCKING validator but
// harmless for coarse redaction (over-match in a redaction net is safe). ③.1-W4d Item 2a:
// the scrubber-only extras moved into the SSOT (getScrubberOnlyClasses) so the lab scrubber
// reaches the SAME full surface — this is behavior-preserving here (same classes, same /g).
// Both factories are called ONCE so this module owns its own fresh RegExp instances.
// NOTE (W2 VALIDATE reviewer LOW-1): canonical AKIA (\bAKIA…\b) + JWT ({20,} segment floors)
// are marginally NARROWER than this scrubber's old hand-list (bare /AKIA…/ and floorless JWT).
// INTENTIONAL: a real AWS key / JWT never appears mid-word or with <20-char segments, so the
// canonical (validator-precise) forms still redact every real token; the shared set is worth
// the negligible coarseness loss.
const SECRET_PATTERNS = [
  ...getCanonicalSecretClasses().map((c) => c.regex),
  ...getScrubberOnlyClasses().map((c) => c.regex),
];
// F22 regex edge-case notes (code-review Phase-10 FLAG #10):
//   - Empty password (`://user:@host`) is NOT matched — `[^@\s/]+` requires
//     1+ chars in the password segment. Acceptable — empty passwords are
//     not real secrets.
//   - Colon in username (`://name:rest:pw@host`) treats `rest` as password.
//     Rare URL form; defense-in-depth via subsequent patterns.
//   - URL-encoded `%40` in password is preserved correctly (no literal `@`
//     in the password segment).
// scrubSecrets is a coarse net (defense-in-depth), not a primary control
// — per comment at line 88-89 above.

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

/**
 * Detect the ASYNC-LAUNCH STUB the harness returns as the IMMEDIATE tool_response
 * for a background/async spawn: `{isAsync:true, status:'async_launched', agentId,
 * prompt:<echoed>, …}`, no `.text`/`.content`. It is the launch ACK, not the
 * sub-agent response — the real completion arrives out-of-band via a
 * task-notification and never re-fires PostToolUse (#508). Recording the stub's
 * stringified form (dominated by the echoed prompt) as `completion_sha256`/
 * excerpt would mis-label the ack as the completion, so buildEnvelope records
 * honestly when this is true.
 *
 * Format-shape detector — deliberately DUPLICATED (not shared) per this file's
 * `extractResultText` convention (each hook independently auditable/restartable).
 * Canonical definition + rationale: `hooks/post/kb-citation-gate.js:isAsyncLaunchStub`.
 */
function isAsyncLaunchStub(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object' || Array.isArray(toolResponse)) {
    return false;
  }
  return toolResponse.status === 'async_launched' || toolResponse.isAsync === true;
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
      // Atomic write via writeAtomicString (F5: post-compact PR-1 R1 migration
      // from bare writeFileSync+renameSync). Encapsulates the write-tmp +
      // rename + cleanup-on-error pattern; same POSIX-atomic semantics as
      // before, plus consistent best-effort .tmp cleanup on error.
      writeAtomicString(RUN_ID_FALLBACK_FILE, out);
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
 * v3.4 Wave 3 (A6): bound the snapshot for INLINE storage in the envelope. Defaults a missing read to
 * {present:false}. Drops an oversized inline `value` (UTF-8 bytes > cap, or an unstringifiable value)
 * but keeps the content_hash pin + watermark, flagging truncated:true. PURE (no I/O).
 */
function boundSnapshot(snap) {
  const s = (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : { present: false, reason: 'not-read' };
  if (s.present && s.value != null) {
    let bytes = Infinity;
    try { bytes = Buffer.byteLength(JSON.stringify(s.value), 'utf8'); } catch { /* unstringifiable → truncate */ }
    if (bytes > MAX_INLINE_SNAPSHOT_BYTES) return { ...s, value: null, truncated: true };
  }
  return s;
}

/**
 * Pure envelope construction — no clock side effects, no I/O. The diagnostics
 * block sets `hook_duration_ms: null` here; main() backfills it AFTER
 * writeEnvelope so the metric reflects the full I/O cost (code-reviewer
 * HIGH-3 + PRINCIPLE).
 *
 * `evolutionSnapshot` is read by main() (the I/O stays out of this pure fn) and recorded under
 * axioms.evolution_snapshot.reputation (A6 records-not-injects; ADR-0012). Namespaced under
 * `.reputation` so the INV-23 MVCC `prev_state_hash` pin can later be a sibling sub-field.
 */
function buildEnvelope({ input, toolName, toolInput, toolResponse, evolutionSnapshot }) {
  const rawSubagentType =
    toolInput.subagent_type || toolInput.subagent || toolInput.type || '';
  const subagentBase = normalizeSubagentType(rawSubagentType);

  const promptText = String(
    toolInput.prompt || toolInput.input || toolInput.task || ''
  );
  const description = String(toolInput.description || '').slice(0, 200);

  // Async-launch stub (follow-up 2 of #508): PostToolUse fired at LAUNCH, so
  // toolResponse is the launch ACK, not the response. Do NOT extract/scrub/excerpt
  // it — capturing the stringified ack (dominated by the echoed prompt) would
  // record the ACK as the completion fingerprint. Honest bounded_output below.
  const asyncLaunch = isAsyncLaunchStub(toolResponse);
  const completionRaw = asyncLaunch ? '' : extractResultText(toolResponse);
  // Compute sha256 on UNSCRUBBED text so the fingerprint stays honest;
  // scrub before excerpt capture so leaked secrets don't land on disk.
  const completionScrubbed = scrubSecrets(completionRaw);
  const excerpt = safeExcerpt(completionScrubbed, EXCERPT_HEAD, EXCERPT_TAIL);

  return {
    schema_version: SCHEMA_VERSION,
    schema_phase: SCHEMA_PHASE,
    spawn_id: buildSpawnId(),
    parent_state_id: null,
    // PR-4a (ADR-0010 INV-A7, ADR-0011 §write-scope-violations-schema): the
    // write-scope violation set K14 populates at spawn-close and the PR-4b
    // post-spawn-resolver consumes. Defaults to [] (clean spawn — empty = no
    // out-of-scope writes). DORMANT in v3.0-alpha: nothing wires K14 to write
    // here yet, so this stays [] in practice until 4b. Element shape:
    // {path, kind, transport, detected_at_phase, sha256_pre, sha256_post, flags}.
    write_scope_violations: [],
    captured_at: new Date().toISOString(),
    axioms: {
      tool_name: toolName,
      // ③.0-W2 (post-VALIDATE leak-trace, Gemini-premise-2 sharp version): scrubSecrets is
      // applied to EVERY caller/model-influenceable FREE-FORM string persisted to this
      // world-readable (umask, ~0644) envelope — not just the completion excerpt (:321). A
      // probe planted a token in description/subagent_type/cwd and saw it survive these axiom
      // fields UNSCRUBBED. input_description (model-authored free text) is the highest-realism
      // vector. Scrub is a no-op for every real value (a persona id / path / type never matches
      // a secret pattern), so legit records are byte-unchanged; only a token-bearing (already
      // malformed) value is redacted. session_id is DELIBERATELY left unscrubbed: it is a
      // harness-controlled identifier + correlation key (a uuid, never secret-shaped) — scrubbing
      // an id risks corrupting the key for zero real gain. sha256/chars carry no secret.
      subagent_type: scrubSecrets(subagentBase),
      subagent_type_raw: scrubSecrets(String(rawSubagentType)),
      input_prompt_sha256: promptText ? sha256(promptText) : null,
      input_prompt_chars: promptText.length,
      input_description: scrubSecrets(description),
      session_id: input.session_id || input.sessionId || null,
      cwd: scrubSecrets(input.cwd || input.workspace || null),
      // A6 (v3.4 Wave 3): the reputation derived-view promoted to an axiom-class attestation (v6:179
      // carve-out). Namespaced under .reputation; INV-23's prev_state_hash MVCC pin is a deferred
      // sibling. The kernel RECORDS this (it cannot inject it into the spawn — ADR-0012); the snapshot
      // is read O(1) from the lab-materialized file in main() and bounded here for inline storage.
      evolution_snapshot: { reputation: boundSnapshot(evolutionSnapshot) },
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
      // `completion_captured` + `capture_phase` are additive markers (new fields —
      // SCHEMA_VERSION stays v1; old walkers ignore them) giving consumers a uniform
      // flag for whether the excerpt/sha describe a REAL completion. For an async
      // launch the completion is NOT here (see asyncLaunch above); we record that
      // honestly with null fields (not 0/'' alone, which would read as "captured an
      // empty completion") + the stub's agentId as the correlation key for a FUTURE
      // SubagentStop-based capture. Correlation basis: the SubagentStop payload
      // carries a top-level `agent_id` equal to the spawn's launch `agentId`
      // (firsthand-verified in the #509 SubagentStop probes — the sync spike showed
      // SubagentStop.agent_id === the PostToolUse tool_response.agentId; it is the
      // subagent's own id). The consumer that would join on it is NOT yet wired
      // (deferred), so this stores the key optimistically, it does not assert a live join.
      bounded_output: asyncLaunch
        ? {
          completion_sha256: null,
          completion_chars: null,
          excerpt_head: '',
          excerpt_tail: '',
          scrubbed: false,
          completion_captured: false,
          capture_phase: 'async-launch',
          agent_id: (toolResponse && typeof toolResponse.agentId === 'string')
            ? toolResponse.agentId
            : null,
        }
        : {
          completion_sha256: completionRaw ? sha256(completionRaw) : null,
          completion_chars: completionRaw.length,
          excerpt_head: excerpt.head,
          excerpt_tail: excerpt.tail,
          scrubbed: completionRaw !== completionScrubbed,
          // Honest even for an EMPTY sync response: completion_captured reflects
          // whether real text was actually captured, not merely "not an async
          // launch". An empty completed close → captured:false + 'completed-empty'
          // so a consumer keying on captured:true never sees a 0-char "completion".
          completion_captured: completionRaw.length > 0,
          capture_phase: completionRaw.length > 0 ? 'completed' : 'completed-empty',
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
  // Atomic-ish write via writeAtomicString (F5: post-compact PR-1 R1 migration
  // from bare writeFileSync+renameSync). Cheap insurance against torn reads
  // by an in-progress recall CLI walker; same-filesystem so POSIX-atomic.
  writeAtomicString(file, JSON.stringify(envelope, null, 2));
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
    // A6 (v3.4 Wave 3): read the reputation snapshot O(1), fail-open (never throws). INSIDE this try
    // (verify-plan CR-MED-3) so any defensive edge stays under the fail-soft catch below.
    const evolutionSnapshot = readEvolutionSnapshot();
    const envelope = buildEnvelope({ input, toolName, toolInput, toolResponse, evolutionSnapshot });
    envelope.diagnostics.run_id_source = source;
    const file = writeEnvelope(envelope, run_id);
    // Backfill duration AFTER all I/O so the stored metric matches the
    // <50ms p99 budget the RFC §"Periodic sweep cadences" defines.
    envelope.diagnostics.hook_duration_ms = computeDurationMs(startedAt);
    // Re-write with the final duration via writeAtomicString (F5 migration).
    // Second tiny write; acceptable because it's the same atomic write path
    // and the consumer reads the FINAL file. Keeps the metric inside the
    // envelope (single source of truth) instead of in a sidecar log only.
    //
    // FL-9 tradeoff note (post-compact PR-1 R1): collapsing the two writes
    // into one would shift the captured duration from "after all I/O" to
    // "before final I/O" — for the <50ms diagnostic budget this is
    // tolerable, but the current double-write preserves the original
    // "measure-after-write" semantics that the RFC §"Periodic sweep
    // cadences" defines. Future micro-optimization can collapse here with
    // an explicit code comment on the semantic shift.
    try {
      writeAtomicString(file, JSON.stringify(envelope, null, 2));
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
  // F-2 (post-compact PR-1 R1): scrubSecrets exported at top-level for
  // cross-module reuse by `_lib/sanitize.js` (`prepareForJsonl` composed
  // pipeline) and any future audit-log emitters (e.g., memory-root.js
  // bounded-error-message hygiene). The top-level export is the CANONICAL
  // path for cross-module callers; `__test__.scrubSecrets` is a legacy alias
  // (same function reference) preserved for in-module test access — see
  // canonical-export note in __test__ block below.
  scrubSecrets,
  // Exported for unit/integration tests + the smoke harness. Not used by
  // the hook runtime path (which calls main() directly).
  // NOTE (code-review Phase-10 FLAG #5): `__test__.scrubSecrets` is an
  // ALIAS for `module.exports.scrubSecrets` above (same function reference).
  // Cross-module callers MUST import via `require('./spawn-record.js').scrubSecrets`
  // (top-level path), not via `__test__`. If SECRET_PATTERNS changes in a
  // future PR, both paths stay in sync automatically because they reference
  // the same closure.
  __test__: {
    buildEnvelope,
    normalizeSubagentType,
    extractResultText,
    isAsyncLaunchStub,
    resolveRunId,
    sha256,
    safeExcerpt,
    scrubSecrets,
    computeDurationMs,
  },
};
