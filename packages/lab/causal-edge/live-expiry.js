#!/usr/bin/env node

// @loom-layer: lab
//
// Gap-9 background-expiry — the DORMANT, SHADOW sweep that disposes stale, never-landed live_pending lesson
// nodes (the second half of Gap-9; #514 shipped the terminal-block-triggered disposal). "Only merged is
// retained" is implemented as NON-promotion; a never-merged draft otherwise persists indefinitely. This
// sweep makes the disposal EXPLICIT for age: every verified, NON-tombstoned live_pending node older than
// maxAgeMs is disposed via #514's disposeCandidate (record the observable "why", then TOMBSTONE the node —
// evidence-preserving, tombstone-only, NO physical reap). It gates NOTHING and NOTHING gates on it.
//
// DORMANT: there is NO live caller. Exactly like #514's disposeCandidate, the MECHANISM ships and is invoked
// by nothing in the pipeline — an operator / future-scheduled knob. A `live-expiry-shadow.test.js`
// import-graph dam asserts zero gating/ranking/weight consumer.
//
// AGE = now - file mtime (F2): the node is write-once ({flag:'wx'}, immutable), so its mtime ~= capture time,
// and listLivePendingAges surfaces mtime off the SAME fstat'd fd inside readNodeVerified (never a second
// stat). mtime is NOT content-sealed — a same-uid `touch`, OR a benign mtime-non-preserving copy/restore
// (rsync without --times, cp without -p, a backup restore), shifts it BI-DIRECTIONALLY: touch-OLD -> a
// premature-expiry lever (suppresses a fresh/unconsumed floor from the mint's default reader), touch-FRESH ->
// an immortal node. This is a DISTINCT, LOWER-BAR residual than the accepted same-uid node co-forge (#273
// integrity-not-provenance — mtime lives OUTSIDE even the content seal), INERT while the lane is weight-inert;
// the #273 arming-time close is a content-sealed captured_at in the node body (a store-schema migration, not
// this wave — an authenticated WRITER alone does not close it, since mtime is unsealed). Mitigations HERE: a
// per-expiry alert carries {node_id, mtimeMs, age_ms} so a
// mass-expiry burst is forensically visible (F7), and an optional maxPerSweep bounds a single sweep's
// blast radius (F8).
//
// "NEVER REACHED A MERGE" is approximated as age + not-already-tombstoned (VERIFY board): the mint does NOT
// tombstone a pending node on consume and re-reads the captured floor via the tombstone-SKIPPING default
// lister, so a merge landing AFTER the sweep (a PR open > maxAgeMs) loses its floor from the default mint
// read (recoverable via includeTombstoned). Safe ONLY while maxAgeMs exceeds the max realistic merge
// latency; the merge cross-reference is the named arming-time refinement (deferred — the lane gates nothing).
//
// Imports: kernel/_lib + kernel/egress/alert + two causal-edge SIBLINGS (the lane reader listLivePendingAges
// — the lane dam admits live-expiry by full-path — and the disposer disposeCandidate). NO runtime/kernel
// STATE. TOTAL: expirePendingLessons NEVER throws; every refuse + every expiry is OBSERVABLE.

'use strict';

const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { listLivePendingAges } = require('./live-pending-store');   // the ONE admitted reader (lane dam, full-path)
const { disposeCandidate } = require('./live-disposal');           // sibling disposer (record-then-tombstone)

// The FIXED block_reason literal for an age-expiry (distinct from #514's terminal-block reasons). A hardcoded
// literal, never caller-supplied -> no reason-smuggling. block_reason is part of the disposal identity basis,
// so an 'expired' disposal is a DISTINCT record from a 'pr-creation-restricted' one for the same candidate
// (legitimate dual-cause history — a candidate can be terminal-blocked AND later aged out).
const EXPIRED_REASON = 'expired';

// repoSlug — a LOCAL copy of world-anchor-mint's normalizer (F15, VERIFY board). Kept local (not imported,
// not shared to kernel/_lib): importing world-anchor-mint would pull a heavy reader-dammed module into the
// sweep, and a kernel/_lib extraction is YAGNI at only two consumers (VERIFY architect ruled keep-local at
// NIT). A slug DRIFT from the canonical is caught TWO ways — a parity test pins this to the mint's behavior
// on the URL/bare/.git cases, AND the disposal store re-validates via its own GH_REPO_RE (a bad slug -> an
// observable 'bad-repo' refuse). The pending READ already enforces `repo` is a well-formed URL inside the
// content seal, so for any VERIFIED node repoSlug succeeds — the null-skip below is fail-safe-today defense
// against a future producer format, inert while SHADOW.
const GH_URL_SLUG_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;
const BARE_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function repoSlug(s) {
  if (typeof s !== 'string') return null;
  const m = GH_URL_SLUG_RE.exec(s);
  const raw = m ? m[1] : (BARE_SLUG_RE.test(s) ? s : null);
  if (raw === null) return null;
  return raw.replace(/\.git$/, '');                                // strip a trailing .git (one strip, like git)
}

