// @loom-layer: kernel
//
// v-next Authenticated Minter — P0 (RFC 2026-06-18-authenticated-minter-provenance-close, Option B).
//
// Closes (mechanically, SHADOW) the integrity!=provenance gap (#273 family): a GATING weight becomes a
// SIGNED, recompute-from-authoritative artifact instead of a co-forgeable open-store read. Integrity
// (every store re-derives its content-address on read) proves a record is well-formed; it does NOT
// prove WHO made it. A same-uid writer co-forges a byte-valid record via the exported derivation fns.
// The minter raises that bar: a gating weight is the signed OUTPUT of a pure policy that recomputes
// from KERNEL-AUTHORITATIVE inputs only — the lab's advisory stores are never signed verbatim.
//
// P0 scope (SHADOW — mechanics freeze, nothing gates):
//   - signRecordId/verifyRecordSig (generalized in edge-attestation.js) are the crypto.
//   - mintWeight({kind, subject}) recomputes value via a registered pure policy and signs the RESULT.
//   - NO consumer reads a minted weight to gate (that is P2). NO trust-domain key separation (P1) —
//     the key is still same-uid-env, so P0 is honestly Option-A-equivalent until P1 (the oracle
//     defense here is DEFENSE-IN-DEPTH; only P1 closes the same-uid co-forge).
//
// SECURITY-LOAD-BEARING rules (folded from the P0 architect+hacker VERIFY board — each defends a
// real, firsthand-reproduced attack):
//   - INV-MINT (F1/H-1): the signature is over minted_id = sha256(canonical(mintedIdBasis(weight))),
//     which COMMITS value (+ subject, kind, basis_digest, minted_at, key_id). Signing basis_digest
//     alone is a PROVEN value-swap forgery (keep a genuine basis_digest+sig, swap value -> still
//     verifies). verifyMintedWeight re-derives minted_id and verifies the sig over it; it does NOT
//     re-run the policy (the oracle defense lives on the MINT side). These two decisions are JOINED.
//   - H-2: minted_id is derived from an EXPLICIT 6-field allowlist (mintedIdBasis), shared by mint AND
//     verify (M1 forward-coupling). NOT spread-minus-sig — that lets the mint/verify field-set drift
//     and folds an attacker-added field into the hash.
//   - F2 (oracle defense): mintWeight takes {kind, subject} ONLY — never caller bytes/value. subject
//     is a validated scalar (the caller picks WHICH record to attest, never its VALUE); the policy
//     further validates the subject shape and resolves it ONLY against the content-verified kernel
//     reader, never a lab store.
//   - F3: key_id is minter-set ('v0' sentinel), inside minted_id, NOT caller-overridable; P1 adds a
//     key-set resolver keyed on it without changing the basis.
//   - F5: basis_digest + minted_id use the depth- AND width-bounded canonicalJsonSerialize
//     (MAX_CANONICAL_DEPTH / MAX_CANONICAL_NODES); a controlled-throw on a pathological basis/value ->
//     mintWeight returns null (fail-soft) / verifyMintedWeight returns false (fail-closed). NEVER throws.
//   - M-1 (stale-replay defense — opt-in, default-off): minted_at is signed (tamper-evident). A
//     freshness window is available via verifyMintedWeight's opts.maxAgeMs — DEFAULT-OFF keeps SHADOW
//     (no caller passes it yet, so a genuine mint still verifies regardless of age; inert — nothing
//     gates). The P2 consumer flip turns it on (or adds a policy re-run) before any value gates.
//
// DEPENDENCY DIRECTION (OQ-D): kernel-owned; imports ONLY ./canonical-json, ./edge-attestation, and
// (lazily) ./record-store — all kernel. NEVER a lab/runtime import (that would invert the legal
// lab->kernel direction and reopen the gap). A test grep-asserts zero lab imports.

'use strict';

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('./canonical-json');
const { signRecordId, verifyRecordSig } = require('./edge-attestation');

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_SUBJECT_LEN = 512;

// key_id is minter-set ('v0' sentinel) in P0 (F3): there is a single key, and key_id is signed
// (inside minted_id) so P1's key-set resolver can select on it without changing the signed basis.
const KEY_ID_V0 = 'v0';

