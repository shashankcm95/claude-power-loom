'use strict';

// packages/kernel/spawn-state/drift-audit.js
//
// Ghost Heartbeat W2-PR1. The advisory drift-EMIT producer. Reads ONE session
// transcript -> a CAPABILITY-FREE judge classifies drift against the FROZEN
// taxonomy -> a deterministic Verify guard -> idempotent emit (the store `bump`).
// Advisory, draft-only, default-off. Carriers (Stop hook / cron) are PR-2 / PR-3.
//
// Bounded-loop discipline: Observe(digest) -> Choose -> Act(judge, draft-only)
// -> Verify(allowlist + cwe-bound + confidence + dedup) -> Record(atomic emit).
// The judge is UNTRUSTED external output: ONLY an allowlisted / digit-bounded
// class string ever reaches the store (no judge free-text crosses the boundary,
// which closes the second-order-injection path through the surface hook).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCapabilityFreeJudge } = require('../_lib/capability-free-claude');
const { withRegularFileFd } = require('../_lib/safe-read');
const { recordEmissions, isEmitted, loadState, DEFAULT_STATE_PATH } = require('./ghost-heartbeat-state');

const STORE_SCRIPT = path.join(__dirname, 'self-improve-store.js');

// The FROZEN drift taxonomy (mirrors
// library/sections/toolkit/stacks/ghost-protocol/volumes/drift-taxonomy.md).
// APPEND-ONLY: a signal name, once used, never changes (renaming resets
// convergence to count=1). Adding a class is a deliberate code change, by design.
const FROZEN_DRIFT_CLASSES = new Set([
  'recon-depth', 'plan-honesty', 'estimate-accuracy', 'dictionary-gap',
  'fail-silent', 'claim-false', 'contract-violation', 'scope-creep',
  'phase-close-skipped', 'workspace-hygiene-debt',
  'archive-cross-reference-blindness', 'lint-gate-not-run-pre-push',
]);
// The one open class: a real, BOUNDED CWE id (<= 4 digits). The bound is the
// injection fix — an unconstrained suffix flowed verbatim into a future session's
// context via the surface hook's candidate summary.
const CWE_CLASS_RE = /^cwe-class:[0-9]{1,4}$/;

const DEFAULT_MAX_DIGEST_CHARS = 24000;
const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_MAX_EMIT_PER_SESSION = 6;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024; // pre-digest size cap (DoS guard)
const MAX_TURN_CHARS = 2000;
const BUMP_TIMEOUT_MS = 10000; // bound the store-bump subprocess (no unbounded hang)

function isValidDriftClass(driftClass) {
  return typeof driftClass === 'string' && (FROZEN_DRIFT_CLASSES.has(driftClass) || CWE_CLASS_RE.test(driftClass));
}

function killed() {
  return process.env.GHOST_HEARTBEAT_DISABLED === '1';
}

// --- Observe: a bounded digest from a transcript jsonl ----------------------
// session_id is read from the in-transcript `sessionId` field (NOT the filename —
// a filename is attacker-cheap); there is NO filename/field mismatch CHECK -- the DOMINANT
// in-transcript sessionId is used (a file legitimately differs from its session via rotation).
function extractUserContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (b && b.type === 'text' && b.text) parts.push(b.text);
    else if (b && b.type === 'tool_result') {
      const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      parts.push(`[tool_result] ${String(c).slice(0, 300)}`);
    }
  }
  return parts.join(' ');
}

function readTranscriptText(transcriptPath) {
  // TOCTOU-safe (CodeRabbit #371): open ONCE O_NONBLOCK, fstat the BOUND fd, and
  // read from THAT fd — a name-based statSync-then-reopen leaves a swap window where
  // transcript_path becomes a FIFO and fs.readFileSync BLOCKS the auto-fired
  // detached child for the 60s judge window. Non-regular / absent -> '' ->
  // no-session-id downstream (fail-closed, no hang).
  return withRegularFileFd(transcriptPath, (fd, stat) => {
    if (stat.size <= MAX_TRANSCRIPT_BYTES) return fs.readFileSync(fd, 'utf8');
    // Oversized: read only the newest tail within budget (most drift-relevant).
    const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
    fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, stat.size - MAX_TRANSCRIPT_BYTES);
    const raw = buf.toString('utf8');
    // Drop the partial leading line (the tail was cut mid-line). No newline at all
    // (one giant line) -> '' -> fail-closed to no-session-id downstream.
    const nl = raw.indexOf('\n');
    return nl === -1 ? '' : raw.slice(nl + 1);
  }, '');
}

