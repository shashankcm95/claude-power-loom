#!/usr/bin/env node

// Self-improve counter + pending-queue store. Backs the auto self-improve
// loop introduced in H.4.1.
//
// Architecture: continuous capture (Stop hook bumps counters) + periodic
// consolidation (PreCompact + N-th turn) + batched approval (UserPromptSubmit
// hook on first prompt of session). User no longer needs to invoke /self-improve
// manually for low-risk graduations; the loop runs at multiple natural
// breakpoints. Manual /self-improve still works and reads the same queue.
//
// Risk asymmetry — auto-graduate cheap-to-reverse stuff (observation logging,
// memory consolidation); always prompt for load-bearing stuff (rule writes,
// agent evolution). Same shape as the prompt-pattern-store 5+-approval auto-
// apply pattern.
//
// Subcommands:
//   bump --signal <type:value> [--n <count>]   — increment counter; default n=1
//   bump-turn                                  — increment per-turn counter (Stop hook)
//   scan [--force]                             — apply thresholds, write pending queue, auto-graduate low-risk
//   pending [--json]                           — list pending candidates
//   dismiss --id <id>                          — mark candidate dismissed
//   promote --id <id>                          — execute promotion (low-risk only; medium/high need /self-improve)
//   reset                                      — wipe counters (test fixture)
//   stats                                      — counter summary (debugging)
//
// Files (under $HOME/.claude/):
//   self-improve-counters.json  — running counts per signal
//   checkpoints/self-improve-pending.json   — consolidated approval queue
//   checkpoints/observations.log            — append-only audit trail of low-risk auto-graduations

const fs = require('fs');
const path = require('path');
const os = require('os');
// HT.audit-followup: crypto.randomBytes was used by inline writeAtomic, now in _lib/atomic-write.js

const HOME = os.homedir();
const COUNTERS_PATH = path.join(HOME, '.claude', 'self-improve-counters.json');
const PENDING_PATH = path.join(HOME, '.claude', 'checkpoints', 'self-improve-pending.json');
const OBSERVATIONS_LOG = path.join(HOME, '.claude', 'checkpoints', 'observations.log');

// Reuse the shared lock primitive from agent-team scripts when available.
// H.5.3 (CS-3 hacker.kai H-1 + code-reviewer.blair H-2): emit a stderr warning
// when the fallback no-op path is taken — silent degradation of an atomicity
// guarantee was the load-bearing complaint. Operators now have visibility.
//
// HT.1.8: collapsed 3-tier require fallback (was: ~/.claude/... → __dirname/...
// → no-op) to single-tier __dirname-relative require. The explicit ~/.claude/...
// path was redundant — `__dirname`-relative resolution covers both deployed-
// marketplace install (script at ~/.claude/packages/kernel/spawn-state/) and local-checkout
// (script at ~/Documents/claude-toolkit/scripts/) scenarios.
let withLock;
let _lockFallbackWarned = false;
function _warnLockFallback() {
  if (_lockFallbackWarned) return;
  _lockFallbackWarned = true;
  process.stderr.write(
    '[self-improve-store] WARNING: lock primitive (_lib/lock.js) unreachable; ' +
    'using no-op fallback. Concurrent bump/scan operations may corrupt state. ' +
    'Install or symlink the agent-team scripts to enable real locking.\n'
  );
}
try {
  withLock = require('../_lib/lock').withLock;
} catch {
  withLock = (_lockPath, fn) => { _warnLockFallback(); return fn(); };
}

// Thresholds (tunable; tracked in BACKLOG.md for future tuning)
const THRESHOLDS = {
  observation: 3,    // count >= 3 in any session → noted internally (no candidate yet)
  candidate: 5,      // count >= 5 → queued for approval
  autoGraduate: 10,  // count >= 10 AND low-risk → auto-graduated
};
const SCAN_TURN_INTERVAL = 30; // run scan every Nth turn inside Stop hook

// Risk taxonomy
const KIND_RISK = {
  'observation-log': 'low',          // append to observations.log — pure record
  'memory-consolidation': 'low',     // append to MEMORY.md — easy to undo
  'skill-candidate': 'medium',       // forge a skill scaffold — needs human review
  'rule-candidate': 'high',          // write to rules/toolkit/ — load-bearing
  'agent-evolution': 'high',         // rewrite persona prompt — load-bearing
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function loadCounters() {
  // H.5.3 (CS-3 kai H-1 + blair H-3): if the file exists but parse fails, it's
  // either corrupted or malformed. Quarantine to `<path>.corrupt-<ISO>` BEFORE
  // returning empty defaults — preserves forensics and prevents silent
  // history-wipe on the next writeAtomic. If the file simply doesn't exist
  // (first run, or after reset), return defaults with no quarantine.
  try {
    const raw = fs.readFileSync(COUNTERS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Expected on first run.
    } else {
      // Parse error or read error on existing file → quarantine.
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const quarantine = `${COUNTERS_PATH}.corrupt-${stamp}`;
        fs.renameSync(COUNTERS_PATH, quarantine);
        process.stderr.write(`[self-improve-store] WARNING: counters file unreadable; quarantined to ${quarantine}. Error: ${err.message}\n`);
      } catch { /* best-effort — if quarantine fails, fall through to fresh state */ }
    }
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      turnCounter: 0,
      signals: {},
      lastScanAt: null,
      lastScanTurn: 0,
    };
  }
}

