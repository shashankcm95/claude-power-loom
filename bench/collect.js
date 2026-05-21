#!/usr/bin/env node

// bench/collect.js — extracts boot-test metrics from a single headless run.
//
// Inputs (all flags):
//   --stream <path>          stream.jsonl from `claude -p --output-format stream-json`
//   --pre    <path>          pre-snapshot JSON (from _snapshot.js)
//   --post   <path>          post-snapshot JSON
//   --workdir <path>         work copy of fixture after claude operated on it
//   --fixture <path>         original fixture (for diff baseline)
//   --wallclock-seconds <n>  shell-measured wallclock
//   --claude-exit <n>        claude -p exit code
//   --mode <plugin-on|plugin-off-bare>
//   --out  <path>            metrics.json output
//
// Output: metrics.json with structured fields:
//   { mode, claude_exit, latency, tokens, turns, tool_uses, subagent_spawns,
//     hook_bumps, fixture_diff, deterministic_pass, transcript_path }
//
// The deterministic_pass evaluation uses ONLY filesystem post-state + counters,
// not LLM judgment.

'use strict';

const fs = require('fs');
const path = require('path');
// Note: execSync was removed when scenario-01 checks moved to validate.js;
// per-scenario validate.js files import execSync themselves where needed.

// --- arg parsing -------------------------------------------------------------
function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { opts[key] = next; i++; }
      else { opts[key] = true; }
    }
  }
  return opts;
}

// --- stream-json parsing -----------------------------------------------------
//
// stream-json from `claude -p` is newline-delimited; each line is a JSON event.
// Event types (per docs):
//   {type: "system", subtype: "init", ...}        // session init; has session_id
//   {type: "assistant", message: {...}}           // assistant text + tool_use blocks
//   {type: "user", message: {...}}                // tool results echoed back
//   {type: "result", subtype: "success"|"error", usage: {...}, duration_ms, ...}

function parseStream(streamPath) {
  if (!fs.existsSync(streamPath)) {
    return { error: `stream file not found: ${streamPath}`, events: 0 };
  }
  const raw = fs.readFileSync(streamPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  const out = {
    events: lines.length,
    session_id: null,
    transcript_path: null,
    result_event: null,
    tool_uses: {},
    subagent_spawns: 0,
    subagent_types: [],          // values from Agent tool input's subagent_type field
    subagent_result_texts: [],   // sub-agent reply text (for KB-ref scanning)
    skill_invocations: [],       // skill names from Skill tool calls
    bash_commands: [],           // Bash command strings (for route-decide detection)
    todo_write_max_items: 0,     // max items in any TodoWrite invocation (plan-mode signal)
    ask_user_question_errors: 0, // count of AskUserQuestion calls that errored back
    text_messages: 0,
    askq_tool_use_ids: new Set(),
    agent_tool_use_ids: new Set(), // map Agent tool_use_ids → their results
  };

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      out.session_id = ev.session_id || (ev.data && ev.data.session_id) || null;
    }
    if (ev.type === 'result') {
      out.result_event = ev;
    }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      out.text_messages++;
      for (const block of ev.message.content) {
        if (block.type === 'tool_use') {
          const name = block.name || 'unknown';
          out.tool_uses[name] = (out.tool_uses[name] || 0) + 1;
          // Sub-agent spawn tool — name changed across Claude Code versions:
          //   Claude Code 1.x: "Task"
          //   Claude Code 2.x: "Agent"
          // Support both for forward/backward compat.
          if (name === 'Agent' || name === 'Task') {
            out.subagent_spawns++;
            const subType = (block.input && (block.input.subagent_type || block.input.subagent || block.input.type)) || 'unspecified';
            out.subagent_types.push(subType);
            out.agent_tool_use_ids.add(block.id);
          }
          if (name === 'Skill') {
            const skillName = (block.input && (block.input.skill || block.input.name)) || 'unspecified';
            out.skill_invocations.push(skillName);
          }
          if (name === 'AskUserQuestion') {
            out.askq_tool_use_ids.add(block.id);
          }
          if (name === 'Bash') {
            const cmd = (block.input && block.input.command) || '';
            out.bash_commands.push(cmd);
          }
          if (name === 'TodoWrite') {
            const todos = (block.input && Array.isArray(block.input.todos)) ? block.input.todos.length : 0;
            if (todos > out.todo_write_max_items) out.todo_write_max_items = todos;
          }
        }
      }
    }
    // User messages can carry tool_result blocks (echoed by the runtime).
    if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result') {
          if (block.is_error && out.askq_tool_use_ids.has(block.tool_use_id)) {
            out.ask_user_question_errors++;
          }
          // Capture sub-agent reply text for downstream KB-ref scanning.
          if (out.agent_tool_use_ids.has(block.tool_use_id)) {
            const content = block.content;
            let text = '';
            if (typeof content === 'string') text = content;
            else if (Array.isArray(content)) {
              text = content.map(c => (c && typeof c === 'object' ? (c.text || '') : String(c))).join('\n');
            }
            if (text) out.subagent_result_texts.push(text);
          }
        }
      }
    }
  }

  // Don't serialize the Sets; downstream consumers only need the captured data.
  delete out.askq_tool_use_ids;
  delete out.agent_tool_use_ids;
  return out;
}