// The one built-in policy (OQ-B β): attest a kernel transaction_id is present + content-valid.
const KERNEL_RECORD_KIND = 'kernel-record-attestation';

// A caller-supplied subject must be a non-empty bounded scalar — reject objects/arrays/null (F2). The
// per-policy shape gate (e.g. HEX64) is stricter and lives in the policy.
function isValidSubjectScalar(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_SUBJECT_LEN;
}

// A CANONICAL UTC ISO-8601 timestamp round-trips through Date.parse + toISOString (the
// `new Date().toISOString()` form, e.g. 2026-06-19T12:00:00.000Z). Requiring it makes the freshness
// comparison TIMEZONE-UNAMBIGUOUS (hacker H1): a tz-less string like '2026-06-19T12:00:00' is parsed
// by Date.parse in the verifier's LOCAL zone, silently swinging the window by hours across hosts.
function isCanonicalUtcIso(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === s;
}

// The EXPLICIT 6-field allowlist (H-2). The signed basis is EXACTLY these fields, in this set, derived
// the SAME way by mint and verify — an out-of-allowlist field cannot change minted_id.
function mintedIdBasis(weight) {
  return {
    kind: weight.kind,
    subject: weight.subject,
    value: weight.value,
    basis_digest: weight.basis_digest,
    minted_at: weight.minted_at,
    key_id: weight.key_id,
  };
}

// sha256 over the depth-bounded canonical serialization. canonicalJsonSerialize throws a controlled
// TypeError past MAX_CANONICAL_DEPTH — callers wrap in try/catch and fail-soft/closed (F5).
function sha256CanonicalHex(obj) {
  return crypto.createHash('sha256').update(canonicalJsonSerialize(obj), 'utf8').digest('hex');
}

// minted_id = sha256(canonical(mintedIdBasis)). May THROW (depth bound) — callers catch.
function computeMintedId(weight) {
  return sha256CanonicalHex(mintedIdBasis(weight));
}

// ── Policy registry (Open/Closed — P2 adds real gating policies without editing core) ─────────────

const REGISTRY = new Map();

function registerWeightPolicy(kind, fn) {
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new TypeError('registerWeightPolicy: kind must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('registerWeightPolicy: policy must be a function');
  }
  // Append-only (hacker H1): a registered kind (incl. the built-in kernel policy) cannot be silently
  // re-pointed — that would subvert the recompute-from-authoritative invariant from inside a trusted
  // process once P2 wires the minter in. A caller needing a different policy uses the per-call
  // opts.policies injection seam (which never touches this global registry).
  if (REGISTRY.has(kind)) {
    throw new Error(`registerWeightPolicy: policy already registered for kind '${kind}' (append-only)`);
  }
  REGISTRY.set(kind, fn);
}

// The built-in kernel-chain policy (DIP: the reader is injectable for tests; the default lazily binds
// the real record-store.readById — a kernel->kernel import, the legal direction). It recomputes from
// the content-verified kernel chain ONLY (record-store.loadRecordFile re-derives + verifies the
// content-address on read, #273), never a lab assertion.
function makeKernelRecordPolicy(deps = {}) {
  return function kernelRecordAttestation(subject, ctx = {}) {
    if (typeof subject !== 'string' || !HEX64.test(subject)) return null; // the policy's subject-shape gate
    const readById = deps.readById || require('./record-store').readById;
    let rec;
    try { rec = readById(subject, { runId: ctx.runId, stateDir: ctx.stateDir }); }
    catch { return null; }
    if (!rec || typeof rec !== 'object') return null;
    // value=1 attests "this kernel transaction_id is present + content-valid". basis = the verified
    // content-address fields (kernel chain only) — the authoritative inputs the signature commits to.
    return {
      value: 1,
      basis: {
        transaction_id: rec.transaction_id,
        post_state_hash: (typeof rec.post_state_hash === 'string') ? rec.post_state_hash : null,
      },
    };
  };
}

registerWeightPolicy(KERNEL_RECORD_KIND, makeKernelRecordPolicy());

// ── Mint + verify ─────────────────────────────────────────────────────────────────────────────────