function loadPending() {
  // H.5.3: same quarantine-on-corruption shape as loadCounters above.
  try {
    const raw = fs.readFileSync(PENDING_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const quarantine = `${PENDING_PATH}.corrupt-${stamp}`;
        fs.renameSync(PENDING_PATH, quarantine);
        process.stderr.write(`[self-improve-store] WARNING: pending file unreadable; quarantined to ${quarantine}. Error: ${err.message}\n`);
      } catch { /* best-effort */ }
    }
    return {
      version: 1,
      candidates: [],
      lastShownAt: null,
      lastShownInSessionId: null,
    };
  }
}

// HT.audit-followup H4: writeAtomic migrated to `_lib/atomic-write.js` shared
// primitive. Prior inline impl (H.5.3 CS-3 blair H-1 + kai L-1) used the
// hardened pid+hrtime+crypto pattern; extracted at audit-followup time
// because grep surfaced 12 substrate sites using the unhardened pid-only
// pattern. 3 highest-touched sites (registry.js writeStore + pattern-recorder.js
// saveStore + session-self-improve-prompt.js writeAtomic) migrate alongside.
const { writeAtomic } = require('../_lib/atomic-write');
// Control-char hygiene reuses the canonical lint-safe primitives (char-code scans, not
// /[control]/ regexes, which trip eslint no-control-regex): sanitizeForJsonl TRANSFORMS
// (strip/replace) for the evidence quote; hasControlChars REJECTS for the sid key.
const { sanitizeForJsonl } = require('../_lib/sanitize');
const { hasControlChars } = require('../_lib/free-string-checks');

// --- Drift-evidence triage (2026-06-23) -------------------------------------
// A per-occurrence evidence ring on a counter signal entry + a cross-window
// convergence gate. The ring lets a converged `drift:*` candidate be TRIAGED on
// real evidence (the judge's short quote + the session it came from); the gate stops
// a single intense arc (which compaction can split into several sessionIds) from
// triple-counting one root cause into a HIGH-risk rule-candidate.

const MAX_EVIDENCE_SAMPLES = 10;   // bounded ring: keep the newest N per signal
const MAX_EVIDENCE_LEN = 500;      // bound a single quote (DoS guard + readable triage)
const ONE_DAY_MS = 86400000;
const MIN_CONVERGENCE_SPAN_MS = ONE_DAY_MS; // a drift class converges only once its
                                            // firstSeen..lastSeen span exceeds this.
const MAX_SAMPLE_SID_LEN = 128;

// The egress scrub module is the SAME secret scrubber the egress PR-body path uses, so the
// known-secret-class list can never drift out of sync (the secret-class-drift lesson).
// DELIBERATE outward require (spawn-state -> egress): scrubEmitDiff is the deeper module;
// reimplementing a thinner scrub here would be a second drift surface. Lazy-required so the
// hot bumpBatch path (which carries NO evidence) never loads egress, and so an unreachable
// module fails CLOSED (drop the evidence) rather than persisting it raw. FORWARD-CONTRACT:
// bumpBatch carries no evidence today; if it ever does, move the scrub into a shared
// appendSample helper both paths call. (A future cleanup may extract scrubEmitDiff into
// kernel/_lib so this require points inward — tracked, not blocking.)
let _scrubMod;           // memoized: the egress/scrub module | null (null => unreachable)
let _scrubWarned = false;
function getScrubMod() {
  if (_scrubMod !== undefined) return _scrubMod;
  try {
    _scrubMod = require('../egress/scrub');
  } catch {
    _scrubMod = null;
    if (!_scrubWarned) {
      _scrubWarned = true;
      process.stderr.write('[self-improve-store] WARNING: egress/scrub unreachable; drift evidence is DROPPED (never persisted raw).\n');
    }
  }
  return _scrubMod;
}

// A >=32-char base64-alphabet run is an entropy-token candidate (mirrors scrub.js's
// ENTROPY_TOKEN). Hex digests/git shas use a 16-symbol alphabet (entropy < 4.0 bits/char)
// so they stay under the threshold and are NOT redacted; only true high-entropy
// (base64-alphabet) secrets exceed it.
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/=_-]{32,}/g;

// VALIDATE-hacker H1: scrubEmitDiff's entropy pass only fires on `+`-prefixed DIFF lines, so
// it is INERT on a prose evidence quote — a high-entropy NON-canonical credential (a DB/SaaS
// password the prefix classes don't match) would survive. Run the entropy net over the WHOLE
// quote here so the prose path gets the same novel-secret coverage the diff path gets.
function redactHighEntropyTokens(mod, s) {
  if (!mod || typeof mod.shannonEntropy !== 'function' || typeof mod.ENTROPY_BITS !== 'number') return s;
  return s.replace(ENTROPY_TOKEN_RE, (tok) => (mod.shannonEntropy(tok) >= mod.ENTROPY_BITS ? '[REDACTED-ENTROPY]' : tok));
}

