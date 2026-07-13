#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE external-readiness Track A, A3-on-v1: the toolkit->Embers export seam.
//
// buildBankPair assembles a `bank`-ready (node, meta) pair from a VERIFIED world_anchored node + the
// operator/join inputs. Embers ingests the pair via `embers bank --node <node> --meta <meta> --key <pem>`.
// The node is the frozen 7-key `world_anchored` body emitted VERBATIM - Embers re-parses it and re-derives
// its two seals (node_id + content_hash), both by-parity copies of packages/kernel/_lib/canonical-json.js,
// so a verbatim emit round-trips. The meta is the v1 MINIMAL shape Embers `bank` requires:
//   { minter: { persona_id, human_root }, prUrl, repoSlug, mergeSnapshot: { merged, merge_sha } }
// failureSignature is OMITTED - Embers defaults it to node.lesson_signature (the same bytes; emitting a copy
// would invite drift). scope is an optional advisory bag, not emitted (YAGNI).
//
// GAP-A (Wave 2a): mergeSnapshot carries the merge SIGNAL the node already proves. A world_anchored node is
// minted ONLY from a gh-verified merge, so `merged: true` is honestly derivable from node.merge_sha. Embers
// reads meta.mergeSnapshot into evaluateMintGate: without it the gate FAILs (`not-merged`); with `merged:true`
// it demotes only to WEAK (`no-distinct-reviewer`), so the merge quality WE DO have is not dropped. The RICHER
// signals (merger identity, distinct reviewers, merge_commit_parents, time-to-merge) are NOT in the node/att
// (never captured into a store, R1'/#273), so Embers' generous SHADOW defaults apply - a future enhancement
// when the pipeline threads them end-to-end. SHADOW: the gate ANNOTATES, never blocks (integrity != provenance).
//
// SECURITY (v1 posture - integrity != provenance, #273): persona_id + human_root are SELF-ASSERTED operator
// labels; Embers banks the pair at receiver-weight 0. This function proves the node's INTEGRITY (the seals
// re-derive via the store's own verifyNodeBody), the meta's WELL-FORMEDNESS, and the node<->PR consistency
// (a strict full-shape pr_url + owner/repo + pr_number cross-check) - it does NOT, and cannot, prove
// PROVENANCE. The pair HARDENS nothing (OQ-NS-6). These labels become trust-bearing ONLY under a deployed
// authenticated minter; at THAT point the store dams (the field-blind attestation read; the same-uid
// co-forge surface) escalate from weight-0 residual to load-bearing - the caller must NOT wire this into any
// weight/authz consumer while it stays SHADOW.
//
// The export re-verifies the node here (not just trusting the reader) so the pure core is self-defending:
// verifyNodeBody is the store's EXACT #273 chain (schema + exact-set BEFORE the seals), reused - never
// re-implemented - so it cannot drift. The emitted node is reconstructed from the whitelisted STORED_KEYS,
// so even an unverified caller cannot ride an 8th key into the pair.

'use strict';

const { verifyNodeBody, STORED_KEYS } = require('./live-recall-store');
const { parsePrUrl } = require('./parse-pr-url');

// human_root / persona_id length cap - a bounded label (same DoS class as the built_by/branch caps). A
// larger value is rejected, never truncated.
const MAX_LABEL = 256;

// A codepoint forbidden in an egressed operator label. Beyond the C0/DEL/C1 control band, this rejects the
// Unicode format/bidi/zero-width set that would otherwise land RAW in the emitted meta.json and cross out to
// the external Embers commons - a Trojan-Source display-spoof (bidi overrides/isolates), a log-line-injection
// (the U+2028/U+2029 line separators are genuine line terminators), or an invisible-char spoof (zero-width,
// BOM, soft-hyphen, nbsp). The export is the last line enforcing label well-formedness, so it filters here.
// charCodeAt form, never a control-regex (ADR-0006). All targets are BMP, so UTF-16-code-unit iteration hits
// them exactly (an astral char's surrogate halves are 0xD800-0xDFFF, outside every range below - allowed).
function isForbiddenLabelChar(n) {
  return n < 0x20 || (n >= 0x7f && n <= 0x9f)        // C0 / DEL / C1
    || n === 0x00a0 || n === 0x00ad                  // nbsp / soft-hyphen
    || (n >= 0x200b && n <= 0x200f)                  // zero-width space/ZWNJ/ZWJ + LRM/RLM
    || n === 0x2028 || n === 0x2029                  // line / paragraph separators (real line terminators)
    || (n >= 0x202a && n <= 0x202e)                  // bidi embeddings / overrides (Trojan-Source)
    || n === 0x2060                                  // word joiner
    || (n >= 0x2066 && n <= 0x2069)                  // bidi isolates (Trojan-Source)
    || n === 0xfeff;                                 // BOM / ZWNBSP
}

// A bounded, non-empty label with no control, format, bidi, or invisible codepoints. Mirrors (and tightens)
// world-anchor/cli.js isBoundedPlainString - re-stated locally (cli.js is a CLI entrypoint, not a lib) rather
// than importing the whole CLI chain into this pure core.
function isBoundedPlainString(v, max) {
  if (typeof v !== 'string' || v.length < 1 || v.length > max) return false;
  return !Array.prototype.some.call(v, (c) => isForbiddenLabelChar(c.charCodeAt(0)));
}

