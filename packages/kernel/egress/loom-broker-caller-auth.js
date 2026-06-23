// Power Loom egress — loom-broker-caller-auth.js  (③.2.5b)
//
// PURE caller-authorization for the cross-uid loom-broker (no I/O): given the sudo-injected caller uid
// (SUDO_UID) and the broker-side allowlist (LOOM_BROKER_ALLOWED_UIDS), decide allow / deny. loom-broker-sign.js
// calls this as its WHO gate, BEFORE opening the key. SHADOW (the broker gates no live action until ③.2.5c).
//
// PORTED from PACT identity/caller-auth.js with ONE deliberate adaptation: an UNSET allowlist => DENY (fail
// closed), NOT PACT's "disabled" (proceed-LOUD). For an egress signer the WHO gate is load-bearing — 5b is
// greenfield (no legacy blind-oracle deployment to preserve) — so an unconfigured allowlist denies all + the
// wrapper emits a LOUD stderr (the "a fail-CLOSED security decision must be OBSERVABLE" rule).
//
// HONEST SCOPE (VERIFY hacker C1): this is COARSE caller-auth (uid-level WHO), and it is CONTINGENT, NOT an
// independent control. SUDO_UID is unforgeable ONLY when sudo injected it (deployed sudoers `env_reset, !setenv`);
// on a DIRECT (non-sudo) invoke the host forges SUDO_UID freely. The real independent control is the cross-uid
// KEY CUSTODY (the actor cannot read the key). NEVER authorize on SUDO_USER (root-spoofable, man sudoers).

'use strict';

// a uid token: 1-10 digits. The integer bound below rejects values past 2^32 and the (uid_t)-1 sentinel.
const UID_RE = /^[0-9]{1,10}$/;
const UID_MAX = 0xffffffff; // reject the (uid_t)-1 / "nobody" sentinel (4294967295) and anything above

/**
 * Strictly parse a single uid token -> a non-negative integer < UID_MAX, or null (fail-closed).
 * Trims surrounding ASCII spaces ONLY (operator allowlist entries like "501, 600"); rejects empty / signed /
 * non-digit / Unicode-whitespace-padded (NBSP/em-space/BOM would let a padded token normalize to a uid) /
 * overflow / the (uid_t)-1 sentinel.
 * @param {*} s
 * @returns {number|null}
 */
function parseUid(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/^ +| +$/g, ''); // ASCII space only — NOT String.trim() (that strips the Unicode ws class)
  if (!UID_RE.test(t)) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n >= UID_MAX) return null;
  return n;
}

/**
 * Parse the allowlist env. UNSET (undefined/null) => { configured:false }. PRESENT => a Set<number> of every
 * entry, parsed through the SAME parseUid path as the caller (type-consistent comparison). A SINGLE malformed
 * entry fails the WHOLE parse (exact-set discipline: never silently drop a bad entry and authorize on the
 * survivors); a present-but-empty value is malformed (fail-closed).
 * @param {*} raw
 * @returns {{configured:boolean, set:Set<number>|null, malformed?:boolean}}
 */
function parseAllowlist(raw) {
  if (raw === undefined || raw === null) return { configured: false, set: null };
  const parts = String(raw).split(',');
  const out = new Set();
  for (const p of parts) {
    const n = parseUid(p);
    if (n === null) return { configured: true, set: null, malformed: true };
    out.add(n);
  }
  return { configured: true, set: out };
}

/**
 * Decide whether the caller may request a signature.
 * @param {{sudoUid:string|undefined, allowlistRaw:string|undefined}} opts
 * @returns {{decision:'allow'|'deny', reason:string}}
 *   'deny'  -> fail-closed: allowlist UNSET (the Loom deny-on-unset adaptation), malformed allowlist,
 *              absent/malformed SUDO_UID, or caller not in the allowlist.
 *   'allow' -> allowlist SET + SUDO_UID parses + is a member.
 */
function authorizeCaller(opts = {}) {
  const al = parseAllowlist(opts.allowlistRaw);
  if (!al.configured) return { decision: 'deny', reason: 'allowlist-unset' }; // Loom: DENY (PACT: disabled)
  if (al.malformed || !al.set) return { decision: 'deny', reason: 'allowlist-malformed' };
  const uid = parseUid(opts.sudoUid);
  if (uid === null) return { decision: 'deny', reason: 'sudo-uid-absent-or-malformed' };
  if (!al.set.has(uid)) return { decision: 'deny', reason: 'caller-not-in-allowlist' };
  return { decision: 'allow', reason: 'authorized' };
}

module.exports = { authorizeCaller, parseAllowlist, parseUid, UID_MAX };