const MAX_EVIDENCE_STDIN_BYTES = 64 * 1024; // bound the stdin read (DoS guard)
const MAX_STDIN_EAGAIN_SPINS = 10000;       // bounded retry on a not-yet-ready non-blocking pipe
// Read the evidence quote from STDIN (fd 0), bounded + fail-open. Evidence (an untrusted judge
// quote that may carry a secret) is passed on stdin, NOT argv — argv is visible in `ps` /
// `/proc/<pid>/cmdline` to other local processes BEFORE the store scrubs it (the same channel
// the egress path closes by using JSON-on-stdin). The producer provides it via spawnSync `input`
// (the full <=2KB payload is pre-buffered before the child reads). isTTY guard: a manual
// `--evidence-stdin` with no piped input returns '' (no sample) rather than blocking on a tty.
// Bounded read so a crafted multi-GB pipe cannot exhaust memory; sanitizeEvidence re-bounds to
// MAX_EVIDENCE_LEN. EAGAIN handling (VALIDATE-hacker M1): a child-spawned pipe fd0 can be
// non-blocking, so a read before the bytes land throws EAGAIN — RETRY (bounded, so a
// never-delivering stream cannot spin forever) and KEEP any partial read, rather than letting
// EAGAIN drop already-read bytes.
function readStdinEvidence() {
  if (process.stdin.isTTY) return '';
  const buf = Buffer.alloc(MAX_EVIDENCE_STDIN_BYTES);
  let total = 0;
  let spins = 0;
  while (total < MAX_EVIDENCE_STDIN_BYTES) {
    let bytes;
    try {
      bytes = fs.readSync(0, buf, total, MAX_EVIDENCE_STDIN_BYTES - total, null);
    } catch (err) {
      if (err && err.code === 'EAGAIN' && spins++ < MAX_STDIN_EAGAIN_SPINS) continue;
      break; // EOF / closed / other error / spin budget exhausted -> stop, keep the partial read
    }
    if (bytes === 0) break; // EOF
    total += bytes;
    spins = 0;              // progress resets the spin budget
  }
  return buf.toString('utf8', 0, total);
}

// Sanitize an UNTRUSTED judge evidence quote before persisting it: scrub known secrets +
// high-entropy tokens, strip control chars, collapse whitespace, bound length. Returns '' for
// a nullish/empty input OR when the scrubber is unreachable (fail-closed: drop rather than
// persist raw). `mod` is injectable for testability (a test passes `null` to exercise the
// unreachable fail-closed path). getScrubMod() is resolved INSIDE the body (after the
// empty-input early-return) so an evidence-less bump never loads egress (CodeRabbit).
function sanitizeEvidence(raw, mod) {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  const m = mod !== undefined ? mod : getScrubMod();
  if (!m || typeof m.scrubEmitDiff !== 'function') return ''; // unreachable -> drop, never raw
  // Pre-bound the scrub input (a pathological multi-KB quote) before the O(n) passes.
  let s = raw.length > MAX_EVIDENCE_LEN * 4 ? raw.slice(0, MAX_EVIDENCE_LEN * 4) : raw;
  s = m.scrubEmitDiff(s);              // canonical classes + decodable single-base64
  s = redactHighEntropyTokens(m, s);  // novel high-entropy tokens (H1: prose has no `+` lines)
  s = sanitizeForJsonl(s).replace(/\s+/g, ' ').trim();
  if (s.length > MAX_EVIDENCE_LEN) s = s.slice(0, MAX_EVIDENCE_LEN);
  return s;
}

// sessionId is a self-asserted field; bound length + reject control chars (it becomes a
// stored key in the ring). An out-of-shape value drops to null (the sample still records,
// just without a session anchor).
function sanitizeSampleSid(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (hasControlChars(raw)) return null;
  return raw.length > MAX_SAMPLE_SID_LEN ? raw.slice(0, MAX_SAMPLE_SID_LEN) : raw;
}

