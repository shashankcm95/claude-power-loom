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
// would leak until added here. The dogfood Leg P is the runtime CANARY — it asserts the live init
// reports `tools: []` and WARNs on any leak. A runtime tool-inertness gate is a ③.2.3 carry.
// Callers append these AFTER `-p --model <m>`.
const TOOLLESS_CLAUDE_ARGS = Object.freeze(['--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP']);

// Returns a fresh array (never the frozen singleton) so a caller can spread/concat without mutating
// the recipe. `toolless:false` -> [] (the default un-pinned behavior, byte-identical to legacy).
function toollessArgs(toolless) {
  return toolless ? TOOLLESS_CLAUDE_ARGS.slice() : [];
}

module.exports = { TOOLLESS_CLAUDE_ARGS, toollessArgs };
