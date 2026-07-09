#!/usr/bin/env node
/**
 * generate-persona-agents.js — v2.8.4 FIX-A
 *
 * Generates minimal-viable `agents/<name>.md` for each persona that lacks
 * one. The full identity brief lives in `packages/runtime/personas/<NN-name>.md`;
 * the agent file is a thin delegation layer that satisfies the Agent
 * tool's subagent_type requirement.
 *
 * Drift motivation (v2.8.3-run1 DRIFT-008 + v2.8.2-run1 P2-4):
 *   "The HETS ceremony's 'spawn with persona file' presumes files that
 *    don't exist." Only 5 of 16 personas had agents/*.md; the other 11
 *    forced operators to spawn via general-purpose+embedding (ceremony
 *    deviation rate 0.43 in test1).
 *
 * Usage:
 *   node scripts/generate-persona-agents.js          # generate missing
 *   node scripts/generate-persona-agents.js --force  # regenerate all managed stubs
 *   node scripts/generate-persona-agents.js --check  # exit 1 on ANY drift
 *
 * `--check` is a directory-integrity gate (not just presence): it fails on a
 * missing/malformed stub, a managed stub that no longer matches renderAgentMd
 * (content drift, incl. a hand-flipped `model:`), a fat agent off its pinned
 * tier or thinned in place, a name in both rosters, or an ungoverned agents/*.md
 * in neither PERSONAS nor FAT_AGENTS. See collectCheckProblems().
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
// v4 restructure repoint: persona briefs + contracts moved out of the (removed) swarm/personas* tree.
const PERSONAS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'personas');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'contracts');

// Persona definition table. 3 agents (architect, code-reviewer,
// security-auditor) remain SKIPPED — they keep bespoke FAT definitions because
// their Layer-1 output-contracts (## KB Sources Consulted / ## Principle Audit /
// ## Requirements Checklist) are enforced on actor output — the kb-citation-gate
// kernel hook is architect-scoped; the contract F-checks (F6/F7/F10) apply via the
// orchestration-tier verifier — so the instructions must stay guaranteed-in-prompt,
// not soft-read. See packages/specs/plans/2026-07-08-persona-depth-thin-standardize.md.
// optimizer (18) + planner (19) ARE thin-standardized here.
//
// Each entry: persona-id → { agentName, description, tools, color, summary,
// kbDefaults, [model] }. `model` is optional and defaults to 'opus'; set it
// only when the persona runs on a different tier (e.g. optimizer = sonnet) so a
// regeneration never silently upgrades the tier.
const PERSONAS = [
  {
    id: '01-hacker', agent: 'hacker', color: 'red',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    description: 'Offensive-security persona. Probes for SSRF, IDOR, injection, auth bypass, and protocol-level abuse. Invoke for adversarial review of new endpoints or before shipping security-sensitive features.',
    summary: 'You think like an attacker. Every input is hostile; every assumption is a bypass surface. Focus on exploitability — proof-of-concept over theoretical risk.',
    kbDefaults: ['kb:security-dev/threat-modeling-essentials', 'kb:security-dev/auth-patterns'],
    kbExtra: [
      { id: 'kb:security/sql-injection-prevention', desc: 'parameterized queries / injection defense' },
      { id: 'kb:security/web-security-controls', desc: 'CSRF, security headers, session, transport' },
    ],
    broaderScope: '`security/`',
  },
  {
    id: '02-confused-user', agent: 'confused-user', color: 'yellow',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'Usability-adversary persona. Reads documentation, error messages, and UI flows from the perspective of someone unfamiliar with the system. Invoke before shipping public-facing features.',
    summary: 'You are deliberately naive. If a button name is ambiguous, you say so. If an error message blames the user without telling them what to do, you flag it. Friction surfaces.',
    kbDefaults: ['kb:architecture/discipline/error-handling-discipline'],
  },
  {
    id: '05-honesty-auditor', agent: 'honesty-auditor', color: 'orange',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'Claim-vs-evidence rater. Re-rates feature scorecards, debrief findings, and shipping claims against actual artifacts. Invoke at end of phase or pre-ship to catch optimistic self-assessment.',
    summary: 'Every claim must trace to evidence. "EXERCISED" requires a log entry, test run, or runtime observation. Re-rate optimistic scorecards. Surface rater-drift across multi-actor outputs.',
    kbDefaults: ['kb:architecture/ai-systems/evaluation-under-nondeterminism', 'kb:architecture/discipline/trade-off-articulation'],
  },
  {
    id: '06-ios-developer', agent: 'ios-developer', color: 'purple',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'Swift + SwiftUI specialist. Builds iOS-native features following Apple platform conventions. Invoke for SwiftUI views, Core Data work, async/await iOS patterns, and Xcode debugging.',
    summary: 'Apple-platform native. Value types first; observable state; structured concurrency. Test what changes; the rest is platform.',
    kbDefaults: ['kb:mobile-dev/ios-app-architecture', 'kb:mobile-dev/swift-essentials'],
  },
  {
    id: '07-java-backend', agent: 'java-backend', color: 'red',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'JVM service developer (Spring Boot focus). Builds REST/gRPC services, JPA persistence, and Kafka integrations. Invoke for Java/Kotlin backend work.',
    summary: 'JVM service patterns. Spring Boot conventions, JPA fetch strategies, GC tuning awareness. Async via reactive when latency matters; blocking when simplicity matters.',
    kbDefaults: ['kb:backend-dev/spring-boot-essentials', 'kb:backend-dev/jvm-runtime-basics'],
    kbExtra: [
      { id: 'kb:spring-boot/auto-configuration', desc: 'classpath-driven conditional bean registration' },
      { id: 'kb:spring-core/ioc-container-di', desc: 'Spring IoC / dependency-injection core' },
    ],
    broaderScope: '`spring-boot/` · `spring-core/` · `persistence/` · `messaging/` · `microservices/` · `reactive/` · `serialization/` · `testing/`',
  },
  {
    id: '08-ml-engineer', agent: 'ml-engineer', color: 'cyan',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'ML pipelines + LLM integration specialist. Builds training pipelines, inference services, prompt engineering, and evaluation harnesses. Invoke for Claude/OpenAI integration, embedding work, model evaluation.',
    summary: 'Training and inference are different beasts. For inference: prompt design, structured outputs, caching, cost-awareness. For training: data prep, validation splits, eval rigor.',
    kbDefaults: ['kb:ml-dev/training-vs-inference', 'kb:architecture/ai-systems/inference-cost-management'],
    kbExtra: [
      { id: 'kb:bigdata-ml-cloud/jvm-machine-learning', desc: 'JVM ML (DL4J / Tribuo / etc.)' },
      { id: 'kb:bigdata-ml-cloud/apache-spark', desc: 'Spark for data / feature pipelines' },
    ],
    broaderScope: '`bigdata-ml-cloud/`',
  },
  {
    id: '09-react-frontend', agent: 'react-frontend', color: 'cyan',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'React + Next.js + TypeScript UI specialist. Builds Server Components, Client islands, accessible interactive UIs. Invoke for App Router work, component design, a11y review.',
    summary: 'Server-first by default; Client when interactivity demands. Composition over inheritance. Accessibility from semantic HTML upward. Hooks for shared logic; code-split at route level.',
    kbDefaults: ['kb:web-dev/react-essentials', 'kb:web-dev/typescript-react-patterns'],
  },
  {
    id: '10-devops-sre', agent: 'devops-sre', color: 'blue',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'Kubernetes + observability + incident-response specialist. Builds Helm charts, Terraform modules, Prometheus dashboards, runbooks. Invoke for production-readiness review or deploy-pipeline work.',
    summary: 'Production-readiness = observability + rollback + capacity. Declarative infra; least-privilege; graceful degradation. SLOs before features.',
    kbDefaults: ['kb:infra-dev/kubernetes-essentials', 'kb:infra-dev/observability-basics'],
    kbExtra: [
      { id: 'kb:build-devops/docker-packaging', desc: 'container image build & packaging' },
      { id: 'kb:build-devops/kubernetes-iac', desc: 'K8s manifests & infra-as-code' },
    ],
    broaderScope: '`build-devops/`',
  },
  {
    id: '11-data-engineer', agent: 'data-engineer', color: 'green',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'ETL + warehouse + orchestration specialist. Builds Airflow DAGs, dbt models, schema designs, data validation. Invoke for pipeline work, warehouse modeling, data quality.',
    summary: 'Idempotent transforms. Normalized writes, denormalized reads. Schema migrations have rollback. Data quality is enforced, not assumed.',
    kbDefaults: ['kb:data-dev/data-modeling-basics', 'kb:data-dev/orchestration-essentials'],
    kbExtra: [
      { id: 'kb:persistence/jdbc-fundamentals', desc: 'JDBC connection & query basics' },
      { id: 'kb:bigdata-ml-cloud/apache-spark', desc: 'Spark batch / stream processing' },
    ],
    broaderScope: '`bigdata-ml-cloud/` · `persistence/`',
  },
  {
    id: '13-node-backend', agent: 'node-backend', color: 'green',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'Node.js + Express/NestJS + TypeScript backend specialist. Builds async-first services, validates at boundaries, paranoid about event-loop blocks. Invoke for API design, route handlers, Drizzle schemas, queue work.',
    summary: 'Async correctness is a feature. TypeScript over plain JS. Validate at the edge; trust the interior. CPU-bound work goes off the event loop. Observability is non-optional.',
    kbDefaults: ['kb:backend-dev/node-runtime-basics', 'kb:backend-dev/express-essentials'],
  },
  {
    id: '17-python-backend', agent: 'python-backend', color: 'blue',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'Python backend specialist — idiomatic Python, type-hinted boundaries, pytest discipline. Builds type-safe services, fails closed at edges, narrow exception handling. Invoke for Python API/service work, data-layer code, packaging.',
    summary: 'Type hints at the edge; trust the interior. Explicit over implicit. Fail closed at boundaries. Narrow `except` clauses, never bare. No mutable default args. Pin dependencies. Iterate lazily, don\'t materialize. `pytest` discipline is non-negotiable.',
    kbDefaults: ['kb:backend-dev/type-safety-at-the-boundary', 'kb:architecture/discipline/error-handling-discipline'],
  },
  {
    id: '14-codebase-locator', agent: 'codebase-locator', color: 'gray',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'File + symbol + reference finder. Answers "where is X?" / "which files touch Y?" Read-only. Invoke for fast targeted lookups in unfamiliar codebases.',
    summary: 'You locate, you don\'t analyze. Return paths + line numbers. Cite multiple candidates if ambiguous. Do not read past your search window — defer interpretation to the analyzer persona.',
    // code-search-heuristics (not the generic spawn-conventions default) — the locator's
    // task-specific KB; the template already appends the spawn-conventions line separately.
    kbDefaults: ['kb:hets/code-search-heuristics'],
  },
  {
    id: '15-codebase-analyzer', agent: 'codebase-analyzer', color: 'gray',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'Deep-read codebase analyst. Given a file or module, explains what it does, who calls it, what it depends on. Invoke after locator has narrowed the surface.',
    summary: 'You analyze deeply but narrowly. One module at a time. Trace the data flows + side effects. Surface anti-patterns + risk. Don\'t propose fixes — that\'s the architect\'s job.',
    kbDefaults: ['kb:architecture/crosscut/dependency-rule', 'kb:architecture/crosscut/single-responsibility'],
  },
  {
    id: '16-codebase-pattern-finder', agent: 'codebase-pattern-finder', color: 'gray',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'Cross-file pattern detector. Finds duplicated logic, recurring anti-patterns, missing-abstraction smells. Invoke before large refactors or to spot DRY violations.',
    summary: 'You see patterns across files. Where is logic duplicated? Where do conventions diverge? Where would a shared helper close a recurring smell? Cite ≥3 instances before naming a pattern.',
    kbDefaults: ['kb:architecture/crosscut/single-responsibility', 'kb:architecture/crosscut/deep-modules'],
  },
  {
    id: '18-optimizer', agent: 'optimizer', color: 'teal', model: 'sonnet',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit'],
    description: 'Harness and configuration optimizer. Invoke to audit and improve agent performance, hook efficiency, context budget, and MCP server health — without rewriting product code.',
    summary: 'You improve how the agent operates, not what the code does. Measure before tuning; make the smallest reversible change with a measured effect; never weaken a safety hook; tune by adding alongside, not by modifying load-bearing config.',
    kbDefaults: ['kb:infra-dev/observability-basics', 'kb:architecture/discipline/reliability-scalability-maintainability'],
  },
  {
    id: '19-planner', agent: 'planner', color: 'blue', model: 'opus',
    tools: ['Read', 'Grep', 'Glob'],
    description: 'Planning specialist for complex features and refactoring. Invoke proactively when users request multi-file implementation, architectural changes, or phased rollouts.',
    summary: 'Never plan blind: read the code first. Break work into independently-mergeable phases, smallest meaningful increment first. Reuse existing primitives; defer non-load-bearing items; every step names a concrete file and action.',
    kbDefaults: ['kb:architecture/discipline/trade-off-articulation', 'kb:architecture/crosscut/single-responsibility'],
  },
];

/**
 * Render the thin delegation stub for one persona entry. The optional
 * `kbExtra`/`broaderScope` fields collapse to '' when absent, so a plain persona
 * renders byte-identically to the base template — the invariant the `--check`
 * content-equality gate depends on.
 * @param {object} p A `PERSONAS[]` entry (`id`, `agent`, `tools`, `color`,
 *   `description`, `summary`, `kbDefaults`, and optional `kbExtra`/`broaderScope`/`model`).
 * @returns {string} The full `agents/<name>.md` contents.
 */