// at is an ISO timestamp; an unparseable value drops to null (caller substitutes `now`). A
// parseable-but-lenient value (whitespace-padded / non-ISO) is NORMALIZED to canonical ISO
// so the stored field is always a clean, fixed-shape timestamp (VALIDATE-hacker L1).
function sanitizeSampleAt(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Immutable append to the bounded ring (newest-last). Each element is frozen so a later
// bump can never mutate a prior sample (the read-back/update immutability rule that has
// bitten this codebase twice). Returns a NEW array; never mutates `prevSamples`.
function appendSample(prevSamples, sample) {
  const ring = Array.isArray(prevSamples) ? prevSamples : [];
  const next = [...ring, Object.freeze(sample)];
  return next.length > MAX_EVIDENCE_SAMPLES ? next.slice(next.length - MAX_EVIDENCE_SAMPLES) : next;
}

// Cross-window gate: a drift class converges only once its observed span exceeds
// MIN_CONVERGENCE_SPAN_MS. Span-only (NOT distinct-sessionId): compaction rotates the
// in-transcript sessionId, so ONE arc can carry several sids — the wall-clock span is the
// robust discriminator. Malformed/absent timestamps -> NaN -> false (fail-closed: defer a
// record we cannot date rather than graduate it). ADVISORY-ONLY (integrity != provenance,
// VALIDATE-hacker M1): firstSeen/lastSeen are read from the open-writable counters file and
// are NOT authenticated, so a local writer could forge convergence — tolerable because a
// converged drift: candidate is risk:high and NEVER auto-graduates (it only surfaces for
// human /self-improve triage). If this gate ever drives an ACTION, the timestamps must come
// from a kernel-owned/authenticated writer the actor cannot set.
function hasConvergenceSpan(entry) {
  const a = Date.parse(entry && entry.firstSeen);
  const b = Date.parse(entry && entry.lastSeen);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (b - a) > MIN_CONVERGENCE_SPAN_MS;
}

// Ghost Heartbeat W1 (2026-06-19): the SINGLE classification + convergence-
// threshold chokepoint. Returns { kind, risk, candidateThreshold } for a signal.
// The high-value drift families (`drift:`, `rule-recurrence:`) converge at 3 (the
// ghost-protocol taxonomy threshold) and classify as high-risk `rule-candidate`
// so they surface for /self-improve and can NEVER auto-bury. Every other signal
// keeps its prior kind + the default candidate threshold; the catch-all stays
// `observation-log`/low so an unknown or positive signal (e.g.
// `improvement-effectiveness:` — "the rule WORKED") cannot enter the always-prompt
// path (closes the 2026-05-30 frequency-noise vector by construction).
const DRIFT_FAMILY_CANDIDATE_THRESHOLD = 3;

function signalPolicy(signal) {
  const isDrift = signal.startsWith('drift:');
  if (isDrift || signal.startsWith('rule-recurrence:')) {
    return {
      kind: 'rule-candidate',
      risk: KIND_RISK['rule-candidate'],
      candidateThreshold: DRIFT_FAMILY_CANDIDATE_THRESHOLD,
      // Only `drift:*` gets the cross-window convergence gate (a single intense arc can
      // triple-count one root cause). `rule-recurrence:*` is a different family — a
      // graduated rule that keeps failing — and should surface PROMPTLY, so it is NOT gated.
      requiresCrossWindow: isDrift,
    };
  }
  let kind;
  if (signal.startsWith('command:')) kind = 'skill-candidate';
  else if (signal.startsWith('pattern:')) kind = 'memory-consolidation';
  else if (signal.startsWith('rule:')) kind = 'rule-candidate';
  else if (signal.startsWith('agent:')) kind = 'agent-evolution';
  // filePath:, skill:, improvement-effectiveness:, and any unknown signal fall
  // through to the unchanged low-risk catch-all.
  else kind = 'observation-log';
  return { kind, risk: KIND_RISK[kind] || 'medium', candidateThreshold: THRESHOLDS.candidate, requiresCrossWindow: false };
}

// Back-compat shim: the kind half of signalPolicy. Exported + relied on by
// signalToProposedAction/tests — delegates so classification has ONE source.
function inferKindFromSignal(signal) {
  return signalPolicy(signal).kind;
}

function signalToSummary(signal, entry) {
  const value = signal.includes(':') ? signal.slice(signal.indexOf(':') + 1) : signal;
  return `${value} observed ${entry.count} times since ${entry.firstSeen.slice(0, 10)}`;
}

function signalToProposedAction(signal, kind) {
  // v2.8.2 Fix-3 — differentiate observation-log actions by signal source.
  // The pre-Fix-3 text was tautological ("Log to observations.log") — it
  // described the destination (which is the side-effect anyway) instead of
  // the LEARNING outcome the graduation represents. The new texts surface
  // what the observer should DO with the recurring signal — making the
  // first-prompt-of-session reminder (UserPromptSubmit, idempotent per
  // session_id) + cmdPending readout actionable rather than self-describing.
  if (signal.startsWith('drift:')) {
    return 'Converged drift class — triage via /self-improve to graduate a preventive rule';
  }
  if (signal.startsWith('rule-recurrence:')) {
    return 'Graduated rule is RECURRING (failing) — retune or escalate via /self-improve, not a fresh rule';
  }
  if (kind === 'observation-log') {
    if (signal.startsWith('filePath:')) {
      return 'Recurring workspace file — consider adding to project MEMORY.md or workspace allowlist';
    }
    if (signal.startsWith('skill:')) {
      return 'Frequent skill invocation — surface for prompt-pattern enrichment or skill-forge review';
    }
    return 'Surface as a first-prompt-of-session reminder via the session-self-improve-prompt hook';
  }
  if (kind === 'memory-consolidation') return 'Append to project MEMORY.md as recurring pattern';
  if (kind === 'skill-candidate') return 'Consider forging a skill via skill-forge';
  if (kind === 'rule-candidate') return 'Promote to ~/.claude/rules/toolkit/ via /self-improve';
  if (kind === 'agent-evolution') return 'Update persona prompt via /evolve';
  return 'Review for promotion';
}

function newCandidateId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(16).slice(2, 8);
  return `cand-${ts}-${rand}`;
}

