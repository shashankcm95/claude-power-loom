'use strict';

// The TOOL-LESS `claude -p` recipe — firsthand re-verified on claude 2.1.177 by the ③.2.2c dogfood
// (NOT trusted from the [[capability-free-claude-headless]] memory note, which was STALE):
//   `--tools "" --strict-mcp-config --disallowedTools LSP`  ->  init `tools: []`, `mcp_servers: []`.
// Why each flag (each probed against the live CLI init event):
//   - `--tools ""`            drops the DEFAULT toolset (Read/Edit/Write/Bash/...). Variadic, so the
//                             empty string must be followed by a flag to bound the list to [""].
//   - `--strict-mcp-config`   blocks every ambient MCP server (no `--mcp-config` => none loaded).
//   - `--disallowedTools LSP` removes LSP, an ALWAYS-ON built-in that `--tools ""` does NOT cover.
//                             Without it the init reports `tools: ["LSP"]` (the dogfood caught this —
//                             a code-intelligence tool a prompt-injected judge could read the cwd with).
// A tool-less judge can only REASON — a prompt-injected verdict on attacker text has no host-action
// blast radius. ③.2.2c VERIFY HIGH fold: the live-loop judges run host-side on attacker-influenced
// text, so they MUST be tool-pinned (the contained actor's no-Bash pin, applied to the judge path).
//
// RESIDUAL (enumerative denylist): `--disallowedTools` is a denylist, so a FUTURE always-on built-in
// would leak until added here. The dogfood Leg P is the manual CANARY; `verifyToollessRuntime` (below,
// ③.2.3 H5) is the RUNTIME GATE that turns "trust the recipe constant" into a fail-closed preflight.
// Callers append these AFTER `-p --model <m>`.
const TOOLLESS_CLAUDE_ARGS = Object.freeze(['--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP']);

const { spawnSync } = require('child_process');

// Returns a fresh array (never the frozen singleton) so a caller can spread/concat without mutating
// the recipe. `toolless:false` -> [] (the default un-pinned behavior, byte-identical to legacy).
function toollessArgs(toolless) {
  return toolless ? TOOLLESS_CLAUDE_ARGS.slice() : [];
}

// ③.2.3 H5 — the RUNTIME tool-inertness gate. Spawns a one-shot `claude -p` with the tool-less recipe +
// `--output-format stream-json`, parses the INIT event's `tools` array, and FAILS CLOSED on EVERY path
// that is not a successfully-parsed EMPTY tools array. This INVERTS the dogfood Leg P / kernel-G4 canary
// semantics (those SKIP-on-inconclusive = fail-OPEN, correct for a non-blocking canary; a runtime gate
// that admits attacker-influenced text into a host-side judge MUST fail-CLOSED on inconclusive — a CLI
// regression that leaks a tool AND perturbs the init/exit shape must NOT slip through). VERIFY-board VF3.
// Returns { ok, tools?, reason? }. The caller proceeds ONLY on `r && r.ok === true`.
function verifyToollessRuntime({ bin, model = 'claude-sonnet-4-6', timeout = 90000, spawnFn = spawnSync } = {}) {
  if (!bin) return { ok: false, reason: 'bin-absent' };
  const argv = ['-p', '--model', model, ...TOOLLESS_CLAUDE_ARGS, '--output-format', 'stream-json', '--verbose'];
  let res;
  try { res = spawnFn(bin, argv, { input: 'hi', shell: false, timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
  catch { return { ok: false, reason: 'spawn-threw' }; }
  if (!res || (res.error && res.error.code === 'ETIMEDOUT')) return { ok: false, reason: 'timeout' };
  if (res.error) return { ok: false, reason: 'spawn-error' };
  if (res.status !== 0) return { ok: false, reason: 'nonzero-exit' };
  let initTools = null;
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    // First parseable init is authoritative — the real `claude -p` emits EXACTLY ONE system/init event,
    // so a forged second init cannot relax the gate (and a leaked-first/empty-second sequence still fails closed).
    if (e && e.type === 'system' && e.subtype === 'init') { initTools = Array.isArray(e.tools) ? e.tools : 'NOT_ARRAY'; break; }
  }
  if (initTools === null) return { ok: false, reason: 'no-init-event' };
  if (initTools === 'NOT_ARRAY') return { ok: false, reason: 'tools-not-array' };
  if (initTools.length > 0) return { ok: false, reason: 'tools-leaked', tools: initTools };
  return { ok: true, tools: [] };
}

module.exports = { TOOLLESS_CLAUDE_ARGS, toollessArgs, verifyToollessRuntime };