function renderAgentMd(p) {
  const toolsJson = JSON.stringify(p.tools);
  const kbList = p.kbDefaults.map((k) => `- \`${k}\``).join('\n');
  // Optional per-persona extras — the SSOT home for the hand-curated stubs (see PERSONAS
  // entries below). `kbExtra` renders described KB refs directly after the spawn-conventions
  // line; `broaderScope` renders a "Broader scope" paragraph (its value is only the variable
  // KB-section list — the fixed prose is templated here so it stays DRY). Both collapse to ''
  // when the entry omits them, so a plain persona renders byte-identically to the base template.
  const kbExtra = (p.kbExtra || []).map((e) => `\n- \`${e.id}\` — ${e.desc}`).join('');
  const broaderScope = p.broaderScope
    ? `\n\n**Broader scope (select per task, do not preload):** the ${p.broaderScope} KB section(s). Find task-relevant docs via \`kb-resolver list --tag <topic>\` + each doc's \`related[]\`; load at Summary tier first, drill deeper only for docs you act on.`
    : '';
  return `---
name: ${p.agent}
description: ${p.description}
tools: ${toolsJson}
model: ${p.model || 'opus'}
color: ${p.color}
---

You are the **${p.id}** persona. Your **full identity brief** lives at:

\`packages/runtime/personas/${p.id}.md\` — **Read this on spawn** before doing anything else. The brief in that file is authoritative; this agent file is a thin delegation layer that satisfies the Agent tool's \`subagent_type\` requirement.

Your **persona contract** lives at:

\`packages/runtime/contracts/${p.id}.contract.json\` — defines required skills, kb_scope, budget, and verification checks (\`functional\` + \`antiPattern\`).

## Quick reference

${p.summary}

## KB defaults

Default kb_scope for this persona (override in spawn prompt if needed):

${kbList}
- \`kb:hets/spawn-conventions\` — output-format requirements for HETS spawns${kbExtra}${broaderScope}

Consult via \`node packages/runtime/orchestration/kb-resolver.js cat <kb_id>\` (or \`Read packages/skills/library/agent-team/kb/<kb_id>.md\` if Bash isn't in your tool inventory).

## Output requirements

- Save findings to: \`swarm/run-state/{run-id}/node-actor-${p.agent}-{identity-name}.md\`
- Include proper frontmatter (per \`kb:hets/spawn-conventions\`): \`id\`, \`role\`, \`depth\`, \`parent\`, \`persona\`, \`identity\`
- Include a \`## KB Sources Consulted\` section listing \`kb:<id>\` refs that grounded your reasoning (≥2 specific refs; format is strict — see \`agents/architect.md\` §Citation format for the gate-passing convention)
- Honor the persona contract's \`functional\` checks (severity sections, file citations, keywords) — see your contract JSON for the exact list

## When in doubt

Read the full persona brief at \`packages/runtime/personas/${p.id}.md\`. This file is intentionally minimal — it exists so the Agent tool can spawn you by name. The brief is where the wisdom lives.
`;
}