function cmdBump(args) {
  const signal = args.signal;
  // A non-STRING signal means an argv mis-parse (e.g. `--signal` with no value parsed to the
  // boolean `true`) — reject it rather than record a junk `true` signal (VALIDATE-hacker L1).
  if (!signal || typeof signal !== 'string') { console.error('Usage: bump --signal <type:value> [--n <count>] [--evidence-stdin --session <sid> --at <iso>]'); process.exit(1); }
  const n = parseInt(args.n || '1', 10);
  if (!Number.isFinite(n) || n < 1) { console.error('--n must be a positive integer'); process.exit(1); }

  // Optional per-occurrence evidence — the drift-audit producer threads the judge's
  // (scrubbed) quote + the session it came from so a converged drift candidate is
  // TRIAGEABLE. Evidence arrives on STDIN (never argv -> no process-table exposure of a
  // possibly-secret-bearing quote); --evidence-stdin opts in. Evidence-less bumps (every
  // non-drift caller) are byte-for-byte unchanged.
  const evidence = args['evidence-stdin'] ? sanitizeEvidence(readStdinEvidence()) : '';
  const sessionId = sanitizeSampleSid(args.session);

  withLock(COUNTERS_PATH + '.lock', () => {
    const counters = loadCounters();
    const now = new Date().toISOString();
    const prev = counters.signals[signal] || { count: 0, firstSeen: now, lastSeen: now };
    // Immutable wrt the loaded state: `prev` and the prior `signals` map are never mutated — a
    // NEW entry object is built (and `entry.samples` is set on it BEFORE it is placed in a NEW
    // signals map below, while still locally owned).
    const entry = { ...prev, count: prev.count + n, lastSeen: now };
    if (evidence) {
      const at = sanitizeSampleAt(args.at) || now;
      entry.samples = appendSample(prev.samples, { evidence, sessionId, at });
    }
    counters.signals = { ...counters.signals, [signal]: entry };
    writeAtomic(COUNTERS_PATH, counters);
  });
  console.log(JSON.stringify({ action: 'bump', signal, n }));
}

function cmdBumpTurn() {
  let shouldScan = false;
  let turnCounter = 0;
  withLock(COUNTERS_PATH + '.lock', () => {
    const counters = loadCounters();
    counters.turnCounter += 1;
    turnCounter = counters.turnCounter;
    if (counters.turnCounter - counters.lastScanTurn >= SCAN_TURN_INTERVAL) {
      shouldScan = true;
    }
    writeAtomic(COUNTERS_PATH, counters);
  });
  console.log(JSON.stringify({ action: 'bump-turn', turnCounter, shouldScan }));
}

/**
 * Core scan logic — extracted helper used by both cmdScan and bumpBatch's
 * inline scan path. Operates on already-loaded counters + pending; mutates
 * `pending.candidates` in place; returns { newCandidates, autoGraduated,
 * promotedFromPending } counts.
 *
 * GAP-H FIX (v2.7.0): replaces the pre-fix `knownSignatures = new Set(...)`
 * predicate that treated first-candidate-creation as terminal (a signal
 * could ride from count=5 → count=∞ but never trigger the count≥10 + low-risk
 * auto-graduation path). The new logic is STATUS-AWARE:
 *
 *   - Terminal states (dismissed / promoted / auto-graduated) → skip entirely
 *     (preserved invariant; user choice is sticky per KB
 *     architecture/discipline/stability-patterns Steady-State).
 *   - Pending candidates → eligible for transition. If count crosses the
 *     auto-grad threshold + risk='low', flip status in place (do NOT
 *     create a duplicate candidate). Also refresh occurrences + lastSeen
 *     for observability (per T9).
 *   - Unknown signal at count≥candidate → new candidate (preserved logic).
 *
 * This eliminates the duplicate inline-scan body at the prior line 332 in
 * bumpBatch's shouldScan branch — single source of truth (KB single-
 * responsibility / DRY).
 *
 * RESIDUAL RISK (v2.7.0 code-reviewer HIGH #2; documented not blocked):
 * Under the no-op lock fallback path (when `agent-team/_lib/lock.js` is
 * absent — emits stderr warning at module load), a concurrent scan could
 * read pending.json BEFORE this scan's writeAtomic completes, see the
 * pending candidate as still status='pending', and call executeGraduation
 * a second time → duplicate line in observations.log. NOT a regression
 * vs v2.6.1 (the same race existed in the old inline-scan code). Real
 * fix path: hard-require the lock primitive at module load + fail loud
 * if missing. Follow-up ticket; out of scope for GAP-H.
 *
 * @param {object} counters - loaded counters state
 * @param {object} pending  - loaded pending state (mutated in place)
 * @returns {{newCandidates: number, autoGraduated: number, promotedFromPending: number}}
 */