/**
 * Mint a SIGNED weight by recomputing `value` from kernel-authoritative inputs via the policy for
 * `kind`, then signing the full minted tuple (INV-MINT). NEVER signs caller bytes/value (F2 oracle
 * defense). Fail-soft: returns null (never throws) on an invalid spec, unregistered kind, a policy
 * that resolves nothing, a depth-overflow basis, or no signing key (SHADOW default — fail-closed).
 *
 * @param {{kind:string, subject:string}} spec  kind + subject ONLY; any extra field (value/key_id) is IGNORED.
 * @param {object} [opts] { privateKeyPem?, now?, context?:{runId,stateDir}, policies?:Map }
 *   NOTE: opts.signer is NOT honored here (VALIDATE hacker H1) — the minter's signer is KERNEL-OWNED, so
 *   a caller cannot inject a signer to downgrade the trusted key; only opts.privateKeyPem (the env/PEM
 *   default key) is forwarded to the crypto. The ③.2 trust-domain vehicle is wired via a trusted kernel
 *   mechanism, not this public opts.
 * @returns {object|null} { kind, subject, value, basis_digest, minted_at, key_id, sig } or null.
 */
function mintWeight(spec, opts = {}) {
  // Guard the property extraction from the untrusted `spec` (CodeRabbit #360): a throwing getter /
  // proxy on spec.kind|subject must not escape the documented fail-soft "NEVER throws" contract.
  let kind;
  let subject;
  try {
    kind = spec && spec.kind;
    subject = spec && spec.subject;
  } catch { return null; }
  if (typeof kind !== 'string' || kind.length === 0) return null;
  if (!isValidSubjectScalar(subject)) return null;

  const registry = (opts.policies instanceof Map) ? opts.policies : REGISTRY;
  const policy = registry.get(kind);
  if (typeof policy !== 'function') return null; // unregistered -> mint nothing (cannot be coerced)

  let out;
  try { out = policy(subject, opts.context || {}); }
  catch { return null; }
  // out.basis == null catches BOTH null and undefined (CR-1): a null basis would sign a CONSTANT
  // basis_digest = sha256(canonical(null)) — attesting "kernel-minted" while reading NO authoritative
  // input — so reject it. value may legitimately be 0 or null (a real weight value, committed in the
  // signature), so it is rejected only when strictly undefined.
  if (!out || typeof out !== 'object' || out.value === undefined || out.basis == null) return null;

  let basisDigest;
  try { basisDigest = sha256CanonicalHex(out.basis); }
  catch { return null; } // depth-overflow basis -> fail-soft (F5)

  // opts.now must be a CANONICAL UTC ISO (round-trips through toISOString) — else fall back to real
  // now. This blocks a timezone-ambiguous now from ever being SIGNED (hacker H1) and subsumes the
  // CR-3 whitespace guard. The minter's own auto-stamp (new Date().toISOString()) is already canonical.
  const mintedAt = (typeof opts.now === 'string' && isCanonicalUtcIso(opts.now)) ? opts.now : new Date().toISOString();
  const weight = {
    kind,
    subject,
    value: out.value,
    basis_digest: basisDigest,
    minted_at: mintedAt,
    key_id: KEY_ID_V0, // minter-set; NEVER from spec/opts (F3)
  };

  let mintedId;
  try { mintedId = computeMintedId(weight); }
  catch { return null; }

  // ALLOWLIST the opts forwarded to the signer (VALIDATE hacker H1): the P1 seam made opts.signer the
  // highest-precedence signer in resolveSigner, and mintWeight previously forwarded opts WHOLE — letting
  // an untrusted caller inject opts.signer to DOWNGRADE the trusted env/PEM key to a key it controls (a
  // provenance forge). The minter's signer is KERNEL-OWNED: forward ONLY the legitimate signing key, NEVER
  // a caller-supplied signer. Symmetric with F3 (key_id minter-set) + F2 (value never from opts). The
  // ③.2 trust-domain vehicle is wired into the minter via a trusted kernel mechanism, not this opts.
  const sig = signRecordId(mintedId, { privateKeyPem: opts.privateKeyPem });
  if (!sig) return null; // SHADOW default: no key -> mint nothing (fail-closed)
  return { ...weight, sig };
}

