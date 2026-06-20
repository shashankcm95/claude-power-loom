'use strict';

// packages/kernel/_lib/capability-free-claude.js
//
// Ghost Heartbeat W2-PR1. The SINGLE place the "capability-free claude -p"
// invocation lives. The drift-judge (drift-audit.js) reads attacker-influenceable
// transcript content, so it MUST be unable to invoke ANY tool: no Read/Bash/Write,
// no Monitor, no MCP exfil (Gmail/Drive), no Agent/Workflow spawn. The flags below
// were established by a 7-probe chain on 2026-06-19 (RFC
// packages/specs/rfcs/2026-06-19-ghost-heartbeat-w2-drift-emit.md section 5.6):
//
//   - `--allowedTools ""`               does NOT restrict (it is an auto-APPROVAL
//                                       list, not an availability gate).
//   - `--disallowedTools <set>`         is BYPASSABLE — the model read a planted
//                                       sentinel via the unlisted `Monitor` tool.
//   - `--tools ""`                      removes the core tools but LEAVES LSP + MCP.
//   - `--tools "" --strict-mcp-config`  blocks read + MCP + LSP. THE enforcement.
//
// The guarantee is CLI-version-dependent. DO NOT change CAPABILITY_FREE_ARGS
// without re-running the sentinel-leak regression test
// (tests/unit/kernel/_lib/capability-free-claude.test.js) — it is the standing guard.

const { spawnSync } = require('child_process');

// Cheap model for an advisory classifier. Defaults to PINNED (the child inherits the
// parent's model if unpinned -- the trajectory-friction-run.js bug). Escape hatch:
// override the default via the GHOST_HEARTBEAT_JUDGE_MODEL env var (an explicit `model`
// arg still wins over the env, per JS default-param precedence). RFC OQ-W2-1.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_BUFFER = 8 * 1024 * 1024;

// The load-bearing flags. Frozen + regression-tested. See the header.
const CAPABILITY_FREE_ARGS = Object.freeze(['--tools', '', '--strict-mcp-config']);

// Precedence: explicit `bin` arg > GHOST_HEARTBEAT_JUDGE_BIN env > PATH (`command -v`)
// > bare 'claude'. The env override exists so the SCHEDULER can bake the ABSOLUTE claude
// path into the launchd/cron task: those run with a minimal PATH (/usr/bin:/bin:...) where
// ~/.local/bin/claude is invisible, so a bare PATH resolution ENOENTs (the dogfooded
// failure). The resolved value is a spawnSync target under shell:false -> it is an exec
// target, NEVER a shell string, so an arbitrary bin path cannot shell-inject (it just
// fails to exec). Do NOT "harden" this to shell:true. The drift threat model is
// attacker-influenceable TRANSCRIPT content, not the operator's own env.
function resolveClaude(bin) {
  if (bin) return bin;
  const envBin = (process.env.GHOST_HEARTBEAT_JUDGE_BIN || '').trim();
  if (envBin) return envBin;
  try {
    const which = spawnSync('command', ['-v', 'claude'], { shell: '/bin/bash', encoding: 'utf8' });
    return (which.stdout || '').trim() || 'claude';
  } catch {
    return 'claude';
  }
}

// Pure text in/out. Returns { ok: true, text } | { ok: false, reason }. Never
// throws — fail-soft for the unattended hook/cron callers. The prompt rides
// STDIN (a trailing-argv prompt would be swallowed by the variadic --tools).
function runCapabilityFreeJudge({ prompt, model = process.env.GHOST_HEARTBEAT_JUDGE_MODEL || DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT_MS, bin } = {}) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { ok: false, reason: 'empty-prompt' };
  }
  const claudeBin = resolveClaude(bin);
  const args = ['-p', '--model', model, ...CAPABILITY_FREE_ARGS];
  let res;
  try {
    res = spawnSync(claudeBin, args, {
      input: prompt, encoding: 'utf8', shell: false, timeout, maxBuffer: MAX_BUFFER,
    });
  } catch (err) {
    return { ok: false, reason: `spawn-throw:${err && err.message}` };
  }
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: `spawn-error:${res.error.code || res.error.message}` };
  }
  if (res.status !== 0) return { ok: false, reason: `exit-${res.status}` };
  return { ok: true, text: res.stdout || '' };
}

module.exports = { runCapabilityFreeJudge, CAPABILITY_FREE_ARGS, DEFAULT_MODEL };