function _runScan(counters, pending) {
  const knownBySignal = new Map(pending.candidates.map((c) => [c.signal, c]));
  let newCount = 0;
  let autoGradCount = 0;
  let promotedFromPendingCount = 0;
  const now = new Date().toISOString();

  for (const [signal, entry] of Object.entries(counters.signals)) {
    // Ghost W1: one signalPolicy lookup drives BOTH the per-class candidate
    // threshold (drift-family converges at 3) and the classification below.
    const policy = signalPolicy(signal);
    if (entry.count < policy.candidateThreshold) continue;

    const existing = knownBySignal.get(signal);

    if (existing) {
      // Terminal states — never revisit. Sticky-dismiss / sticky-promote /
      // sticky-auto-graduated all converge on this guard (T5, T6, T4).
      if (existing.status === 'dismissed' ||
          existing.status === 'promoted' ||
          existing.status === 'auto-graduated') {
        continue;
      }

      // Non-terminal: 'pending'. Refresh observability fields (T9), then
      // re-derive kind/risk from the CURRENT classification (Ghost W1 migration):
      // a candidate stored under an old classification (e.g. a `drift:` signal
      // once filed as observation-log/low) is re-classified so it can never
      // auto-bury under a stale low-risk field.
      existing.occurrences = entry.count;
      existing.lastSeen = entry.lastSeen;
      // Surface the evidence ring for triage (the elements are frozen at the bump site,
      // so the slice shares immutable values — safe to expose on the candidate).
      if (Array.isArray(entry.samples)) existing.samples = entry.samples.slice(-MAX_EVIDENCE_SAMPLES);
      if (existing.kind !== policy.kind) {
        existing.kind = policy.kind;
        existing.proposedAction = signalToProposedAction(signal, policy.kind);
      }
      existing.risk = policy.risk;
      if (policy.risk === 'low' && entry.count >= THRESHOLDS.autoGraduate) {
        existing.status = 'auto-graduated';
        existing.autoGraduatedAt = now;
        executeGraduation(existing);
        promotedFromPendingCount++;
      }
      continue;
    }

    // Cross-window convergence gate (drift-family only): defer a signal that reached its
    // count threshold inside a single arc (span <= 1 day). It stays in counters and
    // re-evaluates on a later scan once it recurs across a day boundary — DEFERRED, not
    // dropped (the evidence ring is preserved). Only NEW candidates are gated; an
    // already-pending candidate took the `existing` branch above and is never un-converged.
    if (policy.requiresCrossWindow && !hasConvergenceSpan(entry)) continue;

    // Unknown signal at >= its candidate threshold — new candidate.
    const candidate = {
      id: newCandidateId(),
      kind: policy.kind,
      signal,
      occurrences: entry.count,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      risk: policy.risk,
      // Per-occurrence evidence ring (frozen elements) — surfaced in `pending --json`
      // so a triage reads the judge's actual quotes, not just a class name + a count.
      samples: Array.isArray(entry.samples) ? entry.samples.slice(-MAX_EVIDENCE_SAMPLES) : [],
      summary: signalToSummary(signal, entry),
      proposedAction: signalToProposedAction(signal, policy.kind),
      status: 'pending',
      createdAt: now,
    };
    if (policy.risk === 'low' && entry.count >= THRESHOLDS.autoGraduate) {
      candidate.status = 'auto-graduated';
      candidate.autoGraduatedAt = now;
      executeGraduation(candidate);
      autoGradCount++;
    } else {
      newCount++;
    }
    pending.candidates.push(candidate);
  }

  return {
    newCandidates: newCount,
    autoGraduated: autoGradCount,
    promotedFromPending: promotedFromPendingCount,
  };
}

function cmdScan() {
  let result;
  withLock(COUNTERS_PATH + '.lock', () => {
    withLock(PENDING_PATH + '.lock', () => {
      const counters = loadCounters();
      const pending = loadPending();
      const scanCounts = _runScan(counters, pending);
      counters.lastScanAt = new Date().toISOString();
      counters.lastScanTurn = counters.turnCounter;
      writeAtomic(COUNTERS_PATH, counters);
      writeAtomic(PENDING_PATH, pending);

      result = {
        action: 'scan',
        newCandidates: scanCounts.newCandidates,
        autoGraduated: scanCounts.autoGraduated,
        promotedFromPending: scanCounts.promotedFromPending,
        totalPending: pending.candidates.filter((c) => c.status === 'pending').length,
      };
    });
  });
  console.log(JSON.stringify(result));
}