function buildDigest(transcriptPath, { maxChars = DEFAULT_MAX_DIGEST_CHARS } = {}) {
  let raw;
  try {
    raw = readTranscriptText(transcriptPath);
  } catch (err) {
    return { ok: false, reason: `read-error:${err && err.code}` };
  }
  const sidCounts = new Map();
  const turns = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.sessionId) sidCounts.set(o.sessionId, (sidCounts.get(o.sessionId) || 0) + 1);
    const msg = o.message;
    if (o.type === 'user' && msg) {
      const text = extractUserContent(msg.content);
      if (text) turns.push(`USER: ${text}`);
    } else if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'text' && b.text) turns.push(`ASSISTANT: ${b.text}`);
        else if (b && b.type === 'tool_use' && b.name) turns.push(`TOOL: ${b.name}`);
      }
    }
  }
  // The dedup key is the in-transcript harness sessionId, NOT the filename. A file
  // is named by a lineage anchor that LEGITIMATELY differs from the session that
  // produced its content (resume / compaction rotation) — dogfooded: a file named
  // <A> held 56519 lines of session <B> and 1 of <A>. Use the DOMINANT sessionId
  // (the bulk of the work), stable per file. It remains a self-asserted string in
  // an open-writable tree (the narrows-only residual; RFC threat model).
  let sessionId = null;
  let maxCount = 0;
  for (const [sid, n] of sidCounts) {
    if (n > maxCount) { maxCount = n; sessionId = sid; }
  }
  if (!sessionId) return { ok: false, reason: 'no-session-id' };
  // Newest-first within the char budget.
  let digest = '';
  for (let i = turns.length - 1; i >= 0; i--) {
    const next = `${turns[i].slice(0, MAX_TURN_CHARS)}\n`;
    if (digest.length + next.length > maxChars) break;
    digest = next + digest;
  }
  return { ok: true, sessionId, digest };
}

// --- Act: the judge prompt --------------------------------------------------
function buildJudgePrompt(digest) {
  const classes = `${[...FROZEN_DRIFT_CLASSES].join(', ')}, cwe-class:<NNNN>`;
  return [
    'You are a software-engineering DRIFT auditor. Read the SESSION DIGEST below and identify instances of process / quality drift.',
    'Classify each STRICTLY into one of these FROZEN classes (NEVER invent a class name):',
    classes,
    'Definitions: recon-depth=missed an existing implementation; plan-honesty=acted on an unprobed or false premise; claim-false=a claim contradicted runtime reality; fail-silent=a vacuous / false-green test or guard; scope-creep=work expanded beyond the plan; dictionary-gap=a routing / lexicon miss; contract-violation=a convention / contract was violated; phase-close-skipped=a phase closed without its gate; estimate-accuracy=an estimate off by >25%; cwe-class:<NNNN>=a security issue (use the CWE number, digits only).',
    'Be conservative — only report drift you can cite. Output ONLY a JSON array (no prose, no markdown fence):',
    '[{"class":"<one frozen class>","evidence":"<short quote from the digest>","confidence":<0..1>}]',
    'Output [] if there is no clear drift.',
    '',
    '=== SESSION DIGEST ===',
    digest,
  ].join('\n');
}