// --- counter diff ------------------------------------------------------------
function diffCounters(pre, post) {
  if (!pre || !post) return { error: 'missing snapshot' };
  const preCounters = (pre.self_improve_counters || {});
  const postCounters = (post.self_improve_counters || {});
  return {
    turn_counter_delta: (postCounters.turnCounter || 0) - (preCounters.turnCounter || 0),
    signal_count_delta: (postCounters.signalCount || 0) - (preCounters.signalCount || 0),
    last_scan_changed: preCounters.lastScanAt !== postCounters.lastScanAt,
    transcripts_added: (post.project_transcripts_total || 0) - (pre.project_transcripts_total || 0),
  };
}

// --- library diff ------------------------------------------------------------
function diffLibrary(pre, post) {
  if (!pre || !post) return { error: 'missing snapshot' };
  const preLib = (pre.library && pre.library.stacks) || {};
  const postLib = (post.library && post.library.stacks) || {};
  const changes = {};
  const allStacks = new Set([...Object.keys(preLib), ...Object.keys(postLib)]);
  for (const stack of allStacks) {
    const before = preLib[stack] || { volume_count: 0, catalog_entries: 0 };
    const after = postLib[stack] || { volume_count: 0, catalog_entries: 0 };
    const volDelta = (after.volume_count || 0) - (before.volume_count || 0);
    const entryDelta = (after.catalog_entries || 0) - (before.catalog_entries || 0);
    if (volDelta !== 0 || entryDelta !== 0) {
      changes[stack] = { volumes_delta: volDelta, entries_delta: entryDelta };
    }
  }
  return changes;
}

// --- fixture diff ------------------------------------------------------------
function diffFixture(workdir, fixture) {
  const out = { modified_files: [], created_files: [], deleted_files: [] };
  if (!fs.existsSync(workdir) || !fs.existsSync(fixture)) return out;

  function listFiles(dir, base = dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(base, full);
      if (ent.isDirectory()) listFiles(full, base, acc);
      else if (ent.isFile()) acc.push(rel);
    }
    return acc;
  }
  const workFiles = new Set(listFiles(workdir));
  const fixFiles = new Set(listFiles(fixture));
  for (const f of workFiles) {
    if (!fixFiles.has(f)) {
      out.created_files.push(f);
    } else {
      try {
        const a = fs.readFileSync(path.join(workdir, f));
        const b = fs.readFileSync(path.join(fixture, f));
        if (!a.equals(b)) out.modified_files.push(f);
      } catch { /* skip binary issues */ }
    }
  }
  for (const f of fixFiles) {
    if (!workFiles.has(f)) out.deleted_files.push(f);
  }
  return out;
}