// HT.1.14: Batched in-process call. Replaces 22-spawnSync worst-case from
// auto-store-enrichment.js bumpSelfImproveCounters (1 bump-turn + up to 20
// bump-signal + 1 conditional scan). Single Node module-load instead of 22
// subprocess spawns. ADR-0001 fail-soft invariant 2 preserved by caller's
// try/catch + log-on-error; this function does NOT swallow errors itself.
//
// Single withLock for counter mutations (better atomicity than 22 separate
// lock acquisitions). Conditional scan acquires its own nested-lock as in
// cmdScan (preserves the same lock-acquisition order: COUNTERS_PATH first,
// PENDING_PATH nested).
//
// @param {string[]} signals - array of signals (each "type:value" form); up to 20 processed
// @returns {{shouldScan: boolean, signalsBumped: number, scanResult: object|null, turnCounter: number}}
function bumpBatch(signals) {
  let shouldScan = false;
  let signalsBumped = 0;
  let scanResult = null;
  let turnCounter = 0;
  const sigs = Array.isArray(signals) ? signals.slice(0, 20) : [];

  // v2.8.2 — lock-collapse refactor (v2.7.0 code-reviewer HIGH #1).
  // PRE-COLLAPSE shape: acquire COUNTERS lock → bump+write+release →
  //                    [race window] →
  //                    re-acquire COUNTERS+PENDING locks → scan+write+release.
  // The release-then-reacquire created a window where, under the no-op lock
  // fallback (rare: when withLock falls back to fn() without a real lock),
  // two concurrent bumpBatch calls could both observe shouldScan=true and
  // both enter the scan branch, double-firing graduations + double-appending
  // to observations.log.
  //
  // POST-COLLAPSE: single outer COUNTERS lock spans the whole operation
  // (bump + write + optionally nested PENDING lock for scan). No release-then-
  // reacquire; no race window. The nested PENDING lock preserves the same
  // acquisition order as cmdScan (COUNTERS first, PENDING nested) so deadlock
  // risk is unchanged.
  //
  // Lock-acquisition-order invariant (also enforced in cmdScan at line ~334):
  //   COUNTERS_PATH.lock (outer) → PENDING_PATH.lock (inner)
  // Reversing this order would deadlock under real (non-fallback) locking.
  withLock(COUNTERS_PATH + '.lock', () => {
    const counters = loadCounters();
    const now = new Date().toISOString();

    counters.turnCounter += 1;
    turnCounter = counters.turnCounter;
    if (counters.turnCounter - counters.lastScanTurn >= SCAN_TURN_INTERVAL) {
      shouldScan = true;
    }

    for (const signal of sigs) {
      const entry = counters.signals[signal] || { count: 0, firstSeen: now, lastSeen: now };
      entry.count += 1;
      entry.lastSeen = now;
      counters.signals[signal] = entry;
      signalsBumped++;
    }

    if (shouldScan) {
      // Nested PENDING lock acquisition. The COUNTERS object in scope above
      // is the SAME instance the scan mutates — no re-load needed. The
      // pending object is loaded fresh inside the nested lock.
      withLock(PENDING_PATH + '.lock', () => {
        const pending = loadPending();
        const scanCounts = _runScan(counters, pending);
        counters.lastScanAt = new Date().toISOString();
        counters.lastScanTurn = counters.turnCounter;
        writeAtomic(PENDING_PATH, pending);
        scanResult = {
          newCandidates: scanCounts.newCandidates,
          autoGraduated: scanCounts.autoGraduated,
          promotedFromPending: scanCounts.promotedFromPending,
          totalPending: pending.candidates.filter((c) => c.status === 'pending').length,
        };
      });
    }

    // Single write of counters at the end — captures both the bump and
    // (if shouldScan) the lastScanAt/lastScanTurn updates atomically.
    writeAtomic(COUNTERS_PATH, counters);
  });

  return { shouldScan, signalsBumped, scanResult, turnCounter };
}

// H.5.3 (CS-3 hacker.kai H-2): executeGraduation appends to a shared log.
// Lines longer than PIPE_BUF (512 bytes on Darwin, 4096 on Linux) lose append
// atomicity → concurrent writers can interleave bytes mid-line → audit log
// corrupted. The `summary` field is built from raw signal text including
// arbitrary-length file paths, so lines can exceed the limit. Now: lock the
// append + truncate over-long lines with an explicit marker. The lock uses
// the OBSERVATIONS_LOG itself + `.lock` suffix; same pattern as elsewhere.
const OBSERVATION_LINE_MAX = 256; // safely under Darwin's PIPE_BUF (512)
function executeGraduation(candidate) {
  // v2.8.2 Fix-3 — log line now includes proposedAction so readers see WHAT
  // the recurring signal suggests doing, not just THAT it recurred. Pre-Fix-3
  // the line had `kind | summary | id` which echoed the destination implicitly
  // (a candidate logged to observations.log with kind='observation-log' said
  // nothing new). The proposedAction field is the load-bearing learning text.
  const safeAction = candidate.proposedAction ? candidate.proposedAction.replace(/\n/g, ' ') : '(no action)';
  let line = `[${candidate.createdAt}] ${candidate.kind} | ${candidate.summary} | action=${safeAction} | id=${candidate.id}\n`;
  if (line.length > OBSERVATION_LINE_MAX) {
    line = line.slice(0, OBSERVATION_LINE_MAX - 16) + '...[truncated]\n';
  }
  withLock(OBSERVATIONS_LOG + '.lock', () => {
    try {
      fs.mkdirSync(path.dirname(OBSERVATIONS_LOG), { recursive: true });
      fs.appendFileSync(OBSERVATIONS_LOG, line);
    } catch {
      // Best-effort — observations.log is informational, not load-bearing.
    }
  });
}

function cmdPending(args) {
  const pending = loadPending();
  const queued = pending.candidates.filter((c) => c.status === 'pending' || c.status === 'auto-graduated');
  if (args.json) {
    console.log(JSON.stringify({ count: queued.length, candidates: queued }, null, 2));
    return;
  }
  if (queued.length === 0) {
    console.log('No pending self-improvement candidates.');
    return;
  }
  console.log(`${queued.length} pending candidate(s):`);
  for (const c of queued) {
    const marker = c.status === 'auto-graduated' ? '[auto] ' : '';
    console.log(`  ${marker}${c.id} — ${c.summary} (risk: ${c.risk}, kind: ${c.kind})`);
    console.log(`    → ${c.proposedAction}`);
  }
}