/**
 * Verify a minted weight. Fail-CLOSED: any missing/ill-typed field, a depth-overflow value, a bad
 * signature, or no loadable verify key -> false. Re-derives minted_id from the EXPLICIT allowlist
 * (H-2) and verifies the sig over it (INV-MINT — commits value). Does NOT re-run the policy (P0).
 * NEVER throws.
 *
 * @param {object} weight a minted weight
 * @param {object} [opts] { publicKeyPem?, maxAgeMs?, nowMs? } — maxAgeMs (opt-in) enforces a
 *   freshness window on the signed minted_at (default-off preserves SHADOW); fail-closed on a
 *   non-positive/non-finite maxAgeMs, a non-canonical-UTC / unparseable minted_at, or a non-finite
 *   nowMs. The window is SYMMETRIC + INCLUSIVE: |nowMs - mintedMs| <= maxAgeMs — so the effective
 *   acceptance span is 2*maxAgeMs (a P2 caller sizing a one-sided "max age" must account for that;
 *   symmetric is deliberate — it also rejects an implausibly-FUTURE mint, which a one-sided
 *   [0,maxAge] bound would silently accept). nowMs is injectable for tests.
 * @returns {boolean}
 */
function verifyMintedWeight(weight, opts = {}) {
  if (!weight || typeof weight !== 'object' || Array.isArray(weight)) return false;
  // Guard the destructure from the untrusted `weight` (CodeRabbit #360): a throwing getter on any
  // accessed property must not escape the fail-closed "NEVER throws" contract (computeMintedId below
  // is already try/catch-guarded; this closes the same hole on the first property access).
  let kind;
  let subject;
  let value;
  let basisDigest;
  let mintedAt;
  let keyId;
  let sig;
  try {
    ({
      kind, subject, value, basis_digest: basisDigest, minted_at: mintedAt, key_id: keyId, sig,
    } = weight);
  } catch { return false; }
  if (typeof kind !== 'string' || kind.length === 0) return false;
  if (!isValidSubjectScalar(subject)) return false;
  if (value === undefined) return false;
  if (typeof basisDigest !== 'string' || !HEX64.test(basisDigest)) return false;
  if (typeof mintedAt !== 'string' || mintedAt.length === 0) return false;
  if (typeof keyId !== 'string' || keyId.length === 0) return false;
  if (typeof sig !== 'string' || sig.length === 0) return false;

  let mintedId;
  try { mintedId = computeMintedId(weight); }
  catch { return false; } // depth-overflow value -> fail-closed (F5)
  if (!verifyRecordSig(mintedId, sig, opts)) return false;

  // M-1 — opt-in freshness window (default-off keeps SHADOW: no maxAgeMs -> no check). Applied ONLY
  // to an authentic weight (the sig above passed), so minted_at is the signed, tamper-evident value.
  // Fail-CLOSED: a garbage maxAgeMs must NOT silently disable the check (RFC §5.5 no-silent-downgrade);
  // an unparseable minted_at or a non-finite nowMs -> false. The SYMMETRIC window rejects a STALE
  // replay AND an implausibly-FUTURE mint (a clock-skew bound), tolerating small skew either way.
  if (opts.maxAgeMs === undefined) return true;
  const { maxAgeMs } = opts;
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  const nowMs = (opts.nowMs !== undefined) ? opts.nowMs : Date.now();
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;
  // The signed minted_at MUST be a canonical UTC ISO so the comparison is timezone-unambiguous across
  // verifying hosts (hacker H1). A tz-less / non-canonical value -> fail-closed (an honest mint is
  // always canonical; this also rejects a key-holder who signed a timezone-ambiguous time).
  if (!isCanonicalUtcIso(mintedAt)) return false;
  const mintedMs = Date.parse(mintedAt);
  return Math.abs(nowMs - mintedMs) <= maxAgeMs;
}

module.exports = {
  mintWeight,
  verifyMintedWeight,
  registerWeightPolicy,
  makeKernelRecordPolicy,
  mintedIdBasis,
  computeMintedId,
  KERNEL_RECORD_KIND,
  KEY_ID_V0,
};