function alert(reason, detail) { emitEgressAlert(`expiry-${reason}`, detail || {}); }
// STRICTLY positive — for maxAgeMs + now (a zero/negative threshold or clock is meaningless).
function isPositiveFinite(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0; }
// NON-NEGATIVE — for maxPerSweep, where 0 is a MEANINGFUL cap (a dry-run / canary: "process none this
// sweep"). VALIDATE code-reviewer MEDIUM: gating maxPerSweep on isPositiveFinite silently treated 0 as
// "unset -> UNBOUNDED" (the safest value producing the least-safe behavior, and inconsistent with 0.5 which
// floors-to-0 and DID cap). A distinct >= 0 check makes 0 an honest zero-item cap.
function isNonNegativeFinite(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }

/**
 * Gap-9 background-expiry: dispose (record-then-tombstone, tombstone-only) every verified, NON-tombstoned
 * live_pending lesson node whose age (now - file mtime) exceeds maxAgeMs. DORMANT / SHADOW — no live caller.
 * Reuses #514's disposeCandidate (fail-soft + idempotent), so a re-sweep converges (a disposed node is
 * tombstoned -> skipped by the default lister on the next sweep). TOTAL: NEVER throws.
 *
 * @param {{maxAgeMs:number, now?:number, pendingDir?:string, disposalDir?:string}} args
 *   maxAgeMs — the staleness threshold (ms). now — the sweep clock (defaults to Date.now(); injected for
 *   tests). pendingDir / disposalDir — per-store dir overrides (test isolation; production uses the real dirs).
 * @param {{disposeFn?:Function, listFn?:Function, selfUid?:number, maxPerSweep?:number}} [opts]
 *   maxPerSweep (F8) — optional blast-radius bound on disposal ATTEMPTS (a same-uid mass-touch, OR a benign
 *   mtime-non-preserving restore, can otherwise drive a large one-shot disposal burst). A NON-NEGATIVE int:
 *   0 is a real zero-item cap (a dry-run / canary — process none); omit/undefined => UNBOUNDED (the dormant
 *   default). When reached, the sweep stops early and returns capped:true. It bounds the WRITES, not the
 *   enumeration read (that already ran, bounded by the store's read-path caps).
 * @returns {{ok:boolean, reason?:string, scanned?:number, attempted?:number, disposed?:number,
 *   tombstoned?:number, capped?:boolean, results?:Array<{node_id:string, disposed:boolean,
 *   tombstoned:boolean, reason?:string}>}}
 *   `attempted` = age-crossed nodes PROCESSED this sweep; under a cap it is LESS than the true age-crossed
 *   total (capped:true is the "more remain" signal). disposed/tombstoned count NODES acted on.
 *   ok:false + reason on a refused sweep (bad maxAgeMs / bad now / lister threw) — DISTINCT from a legitimate
 *   ok:true empty sweep (F9), so a future scheduled caller can branch on the return, not the alert side-channel.
 */