// --- deterministic PASS criteria --------------------------------------------
//
// Two-layer evaluation:
//   1. UNIVERSAL checks (every scenario): claude_exit_zero, subagent_spawned,
//      no_ask_user_question_errors, stop_hook_fired. Built-in to collect.js.
//   2. SCENARIO-SPECIFIC checks: loaded from `scenarios/<id>/validate.js` if
//      present. Each scenario owns its own validator.
//
// Backward compat: if scenarioDir is null or no validate.js exists, fall back
// to the original scenario-01 hardcoded checks.
function evaluatePassCriteria(workdir, claudeExit, streamMetrics, hookBumps, scenarioDir) {
  const checks = {};

  // === Universal checks ===
  checks.claude_exit_zero = {
    pass: claudeExit === 0,
    detail: `exit=${claudeExit}`,
  };

  const spawnCount = (streamMetrics && streamMetrics.subagent_spawns) || 0;
  checks.subagent_spawned = {
    pass: spawnCount >= 1,
    detail: `${spawnCount} sub-agent spawn(s) via Agent tool`,
  };

  const aukCount = (streamMetrics && streamMetrics.tool_uses && streamMetrics.tool_uses.AskUserQuestion) || 0;
  const aukErrors = (streamMetrics && streamMetrics.ask_user_question_errors) || 0;
  checks.no_ask_user_question_errors = {
    pass: aukErrors === 0,
    detail: `${aukCount} AskUserQuestion call(s); ${aukErrors} errored — should be 0`,
  };

  const turnDelta = (hookBumps && hookBumps.turn_counter_delta) || 0;
  checks.stop_hook_fired = {
    pass: turnDelta >= 1,
    detail: `turnCounter delta=${turnDelta} (Stop hook bumps once per turn)`,
  };

  // === Scenario-specific checks via validate.js ===
  if (scenarioDir) {
    const validatePath = path.join(scenarioDir, 'validate.js');
    if (fs.existsSync(validatePath)) {
      try {
        // Clear require cache so re-derives pick up edits to validate.js
        delete require.cache[require.resolve(validatePath)];
        const mod = require(validatePath);
        if (typeof mod.validate !== 'function') {
          checks.scenario_validate_load_failed = { pass: false, detail: 'validate.js missing validate() export' };
        } else {
          const scenarioChecks = mod.validate(workdir, streamMetrics, hookBumps);
          Object.assign(checks, scenarioChecks);
        }
      } catch (err) {
        checks.scenario_validate_load_failed = { pass: false, detail: `validate.js threw: ${err.message}` };
      }
    } else {
      checks.scenario_validate_missing = { pass: false, detail: `no validate.js at ${validatePath}` };
    }
  }

  return checks;
}

// --- soft signals (reported but don't fail the boot test) -------------------
//
// These detect plugin discipline compliance. They are observational — a `no`
// here is NOT a boot-test failure, but IS a meaningful signal that the
// plugin's auto-trigger behaviors may not be firing under headless mode OR
// may not be enforced for the path the user's task exercised.
//
// Distinguish strict-mode (parent transcript only) from inclusive-mode
// (parent + sub-agent reply texts). Sub-agent KB consultation surfaces in
// agent_result_texts, not the parent's own transcript — so inclusive-mode
// catches it.