// Parse the judge text -> array. Fence-strip first (judges return fenced JSON; a
// missing fence-strip swallowed every verdict in v3.9), then bracket-slice +
// JSON.parse; fail-soft to [].
function parseJudgeJson(text) {
  if (typeof text !== 'string') return [];
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// --- Verify: the deterministic boundary guard -------------------------------
// Returns surviving drift-CLASS strings (allowlisted / cwe-bounded, deduped,
// capped). No judge free-text crosses this boundary.
function verifyJudgeOutput(items, { sessionId, state, minConfidence = DEFAULT_MIN_CONFIDENCE, maxEmit = DEFAULT_MAX_EMIT_PER_SESSION } = {}) {
  const survivors = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const driftClass = it.class;
    if (!isValidDriftClass(driftClass)) continue;                       // allowlist + cwe-bound
    if (typeof it.confidence !== 'number' || it.confidence < minConfidence) continue;
    if (typeof it.evidence !== 'string' || it.evidence.trim().length === 0) continue;
    if (seen.has(driftClass)) continue;                                 // intra-pass dedup
    if (state && isEmitted(state, sessionId, driftClass)) continue;     // cross-session dedup
    seen.add(driftClass);
    survivors.push(driftClass);
    if (survivors.length >= maxEmit) break;
  }
  return survivors;
}

// --- Record: emit via the store bump CLI ------------------------------------
// Best-effort emit. A failed bump is LOGGED (not silent): the (session, class)
// is still recorded as emitted, so the signal is lost for this session — tolerable
// for an advisory counter (it recurs next session; convergence is cross-session),
// but it must be observable, not swallowed.
function bumpSignal(signal) {
  const r = spawnSync(process.execPath, [STORE_SCRIPT, 'bump', '--signal', signal], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: BUMP_TIMEOUT_MS });
  if (r.error || r.status !== 0) {
    process.stderr.write(`[drift-audit] bump-failed signal=${signal} status=${r.status} ${r.error ? r.error.message : (r.stderr || '').slice(0, 120)}\n`);
  }
}

// --- Orchestrate ------------------------------------------------------------
function auditTranscript({ transcriptPath, judgeFn, emitFn, statePath = DEFAULT_STATE_PATH, lockPath, log = () => {} } = {}) {
  if (killed()) { log('killswitch'); return { ok: false, reason: 'killswitch', emitted: [] }; }
  const dg = buildDigest(transcriptPath);
  if (!dg.ok) { log('digest-fail', dg.reason); return { ok: false, reason: dg.reason, emitted: [] }; }
  const judge = judgeFn || ((prompt) => runCapabilityFreeJudge({ prompt }));
  const jres = judge(buildJudgePrompt(dg.digest));
  if (!jres || !jres.ok) { log('judge-fail', jres && jres.reason); return { ok: false, reason: (jres && jres.reason) || 'judge-fail', emitted: [] }; }
  const state = loadState(statePath);
  const survivors = verifyJudgeOutput(parseJudgeJson(jres.text), { sessionId: dg.sessionId, state });
  if (survivors.length === 0) { log('no-drift', dg.sessionId); return { ok: true, reason: 'no-drift', emitted: [] }; }
  const emit = emitFn || ((driftClass) => bumpSignal(`drift:${driftClass}`));
  // writeAtomic can throw (disk-full / permission). Keep the producer's fail-soft
  // contract (a carrier hook must never see a throw) — catch + return cleanly.
  let rec;
  try {
    rec = recordEmissions({ sessionId: dg.sessionId, classes: survivors, reviewedAt: new Date().toISOString(), emitFn: emit, statePath, lockPath });
  } catch (err) {
    log('state-write-error', err && err.message);
    return { ok: false, reason: 'state-write-error', emitted: [] };
  }
  if (!rec.ok) { log('lock-timeout', dg.sessionId); return { ok: false, reason: rec.reason, emitted: [] }; }
  log('emitted', { sessionId: dg.sessionId, classes: rec.value });
  return { ok: true, emitted: rec.value };
}

module.exports = {
  buildDigest, buildJudgePrompt, parseJudgeJson, verifyJudgeOutput,
  isValidDriftClass, auditTranscript, FROZEN_DRIFT_CLASSES, CWE_CLASS_RE,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--transcript');
  if (i === -1 || !argv[i + 1]) {
    console.error('Usage: drift-audit.js --transcript <session.jsonl>');
    process.exit(1);
  }
  const res = auditTranscript({
    transcriptPath: argv[i + 1],
    log: (e, d) => console.error(`[drift-audit] ${e}`, d !== undefined ? JSON.stringify(d) : ''),
  });
  console.log(JSON.stringify(res));
  // Fail-open: advisory producer never returns non-zero (a carrier must not break).
  process.exit(0);
}