// A strict 2-segment owner/repo slug (both segments non-empty). The attestation store only LENGTH-bounds its
// repo field (world-anchor-store.js validateAttestation), so the export re-checks the shape here before it
// becomes the Embers repoSlug.
function isTwoSegmentSlug(repo) {
  if (typeof repo !== 'string') return false;
  const parts = repo.split('/');
  return parts.length === 2 && parts.every((s) => s.length > 0);
}

// The frozen emit order (the store's on-disk insertion order). The node is RECONSTRUCTED from exactly these
// 7 whitelisted keys, so no extra key can ride into the emitted pair even on an unverified call path.
const NODE_EMIT_ORDER = Object.freeze(['anchor_id', 'provenance', 'merge_sha', 'lesson_signature', 'lesson_body', 'node_id', 'content_hash']);
function reconstructNode(body) {
  const out = {};
  for (const k of NODE_EMIT_ORDER) out[k] = body[k];
  return out;
}
// NODE_EMIT_ORDER must stay in lockstep with the store's STORED_KEYS (same 7-field set). A drift here would
// silently drop or add a sealed field; fail-closed at load rather than emit a mis-shaped node.
if (NODE_EMIT_ORDER.length !== STORED_KEYS.length || !NODE_EMIT_ORDER.every((k) => STORED_KEYS.includes(k))) {
  throw new Error('export-bank-pair: NODE_EMIT_ORDER drifted from live-recall-store STORED_KEYS');
}

/**
 * Assemble a bank-ready (node, meta) pair. PURE: no I/O. Fail-closed on ANY mismatch.
 * @param {{node: object, prUrl: string, repo: string, prNumber: number, personaId: string, humanRoot: string}} input
 * @returns {{ok: true, node: object, meta: object} | {ok: false, reason: string}}
 */
function buildBankPair(input) {
  const { node: rawNode, prUrl, repo, prNumber, personaId, humanRoot } = input || {};

  // Snapshot the node's own-enumerable VALUES once, before any read. The real path hands us a frozen
  // JSON.parse'd plain object (no getters), but this function is documented as self-defending "even on an
  // unverified call path" - a hand-crafted node with getters could otherwise return honest values through
  // verifyNodeBody and a tampered value on the later reconstructNode read. The single spread evaluates any
  // getter ONCE, so verify + reconstruct read identical bytes (node values are all strings; shallow is enough).
  // The spread itself can THROW on a hostile throwing getter / Proxy trap - catch it and fail CLOSED, since
  // buildBankPair's public contract returns {ok:false}, never throws.
  let node;
  try {
    node = (rawNode && typeof rawNode === 'object' && !Array.isArray(rawNode)) ? { ...rawNode } : rawNode;
  } catch {
    return { ok: false, reason: 'node-not-an-object' };
  }

  // 1. Node integrity (verify-on-emit): reuse the store's EXACT self-consistency chain. A tampered body, an
  //    injected extra key (exact-set beats a resealed launder), or a broken seal fails here.
  const nodeReason = verifyNodeBody(node);
  if (nodeReason) return { ok: false, reason: `node-${nodeReason}` };

  // 2. Operator labels: bounded, non-empty, control-char-free (terminal/log-injection + DoS bound).
  if (!isBoundedPlainString(personaId, MAX_LABEL)) return { ok: false, reason: 'bad-persona-id' };
  if (!isBoundedPlainString(humanRoot, MAX_LABEL)) return { ok: false, reason: 'bad-human-root' };

  // 3. prUrl STRICT full-shape (^https://github.com/owner/repo/pull/N$) - NOT Embers' loose ^https://github.com/
  //    prefix. The attestation read path is field-shape-blind (readAnchorRaw re-derives only anchor_id +
  //    content_hash), so the export is the LAST line enforcing well-formedness on the joined pr_url. Reject a
  //    non-trimmed pr_url up front (parsePrUrl would trim it, silently diverging meta.prUrl from the sealed
  //    att.pr_url) - the honest gh html_url carries no surrounding whitespace, so a padded value is malformed.
  if (typeof prUrl !== 'string' || prUrl !== prUrl.trim()) return { ok: false, reason: 'bad-pr-url' };
  let parsedUrl;
  try { parsedUrl = parsePrUrl(prUrl); } catch { return { ok: false, reason: 'bad-pr-url' }; }

  // 4. repo is a strict 2-segment owner/repo (the attestation store only length-bounds it).
  if (!isTwoSegmentSlug(repo)) return { ok: false, reason: 'bad-repo' };

  // 5. node<->PR consistency: the pr_url's owner/repo + pr_number MUST equal the joined repo + prNumber (a
  //    foreign-PR launder / join-bug close; mirrors merge-outcome-store's pr-url-mismatch rigor).
  if (parsedUrl.repo !== repo) return { ok: false, reason: 'repo-pr-url-mismatch' };
  if (parsedUrl.pr_number !== prNumber) return { ok: false, reason: 'pr-number-mismatch' };

  // 6. Build the meta. minter is an EXPLICIT exactly-2-key literal (never a spread), so the Embers minter
  //    exact-set is structurally guaranteed. prUrl is the canonicalized (trimmed) form from parsePrUrl.
  //    mergeSnapshot (GAP-A) carries ONLY the merge signal the verified node proves (merged:true derivable
  //    from node.merge_sha, itself sealed inside the node's content_hash) - never a fabricated richer signal.
  const meta = {
    minter: { persona_id: personaId, human_root: humanRoot },
    prUrl: parsedUrl.pr_url,
    repoSlug: repo,
    mergeSnapshot: { merged: true, merge_sha: node.merge_sha },
  };

  return { ok: true, node: reconstructNode(node), meta };
}

module.exports = { buildBankPair, MAX_LABEL };