function evaluateSoftSignals(workdir, streamMetrics, transcriptPath) {
  const signals = {};

  // Build a combined search corpus: parent transcript JSONL + all sub-agent
  // reply texts captured from Agent tool_results.
  let transcriptContent = '';
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try { transcriptContent = fs.readFileSync(transcriptPath, 'utf8'); } catch { /* skip */ }
  }
  const subagentResults = ((streamMetrics && streamMetrics.subagent_result_texts) || []).join('\n');
  const combinedCorpus = transcriptContent + '\n' + subagentResults;

  // 1. KB consultation — search parent + sub-agent results for kb:architecture refs.
  const kbRefs = combinedCorpus.match(/kb:[a-z][a-z0-9\-/]+/gi) || [];
  signals.kb_consultation = {
    observed: kbRefs.length > 0,
    detail: kbRefs.length > 0
      ? `${kbRefs.length} kb refs: ${[...new Set(kbRefs)].slice(0, 5).join(', ')}`
      : 'no kb: references in parent transcript OR sub-agent results',
  };

  // 2. Specialist agent spawns — architect / code-reviewer / security-auditor
  const subagentTypes = (streamMetrics && streamMetrics.subagent_types) || [];
  const hasArchitect = subagentTypes.some(t => /architect/i.test(t));
  const hasCodeReviewer = subagentTypes.some(t => /code.?review|reviewer/i.test(t));
  const hasSecurityAuditor = subagentTypes.some(t => /security/i.test(t));
  signals.specialist_agents_spawned = {
    observed: hasArchitect || hasCodeReviewer || hasSecurityAuditor,
    detail: `subagent_types=[${subagentTypes.join(', ')}]; architect=${hasArchitect ? 'yes' : 'no'} code-reviewer=${hasCodeReviewer ? 'yes' : 'no'} security=${hasSecurityAuditor ? 'yes' : 'no'}`,
  };

  // 3. Plan-before-edit discipline evidence (post-GAP-B rewrite of workflow.md).
  //    The rule decouples intent (plan before editing) from mechanism (specific tool).
  //    Accept any of:
  //      (a) EnterPlanMode/ExitPlanMode tool calls (interactive-style mechanism)
  //      (b) Skill("plan") invocation (Claude Code 1.x path)
  //      (c) TodoWrite with ≥2 items (the headless-mode artifact convention)
  //      (d) A plan-file at .claude/plans/*.md in the workdir
  const toolUses = (streamMetrics && streamMetrics.tool_uses) || {};
  const skillCalls = (streamMetrics && streamMetrics.skill_invocations) || [];
  const planModeTools = (toolUses.EnterPlanMode || 0) + (toolUses.ExitPlanMode || 0);
  const hasPlanSkill = skillCalls.some(s => /plan/i.test(s));
  const todoWriteCalls = toolUses.TodoWrite || 0;
  const todoWriteMaxItems = (streamMetrics && streamMetrics.todo_write_max_items) || 0;
  const hasTodoWritePlanning = todoWriteCalls > 0 && todoWriteMaxItems >= 2;

  let planFileExists = false;
  let planFilePath = null;
  try {
    const plansDir = path.join(workdir, '.claude/plans');
    if (fs.existsSync(plansDir)) {
      const entries = fs.readdirSync(plansDir).filter(f => f.endsWith('.md'));
      if (entries.length > 0) {
        planFileExists = true;
        planFilePath = path.join(plansDir, entries[0]);
      }
    }
  } catch { /* skip */ }

  const observed = planModeTools > 0 || hasPlanSkill || hasTodoWritePlanning || planFileExists;
  signals.plan_mode_evidence = {
    observed,
    detail: `EnterPlanMode/ExitPlanMode=${planModeTools}; plan-skill=${hasPlanSkill ? 'yes' : 'no'}; TodoWrite ${todoWriteCalls} call(s) max ${todoWriteMaxItems} items; plan-file=${planFilePath || 'none'}`,
  };

  // 4. Route-decide gate consulted — two detection paths:
  //    (a) Bash invocation by Claude in-session (rare; pre-GAP-C-fix path)
  //    (b) PreToolUse hook `route-decide-on-agent-spawn.js` logged entries
  //        to ~/.claude/checkpoints/route-decide-log.jsonl (GAP-C fix;
  //        deterministic via hooks/hooks.json PreToolUse:Agent|Task matcher)
  const bashCmds = (streamMetrics && streamMetrics.bash_commands) || [];
  const routeDecideBashHit = bashCmds.some(cmd => /route-decide(\.js)?/.test(cmd));

  const routeDecideLogPath = path.join(require('os').homedir(), '.claude/checkpoints/route-decide-log.jsonl');
  let routeDecideHookHits = 0;
  const sessionId = streamMetrics && streamMetrics.session_id;
  if (fs.existsSync(routeDecideLogPath)) {
    try {
      const lines = fs.readFileSync(routeDecideLogPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (sessionId && entry.session_id === sessionId) {
          routeDecideHookHits++;
        }
      }
    } catch { /* skip */ }
  }

  const consulted = routeDecideBashHit || routeDecideHookHits > 0;
  signals.route_decide_consulted = {
    observed: consulted,
    detail: consulted
      ? `route-decide consulted (${routeDecideHookHits} hook hits for this session_id; ${routeDecideBashHit ? '1' : '0'} Bash hits)`
      : `route-decide NOT consulted (${routeDecideHookHits} hook hits; ${bashCmds.length} Bash calls scanned) — workflow rule unenforced for this session`,
  };

  // 5. Research-mode citations — factual claims about APIs/libraries should
  //    cite a source (URL, file:line, docs link). Heuristic: look for
  //    citation patterns in the combined corpus.
  const citationPatterns = [
    /https?:\/\/[a-z0-9.-]+/i,
    /[a-z][a-z0-9_-]+\.[a-z]+:\d+/i,          // file.ext:line
    /per\s+(the\s+)?docs/i,
    /per\s+RFC\s+\d+/i,
    /MDN/,
  ];
  const citationCount = citationPatterns.reduce(
    (acc, re) => acc + (combinedCorpus.match(new RegExp(re.source, 'gi')) || []).length, 0
  );
  signals.research_mode_citations = {
    observed: citationCount > 0,
    detail: citationCount > 0
      ? `${citationCount} citation-like pattern(s) found`
      : 'no citations (URLs, file:line, "per docs", RFC refs)',
  };

  return signals;
}