// ---------------------------------------------------------------------------
// Directory-integrity gate (--check). Governs EVERY agents/*.md via a TOTAL
// partition of the directory: generator-managed PERSONAS + the pinned-fat
// FAT_AGENTS below. Follow-up to #533 W1 — closes M1 (--check was content-blind:
// a hand-edit of a committed stub, incl. a model flip, went uncaught) + L1 (the
// fat sonnet agents were unguarded). The `orphaned` arm is the completeness
// prerequisite the VERIFY board required: without it the gate is allowlist-driven
// and a NEW ungoverned stub silently reopens the silent-model-upgrade CRITICAL.
// ---------------------------------------------------------------------------

// The 3 agents deliberately NOT generator-managed: they keep bespoke FAT bodies
// (their Layer-1 output-contracts are enforced on actor output — see the PERSONAS
// header). Their model tier is PINNED here so a hand-flip can't silently upgrade
// it; `tableConflicts` fires if one is ever also added to PERSONAS. The committed
// test pins this exact key set, so a deliberate fat->thin demotion is a
// diff-visible, reviewed act — not a silent slip.
const FAT_AGENTS = { architect: 'opus', 'code-reviewer': 'sonnet', 'security-auditor': 'sonnet' };

// In-place fat->thin gutting is caught two ways (either fires `fatBody`):
//   1. THIN_SENTINEL — the sentence a generated thin stub carries (renderAgentMd
//      "When in doubt"); a fat agent must NOT contain it (catches a paste of the
//      thin template over the fat body, with a clear message).
//   2. FAT_BODY_FLOOR — a method-agnostic body-size floor. The fat agents are
//      5.9KB+ (security-auditor is the smallest); a thin stub is ~2.6KB. A fat
//      agent whose body collapses below this floor was gutted by SOME method
//      (not just the sentinel paste) — e.g. its Layer-1 output-contract sections
//      replaced by a throwaway line. The floor sits well above the largest thin
//      stub and well below the smallest fat body, so it flags drastic gutting
//      without policing gradual legitimate edits.
const THIN_SENTINEL = 'This file is intentionally minimal';
const FAT_BODY_FLOOR = 3500;