function cmdDismiss(args) {
  const id = args.id;
  if (!id) { console.error('Usage: dismiss --id <candidate-id>'); process.exit(1); }
  let found = false;
  withLock(PENDING_PATH + '.lock', () => {
    const pending = loadPending();
    for (const c of pending.candidates) {
      if (c.id === id) {
        c.status = 'dismissed';
        c.dismissedAt = new Date().toISOString();
        found = true;
      }
    }
    writeAtomic(PENDING_PATH, pending);
  });
  console.log(JSON.stringify({ action: 'dismiss', id, found }));
  if (!found) process.exit(1);
}

function cmdPromote(args) {
  const id = args.id;
  if (!id) { console.error('Usage: promote --id <candidate-id>'); process.exit(1); }
  let result = { action: 'promote', id, found: false };
  withLock(PENDING_PATH + '.lock', () => {
    const pending = loadPending();
    for (const c of pending.candidates) {
      if (c.id !== id) continue;
      result.found = true;
      result.kind = c.kind;
      result.risk = c.risk;
      if (c.risk === 'low') {
        executeGraduation(c);
        c.status = 'promoted';
        c.promotedAt = new Date().toISOString();
        result.executed = true;
      } else {
        // Medium/high risk: surface to user; do not execute here.
        result.executed = false;
        result.guidance = c.risk === 'medium'
          ? 'Use skill-forge to scaffold + review before saving.'
          : 'Use /self-improve for explicit Memory→Rule promotion.';
      }
    }
    writeAtomic(PENDING_PATH, pending);
  });
  console.log(JSON.stringify(result));
  if (!result.found) process.exit(1);
}

function cmdReset() {
  const empty = {
    version: 1,
    createdAt: new Date().toISOString(),
    turnCounter: 0,
    signals: {},
    lastScanAt: null,
    lastScanTurn: 0,
  };
  writeAtomic(COUNTERS_PATH, empty);
  writeAtomic(PENDING_PATH, { version: 1, candidates: [], lastShownAt: null, lastShownInSessionId: null });
  console.log(JSON.stringify({ action: 'reset' }));
}

function cmdStats() {
  const counters = loadCounters();
  const pending = loadPending();
  const sigs = Object.entries(counters.signals);
  console.log(JSON.stringify({
    turnCounter: counters.turnCounter,
    lastScanAt: counters.lastScanAt,
    lastScanTurn: counters.lastScanTurn,
    signalCount: sigs.length,
    topSignals: sigs.sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([s, e]) => ({ signal: s, count: e.count })),
    pendingCount: pending.candidates.filter((c) => c.status === 'pending').length,
    autoGraduatedCount: pending.candidates.filter((c) => c.status === 'auto-graduated').length,
    dismissedCount: pending.candidates.filter((c) => c.status === 'dismissed').length,
    promotedCount: pending.candidates.filter((c) => c.status === 'promoted').length,
  }, null, 2));
}

// HT.1.14: programmatic surface for in-process callers (auto-store-enrichment.js
// bumpSelfImproveCounters now requires this module instead of spawning subprocess).
// CLI dispatch wrapped in `require.main === module` guard so requiring the
// module does not trigger the switch dispatch on the (always-undefined for
// require()) `process.argv[2]`.
module.exports = {
  bumpBatch,
  cmdBump,
  cmdBumpTurn,
  cmdScan,
  cmdPending,
  cmdDismiss,
  cmdPromote,
  cmdReset,
  cmdStats,
  // v2.8.2 Fix-3 — exposed for testability of differentiated action text
  // and the enriched observations.log line format.
  signalToProposedAction,
  signalToSummary,
  inferKindFromSignal,
  signalPolicy,
  executeGraduation,
  // Drift-evidence triage — exposed for unit-testing the evidence sanitizer's
  // fail-closed (scrub-unreachable) + entropy-redaction paths directly.
  sanitizeEvidence,
  hasConvergenceSpan,
};

if (require.main === module) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  switch (cmd) {
    case 'bump':       cmdBump(args); break;
    case 'bump-turn':  cmdBumpTurn(); break;
    case 'scan':       cmdScan(args); break;
    case 'pending':    cmdPending(args); break;
    case 'dismiss':    cmdDismiss(args); break;
    case 'promote':    cmdPromote(args); break;
    case 'reset':      cmdReset(); break;
    case 'stats':      cmdStats(); break;
    default:
      console.error('Usage: self-improve-store.js {bump|bump-turn|scan|pending|dismiss|promote|reset|stats} [args]');
      console.error('  bump --signal <type:value> [--n N]    — increment counter');
      console.error('  bump-turn                             — increment turn counter; reports shouldScan');
      console.error('  scan                                   — consolidate counters → pending queue');
      console.error('  pending [--json]                      — list pending + auto-graduated candidates');
      console.error('  dismiss --id <id>                      — mark dismissed');
      console.error('  promote --id <id>                      — execute (low-risk only)');
      console.error('  reset                                   — wipe state (test fixture)');
      console.error('  stats                                   — counter + queue summary');
      process.exit(1);
  }
}