function expirePendingLessons(args = {}, opts = {}) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const maxAgeMs = a.maxAgeMs;
  const now = a.now === undefined ? Date.now() : a.now;
  // F3: boundary-validate BOTH the threshold AND the clock, symmetric refuse. A non-finite now (NaN) makes
  // every `ageMs <= maxAgeMs` compare false (NaN comparisons are always false), so every node would fall to
  // the dispose branch — the exact "disposes everything" failure the guard closes. Refuse observably; a
  // refused sweep disposes NOTHING and is distinguishable from an empty one via ok:false (F9).
  if (!isPositiveFinite(maxAgeMs)) { alert('bad-max-age', { maxAgeMs: String(maxAgeMs) }); return { ok: false, reason: 'bad-max-age-ms' }; }
  if (!isPositiveFinite(now)) { alert('bad-now', { now: String(now) }); return { ok: false, reason: 'bad-now' }; }

  const selfUid = o.selfUid === undefined ? currentUid() : o.selfUid;
  const disposeFn = typeof o.disposeFn === 'function' ? o.disposeFn : disposeCandidate;
  const maxPerSweep = isNonNegativeFinite(o.maxPerSweep) ? Math.floor(o.maxPerSweep) : null;   // 0 => a real zero-item cap

  // The production path calls listLivePendingAges DIRECTLY (never via an indirection default) — the literal
  // call is what the lane's reader-caller dam matches, so this reader stays GOVERNED (F4). opts.listFn is an
  // explicit TEST seam only; includeTombstoned:false locks the sweep to the DEFAULT (tombstone-skipping)
  // lister so an already-disposed node is never re-scanned / re-disposed.
  const listArgs = { dir: a.pendingDir, selfUid, includeTombstoned: false };
  let nodes;
  try { nodes = typeof o.listFn === 'function' ? o.listFn(listArgs) : listLivePendingAges(listArgs); }
  catch (e) { alert('list-threw', { detail: (e && e.message) || 'error' }); return { ok: false, reason: 'list-threw' }; }
  if (!Array.isArray(nodes)) nodes = [];

  const results = [];
  let disposed = 0; let tombstoned = 0; let capped = false;
  for (const entry of nodes) {
    const node = entry && entry.node;
    const mtimeMs = entry && entry.mtimeMs;
    // Number.isFinite (NOT typeof === 'number') — a NaN mtimeMs is `typeof number` but `now - NaN <= max` is
    // false, which would fall through to DISPOSE (the exact F3 "NaN flips eligibility" failure, per-node).
    // Guard it symmetric with the now/maxAgeMs guards: a malformed mtime SKIPS, never disposes. Unreachable
    // via the real lister (st.mtimeMs is always finite); a defense-in-depth close for the test/DI seam
    // (VALIDATE hacker+code-reviewer LOW, CONFIRMED via an injected listFn).
    if (!node || !Number.isFinite(mtimeMs)) continue;
    if (now - mtimeMs <= maxAgeMs) continue;                         // not stale yet (strictly older than maxAgeMs expires)
    // F8: bound the ATTEMPT count (bounds the disposal WRITES, since writes <= attempts — NOT the enumeration
    // read cost, which already happened above and is bounded by the store's own read-path caps). Check BEFORE
    // processing so `capped:true` means "more age-eligible nodes remain, unswept".
    if (maxPerSweep !== null && results.length >= maxPerSweep) { capped = true; break; }
    const ageMs = now - mtimeMs;
    const slug = repoSlug(node.repo);
    if (slug === null) {                                            // fail-safe-today (a verified node's repo is always a valid URL)
      alert('bad-repo-slug', { node_id: node.node_id, repo: String(node.repo) });
      results.push({ node_id: node.node_id, disposed: false, tombstoned: false, reason: 'bad-repo-slug' });
      continue;
    }
    // F7: forensic visibility — a mass-expiry burst (a same-uid touch / a benign rsync-without-times) shows
    // up as a wall of `expiry-expired` with implausibly-old mtimes/ages. `block_reason` (NOT `reason`, which
    // emitEgressAlert's positional token always clobbers) carries the disposal cause.
    alert('expired', { node_id: node.node_id, mtimeMs, age_ms: ageMs, block_reason: EXPIRED_REASON });
    let res;
    // F5: per-node try/catch — a throwing (injected) disposeFn degrades THIS node to a fail shape, never
    // aborts the whole sweep. The default disposeCandidate is itself TOTAL, so production never throws here.
    try {
      res = disposeFn(
        { repo: slug, issueRef: node.issue_ref, candidatePatchSha: node.candidate_patch_sha, blockReason: EXPIRED_REASON, pendingNodeId: node.node_id },
        { dir: a.disposalDir, pendingDir: a.pendingDir, now, selfUid },
      );
    } catch (e) {
      alert('dispose-threw', { node_id: node.node_id, detail: (e && e.message) || 'error' });
      res = { disposed: false, tombstoned: false };
    }
    const nodeDisposed = !!(res && res.disposed);
    const nodeTombstoned = !!(res && res.tombstoned);
    if (nodeDisposed) disposed += 1;
    if (nodeTombstoned) tombstoned += 1;
    results.push({ node_id: node.node_id, disposed: nodeDisposed, tombstoned: nodeTombstoned });
  }
  // F7: a sweep-summary alert (observable even when nothing was stale). `attempted` = age-crossed nodes we
  // PROCESSED (== results.length); under a cap it is LESS than the true age-crossed total (we broke early),
  // which is why capped:true is the "more remain" signal. disposed/tombstoned count NODES acted on (two
  // distinct nodes sharing a disposal identity => disposed:2 against 1 deduped disposal-outcome record).
  alert('sweep', { scanned: nodes.length, attempted: results.length, disposed, tombstoned, capped });
  return { ok: true, scanned: nodes.length, attempted: results.length, disposed, tombstoned, capped, results };
}

module.exports = { expirePendingLessons, repoSlug, EXPIRED_REASON };