// A well-formed stub opens with a `---` frontmatter block (closing `---` on its
// own line) and has a non-trivial body.
const FRONTMATTER_RE = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/;

/**
 * Extract the frontmatter `model:` tier from an agent stub.
 * @param {string} md The stub file contents.
 * @returns {string|null} The trimmed tier (e.g. `'opus'`), or null when no `model:` line exists.
 */
function modelLine(md) {
  const m = md.match(/^model:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Integrity-audit the whole `agents/` directory. Pure: no writes, no `process.exit`.
 * Both `main()` (`--check`) and the unit test consume it; the params are injectable
 * so the test can point at a tampered fixture tree.
 * @param {object} [opts]
 * @param {string} [opts.agentsDir] Directory of `agents/*.md` to audit (defaults to AGENTS_DIR).
 * @param {object[]} [opts.personas] Generator-managed roster (defaults to PERSONAS).
 * @param {Object<string,string>} [opts.fatAgents] Pinned fat-agent -> model-tier map (defaults to FAT_AGENTS).
 * @returns {{missing:string[],malformed:string[],drifted:string[],fatModel:string[],fatBody:string[],tableConflicts:string[],orphaned:string[]}}
 *   Problem buckets; every bucket empty means the directory is clean.
 */
function collectCheckProblems({ agentsDir = AGENTS_DIR, personas = PERSONAS, fatAgents = FAT_AGENTS } = {}) {
  const missing = [];
  const malformed = [];
  const drifted = [];
  const fatModel = [];
  const fatBody = [];
  const tableConflicts = [];

  const fatNames = Object.keys(fatAgents);
  const governed = new Set([...personas.map((p) => p.agent), ...fatNames]);

  // Managed personas: present, well-formed, byte-identical to the generator.
  for (const p of personas) {
    const target = path.join(agentsDir, `${p.agent}.md`);
    if (!fs.existsSync(target)) { missing.push(p.agent); continue; }
    const content = fs.readFileSync(target, 'utf8');
    if (!FRONTMATTER_RE.test(content) || content.trim().length < 20) { malformed.push(p.agent); continue; }
    if (content !== renderAgentMd(p)) drifted.push(p.agent);
  }

  // Fat agents: present, at the pinned tier, still fat, and not ALSO in the table.
  for (const name of fatNames) {
    if (personas.some((p) => p.agent === name)) tableConflicts.push(name);
    const target = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(target)) { missing.push(name); continue; }
    const content = fs.readFileSync(target, 'utf8');
    // Same frontmatter sanity as the managed personas above — modelLine's `/m` regex
    // matches a stray `model:` line ANYWHERE, so a de-framed (frontmatter-stripped) fat
    // stub with a leftover `model:` line + enough body bytes would otherwise report clean.
    if (!FRONTMATTER_RE.test(content) || content.trim().length < 20) { malformed.push(name); continue; }
    const tier = modelLine(content);
    if (tier !== fatAgents[name]) fatModel.push(`${name}: model:${tier} (want ${fatAgents[name]})`);
    if (content.includes(THIN_SENTINEL) || content.length < FAT_BODY_FLOOR) fatBody.push(name);
  }

  // Directory completeness: no agents/*.md outside the governed partition.
  const orphaned = fs.readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((name) => !governed.has(name));

  return { missing, malformed, drifted, fatModel, fatBody, tableConflicts, orphaned };
}

/**
 * CLI entry point. `--check` audits the tree (never writes) and exits 1 on any
 * problem; `--force` regenerates every managed stub; the default creates only
 * missing stubs. Bails with exit 2 on a missing source brief/contract or a
 * PERSONAS/FAT_AGENTS roster conflict.
 * @returns {void}
 */
function main() {
  const isCheck = process.argv.includes('--check');
  const isForce = process.argv.includes('--force');

  // Verify referenced personas and contracts exist
  let missingSource = 0;
  for (const p of PERSONAS) {
    const personaMd = path.join(PERSONAS_DIR, `${p.id}.md`);
    const contract = path.join(CONTRACTS_DIR, `${p.id}.contract.json`);
    if (!fs.existsSync(personaMd)) {
      process.stderr.write(`WARN: missing source personas/${p.id}.md\n`);
      missingSource++;
    }
    if (!fs.existsSync(contract)) {
      process.stderr.write(`WARN: missing source personas-contracts/${p.id}.contract.json\n`);
      missingSource++;
    }
  }
  if (missingSource > 0) {
    process.stderr.write(`Source files missing — aborting (${missingSource}).\n`);
    process.exit(2);
  }

  // --check: integrity-audit the whole agents/ directory, never write.
  if (isCheck) {
    const { missing, malformed, drifted, fatModel, fatBody, tableConflicts, orphaned } = collectCheckProblems();
    const problems = [];
    if (missing.length > 0) problems.push(`${missing.length} missing (${missing.join(', ')})`);
    if (malformed.length > 0) problems.push(`${malformed.length} malformed/no-frontmatter (${malformed.join(', ')})`);
    if (drifted.length > 0) problems.push(`${drifted.length} content-drift vs generator (${drifted.join(', ')}) — run \`node scripts/generate-persona-agents.js --force\`, or fold the hand-curation into PERSONAS[] (kbExtra/broaderScope); byte-equality is line-ending sensitive (keep core.autocrlf=false)`);
    if (orphaned.length > 0) problems.push(`${orphaned.length} ungoverned agents/*.md not in PERSONAS or FAT_AGENTS (${orphaned.join(', ')}) — add to the roster with an explicit model tier so it can't silently drift`);
    if (tableConflicts.length > 0) problems.push(`${tableConflicts.length} in BOTH PERSONAS + FAT_AGENTS (${tableConflicts.join(', ')}) — a fat agent moved into the table must be removed from FAT_AGENTS + given an explicit model field`);
    if (fatModel.length > 0) problems.push(`${fatModel.length} fat-agent model-tier drift (${fatModel.join('; ')})`);
    if (fatBody.length > 0) problems.push(`${fatBody.length} fat-agent thinned in place (${fatBody.join(', ')}) — carries the thin sentinel or its body fell below the fat-body floor; a deliberate demotion must update FAT_AGENTS + its pin test`);
    if (problems.length > 0) {
      process.stdout.write(`generate-persona-agents: ${problems.join('; ')}\n`);
      process.exit(1);
    }
    process.stdout.write(`generate-persona-agents: clean — all ${PERSONAS.length} persona agents present + match generator; ${Object.keys(FAT_AGENTS).length} fat agents at pinned tiers\n`);
    return;
  }

  // Write path (default = create missing; --force = regenerate all managed stubs).
  // Prevent, don't just detect: a fat agent added to PERSONAS must never be
  // clobbered by --force before CI's --check runs (mirrors the missingSource bail above).
  const conflicts = PERSONAS.filter((p) => Object.prototype.hasOwnProperty.call(FAT_AGENTS, p.agent)).map((p) => p.agent);
  if (conflicts.length > 0) {
    process.stderr.write(`Refusing to write: ${conflicts.join(', ')} in BOTH PERSONAS and FAT_AGENTS — resolve the roster before (re)generating.\n`);
    process.exit(2);
  }

  const created = [];
  const skipped = [];
  for (const p of PERSONAS) {
    const target = path.join(AGENTS_DIR, `${p.agent}.md`);
    if (fs.existsSync(target) && !isForce) { skipped.push(p.agent); continue; }
    fs.writeFileSync(target, renderAgentMd(p));
    created.push(p.agent);
  }

  process.stdout.write(`generate-persona-agents: ${isForce ? 'regenerated' : 'created'} ${created.length}, skipped ${skipped.length}\n`);
  if (created.length > 0) {
    process.stdout.write(`  ${isForce ? 'regenerated' : 'created'}: ${created.join(', ')}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`  skipped (already exists; use --force to overwrite): ${skipped.join(', ')}\n`);
  }
}

// Run only when invoked directly (CLI + CI). Guarding behind require.main lets
// the unit test import PERSONAS + renderAgentMd without triggering a real
// regeneration (main() writes to agents/ as a side effect).
if (require.main === module) {
  main();
}

module.exports = { PERSONAS, FAT_AGENTS, THIN_SENTINEL, renderAgentMd, modelLine, collectCheckProblems };
