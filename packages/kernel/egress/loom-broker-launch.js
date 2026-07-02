// Power Loom egress — loom-broker-launch.js  (③.2.5b)
//
// crossUidLoomBrokerSigner: a VALIDATED argv builder that wires loomBrokerSigner to a cross-uid
// `sudo -n -u <broker-user> <wrapper>` invocation — ZERO seam change (loomBrokerSigner already accepts an
// arbitrary command/args; recordApproval's signFn seam is untouched). The launcher's ONE job is to remove caller
// choice over the command (PINNED to sudo) and to validate the two attacker-influenced inputs:
//
//   * brokerUser — a leading-dash or metachar username is a `sudo` FLAG-INJECTION vector -> strict POSIX regex.
//   * wrapperPath / sudoPath — a leading-dash or relative path in the COMMAND position is parsed by sudo as an
//     option -> require an absolute, dotdot-free, control-char-free path.
//
// HONEST SCOPE: this builds the cross-uid LAUNCHER; custody-real is a DEPLOYMENT property the operator attests
// out-of-band. The launcher validates the wiring SHAPE; ownership/perms of the wrapper + key are the
// custody-verifier's job (loom-custody-verify.js), not the launcher's.
//
// PORTED verbatim from PACT broker-launch.js with Loom naming.

'use strict';

const { loomBrokerSigner } = require('./loom-broker-client');

// POSIX-portable username: starts with a letter or underscore, then [a-z0-9_-], max 32 chars. Rejects a leading
// dash, whitespace, shell metachars, uppercase, '/', and over-length. A POSITIVE bounded invariant.
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

function assertAbsoluteNoDotDot(p, label) {
  if (typeof p !== 'string' || p.length === 0) {
    throw new TypeError('crossUidLoomBrokerSigner: ' + label + ' is required (an absolute path)');
  }
  if (p[0] !== '/') {
    throw new Error('crossUidLoomBrokerSigner: ' + label + ' must be an ABSOLUTE path — a relative or leading-dash value could be parsed by sudo as an option (got ' + JSON.stringify(p) + ')');
  }
  if (p.split('/').includes('..')) {
    throw new Error('crossUidLoomBrokerSigner: ' + label + ' must not contain a ".." segment (got ' + JSON.stringify(p) + ')');
  }
  // reject NUL + control chars at VALIDATION (else a path with an embedded control byte or newline defers a
  // confusing failure to execFileSync spawn-time). charCode scan, not a control-char regex (keeps eslint clean).
  for (let i = 0; i < p.length; i++) {
    if (p.charCodeAt(i) < 0x20) throw new Error('crossUidLoomBrokerSigner: ' + label + ' must not contain NUL or control characters');
  }
}

/**
 * Build the validated { command, args } for a cross-uid broker invocation. Exported for direct assertion in tests
 * (the argv is otherwise sealed in the loomBrokerSigner closure).
 * @param {{brokerUser:string, wrapperPath:string, sudoPath?:string}} opts
 * @returns {{command:string, args:string[]}}
 * @throws {Error|TypeError} on a flag-injection user or a non-absolute / dotdot-bearing path.
 */
function crossUidSudoArgs(opts = {}) {
  const { brokerUser, wrapperPath } = opts;
  if (typeof brokerUser !== 'string' || !USERNAME_RE.test(brokerUser)) {
    throw new Error('crossUidLoomBrokerSigner: brokerUser must match ' + USERNAME_RE + ' (a POSIX username; a leading-dash / metachar / over-length value is a sudo flag-injection risk) — got ' + JSON.stringify(brokerUser));
  }
  assertAbsoluteNoDotDot(wrapperPath, 'wrapperPath');
  // sudoPath is the ONLY location seam (a non-/usr/bin/sudo deployment, or a test stub). The default bare 'sudo'
  // is resolved via execFileSync's PATH lookup; ANY override must be an absolute path so it can never itself be
  // interpreted as a flag. command is PINNED to sudo — there is no arbitrary-command override.
  const sudoPath = opts.sudoPath === undefined ? 'sudo' : opts.sudoPath;
  if (sudoPath !== 'sudo') assertAbsoluteNoDotDot(sudoPath, 'sudoPath');
  // -n (non-interactive): sudo NEVER blocks on a password prompt — it fails immediately, execFileSync throws, the
  // signer returns null (fail-closed). The loomBrokerSigner timeout is the backstop.
  return { command: sudoPath, args: ['-n', '-u', brokerUser, wrapperPath] };
}

/**
 * A sync signFn (basis, ctx)->base64sig|null that signs THROUGH a separate-uid broker via
 * `sudo -n -u <broker-user> <wrapper> <basis>`. Plugs into the recordApproval signFn seam unchanged.
 * @param {{brokerUser:string, wrapperPath:string, sudoPath?:string, timeoutMs?:number, maxBytes?:number,
 *          neutralizeCwd?:boolean}} opts
 *   neutralizeCwd — forwarded verbatim to loomBrokerSigner: when true the cross-uid child signs from a neutral cwd
 *     (`/`). Engaged ONLY by the broker custody-verify probe (#436-parity); the LIVE approval path (approve-cli.js
 *     -> makeSigner -> here) passes none (undefined) -> the client's `=== true` gate stays false -> byte-identical.
 * @returns {(basis:string, ctx:object)=>string|null}
 */
function crossUidLoomBrokerSigner(opts = {}) {
  const { command, args } = crossUidSudoArgs(opts);
  // explicit neutralizeCwd key (never `...opts`) — an undefined value never sets the client's cwd (byte-identity).
  return loomBrokerSigner({ command, args, timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, neutralizeCwd: opts.neutralizeCwd });
}

module.exports = { crossUidLoomBrokerSigner, crossUidSudoArgs, USERNAME_RE };