// --- main --------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  // scenario + expected are optional for back-compat with single-shot runs
  const required = ['stream', 'pre', 'post', 'workdir', 'fixture', 'wallclock-seconds', 'claude-exit', 'mode', 'out'];
  for (const r of required) {
    if (opts[r] === undefined) {
      process.stderr.write(`collect: missing required --${r}\n`);
      process.exit(2);
    }
  }

  const pre = JSON.parse(fs.readFileSync(opts.pre, 'utf8'));
  const post = JSON.parse(fs.readFileSync(opts.post, 'utf8'));
  const stream = parseStream(opts.stream);

  const usage = (stream.result_event && stream.result_event.usage) || {};
  const claudeExit = parseInt(opts['claude-exit'], 10);
  const wallSecs = parseFloat(opts['wallclock-seconds']);

  // Look up transcript path by session_id.
  let transcriptPath = null;
  if (stream.session_id) {
    const projectsRoot = path.join(process.env.HOME, '.claude/projects');
    if (fs.existsSync(projectsRoot)) {
      outer:
      for (const proj of fs.readdirSync(projectsRoot)) {
        const candidate = path.join(projectsRoot, proj, `${stream.session_id}.jsonl`);
        if (fs.existsSync(candidate)) {
          transcriptPath = candidate;
          break outer;
        }
      }
    }
  }

  // Load scenario expected.json if provided (for cross-reference + reporting)
  let scenarioExpected = null;
  if (opts.expected && fs.existsSync(opts.expected)) {
    try { scenarioExpected = JSON.parse(fs.readFileSync(opts.expected, 'utf8')); }
    catch (_err) { /* ignore parse errors; scenarioExpected stays null */ }
  }

  const hookBumps = diffCounters(pre, post);
  const metrics = {
    scenario_id: opts.scenario || null,
    scenario_description: scenarioExpected ? scenarioExpected.description : null,
    mode: opts.mode,
    timestamp: new Date().toISOString(),
    claude_exit: claudeExit,
    session_id: stream.session_id,
    transcript_path: transcriptPath,
    stream_events: stream.events,
    latency: {
      wallclock_seconds: wallSecs,
      duration_ms: stream.result_event ? stream.result_event.duration_ms : null,
      duration_api_ms: stream.result_event ? stream.result_event.duration_api_ms : null,
    },
    turns: stream.result_event ? stream.result_event.num_turns : null,
    tokens: {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
      cache_creation: usage.cache_creation_input_tokens || 0,
    },
    tool_uses: stream.tool_uses,
    subagent_spawns: stream.subagent_spawns,
    subagent_types: stream.subagent_types,
    skill_invocations: stream.skill_invocations,
    ask_user_question_errors: stream.ask_user_question_errors,
    hook_bumps: hookBumps,
    library_diff: diffLibrary(pre, post),
    fixture_diff: diffFixture(opts.workdir, opts.fixture),
    deterministic_pass: evaluatePassCriteria(opts.workdir, claudeExit, stream, hookBumps, opts.expected ? path.dirname(opts.expected) : null),
    soft_signals: evaluateSoftSignals(opts.workdir, stream, transcriptPath),
  };

  fs.writeFileSync(opts.out, JSON.stringify(metrics, null, 2));
  process.stderr.write(`metrics written: ${opts.out}\n`);
}

if (require.main === module) main(process.argv);

module.exports = { parseStream, diffCounters, diffLibrary, diffFixture, evaluatePassCriteria };
