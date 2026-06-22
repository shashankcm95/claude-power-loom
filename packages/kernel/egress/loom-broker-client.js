// Power Loom egress — loom-broker-client.js  (③.2.5b)
//
// loomBrokerSigner: the host-side custody CLIENT. Returns a SYNCHRONOUS signFn(basis, ctx)->base64sig|null that
// plugs into the EXISTING recordApproval `signFn` seam (approval-store.js calls signFn(basis, ctx)) with ZERO
// change to recordApproval / the verify half. It invokes a separate-process broker via execFileSync, writes the
// approval CONTEXT preimage on the child's stdin (so the broker can recompute-bind), and re-gates the output. It
// holds NO key material — the key path is set ONLY in the broker child's env (opts.keyFile), never read here.
//
// SECURITY (ported from PACT broker-client.js):
//   * env ALLOWLIST, never process.env. The child env is built FROM SCRATCH — process.env is NEVER spread — so
//     NODE_OPTIONS / --require / LD_* / DYLD_* cannot be inherited into the key-holding broker child. A POSITIVE
//     bounded invariant (allowlist), not a denylist.
//   * fixed command + args; the basis is the strict-hex64 FINAL arg; no shell -> no argv injection.
//   * bounded maxBuffer + timeout -> output-flood / hang DoS -> execFileSync throws -> null (fail closed).
//   * the canonical-base64 + 64-byte output re-gate is DEFENSE-IN-DEPTH (the wrapper's signRecordId re-gates too).
//
// HONEST SCOPE: this is the custody MECHANISM (key out of the host heap), custody-real ONLY cross-uid (a DEPLOYMENT
// property). The client-side gates are NOT a security boundary (the wrapper CLI is directly invokable); they are
// defense-in-depth. All security lives in the key-holding wrapper (loom-broker-sign.js).

'use strict';

const { execFileSync } = require('child_process');
const { isCanonicalBase64 } = require('../_lib/edge-attestation');

// the basis is a lowercase 64-hex sha256 — never spawn on a malformed one. Local check (edge-attestation does not
// export an isHex64).
const HEX64 = /^[0-9a-f]{64}$/;
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// opts.env is a caller-allowlisted EXTRAS channel — but it must not re-open the code-loading hole the env scrub
// closes, nor shadow the key-path channel. Refuse the node/linker hijack vars + LOOM_BROKER_KEY_FILE. Case-
// insensitive (defense-in-depth clarity — VALIDATE hacker LOW; the linker only honors canonical upper-case, and
// process.env is never spread, so this is belt-and-suspenders on the explicit-extras channel).
const RESERVED_ENV = /^(NODE_OPTIONS|LOOM_BROKER_KEY_FILE|LD_|DYLD_)/i;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 4096;
// the serialized ctx the host writes to the broker's stdin — capped to match the wrapper's stdin bound so the
// client fails FAST (no wasted serialize/spawn) on an over-large ctx the broker would refuse anyway (CodeRabbit).
const MAX_CTX_BYTES = 1024 * 1024;

/**
 * A sync signFn over a separate-process broker.
 * @param {{command?:string, args?:string[], keyFile?:string, env?:object, timeoutMs?:number, maxBytes?:number}} opts
 *   command  — the broker executable (default: this node). args — fixed leading args (e.g. the broker script).
 *   keyFile  — convenience: sets LOOM_BROKER_KEY_FILE in the (allowlisted) child env.
 *   env      — extra caller-ALLOWLISTED child vars (explicit; process.env is never inherited).
 * @returns {(basis:string, ctx:object)=>string|null}  base64 sig, or null (fail-closed) on any error.
 */
function loomBrokerSigner(opts = {}) {
  const command = opts.command || process.execPath;
  const args = Array.isArray(opts.args) ? opts.args : [];
  // positive guards: execFileSync treats timeout:0 as "no timeout" (a footgun) — require a POSITIVE integer;
  // same for the maxBuffer bound. A 0/negative falls back to the default.
  const timeout = (Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxBuffer = (Number.isInteger(opts.maxBytes) && opts.maxBytes > 0) ? opts.maxBytes : DEFAULT_MAX_BYTES;
  // env ALLOWLIST: build from scratch; NEVER spread process.env. opts.keyFile is the SOLE key-path channel;
  // opts.env extras are refused if they'd re-open the hole (RESERVED_ENV).
  const env = {};
  if (typeof opts.keyFile === 'string') env.LOOM_BROKER_KEY_FILE = opts.keyFile;
  if (opts.env && typeof opts.env === 'object') {
    for (const k of Object.keys(opts.env)) {
      if (RESERVED_ENV.test(k)) {
        throw new Error('loomBrokerSigner: opts.env may not set a code-loading/key-path var (' + k + ') — use opts.keyFile for the key path');
      }
      env[k] = opts.env[k];
    }
  }
  return function sign(basis, ctx) {
    if (!isHex64(basis)) return null;            // never spawn on a bad basis (and never let argv smuggle a flag)
    if (ctx === null || ctx === undefined) return null; // never spawn on a null ctx (would deny broker-side anyway)
    // the broker ALWAYS recompute-binds, so the ctx preimage is ALWAYS written on the child's stdin.
    const input = typeof ctx === 'string' ? ctx : JSON.stringify(ctx);
    if (input.length > MAX_CTX_BYTES) return null; // fail-fast: over the wrapper's stdin bound -> never spawn
    const spawnOpts = { timeout, maxBuffer, env, stdio: ['pipe', 'pipe', 'ignore'], input };
    let out;
    try {
      out = execFileSync(command, [...args, basis], spawnOpts);
    } catch { return null; } // spawn error / non-zero exit / timeout / maxBuffer overflow -> fail closed
    const sig = out.toString('utf8').trim();
    if (!isCanonicalBase64(sig)) return null; // defense-in-depth (the wrapper's signRecordId re-gates too)
    return Buffer.from(sig, 'base64').length === 64 ? sig : null;
  };
}

module.exports = { loomBrokerSigner, RESERVED_ENV };
