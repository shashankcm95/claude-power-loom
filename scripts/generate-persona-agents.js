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
 *   node scripts/generate-persona-agents.js --force  # regenerate all
 *   node scripts/generate-persona-agents.js --check  # exit 1 if missing
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
// v4 restructure repoint: persona briefs + contracts moved out of the (removed) swarm/personas* tree.
const PERSONAS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'personas');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'contracts');

// Persona definition table. The 5 existing agents (architect, code-reviewer,
// optimizer, planner, security-auditor) are SKIPPED — they have bespoke
// definitions and shouldn't be overwritten.
//
// Each entry: persona-id → { agentName, description, tools, color, summary }
const PERSONAS = [
  {
    id: '01-hacker', agent: 'hacker', color: 'red',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    description: 'Offensive-security persona. Probes for SSRF, IDOR, injection, auth bypass, and protocol-level abuse. Invoke for adversarial review of new endpoints or before shipping security-sensitive features.',
    summary: 'You think like an attacker. Every input is hostile; every assumption is a bypass surface. Focus on exploitability — proof-of-concept over theoretical risk.',
    kbDefaults: ['kb:security-dev/threat-modeling-essentials', 'kb:security-dev/auth-patterns'],
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
  },
  {
    id: '08-ml-engineer', agent: 'ml-engineer', color: 'cyan',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'ML pipelines + LLM integration specialist. Builds training pipelines, inference services, prompt engineering, and evaluation harnesses. Invoke for Claude/OpenAI integration, embedding work, model evaluation.',
    summary: 'Training and inference are different beasts. For inference: prompt design, structured outputs, caching, cost-awareness. For training: data prep, validation splits, eval rigor.',
    kbDefaults: ['kb:ml-dev/training-vs-inference', 'kb:architecture/ai-systems/inference-cost-management'],
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
  },
  {
    id: '11-data-engineer', agent: 'data-engineer', color: 'green',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
    description: 'ETL + warehouse + orchestration specialist. Builds Airflow DAGs, dbt models, schema designs, data validation. Invoke for pipeline work, warehouse modeling, data quality.',
    summary: 'Idempotent transforms. Normalized writes, denormalized reads. Schema migrations have rollback. Data quality is enforced, not assumed.',
    kbDefaults: ['kb:data-dev/data-modeling-basics', 'kb:data-dev/orchestration-essentials'],
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
    kbDefaults: ['kb:hets/spawn-conventions'],
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
];

function renderAgentMd(p) {
  const toolsJson = JSON.stringify(p.tools);
  const kbList = p.kbDefaults.map((k) => `- \`${k}\``).join('\n');
  return `---
name: ${p.agent}
description: ${p.description}
tools: ${toolsJson}
model: opus
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
- \`kb:hets/spawn-conventions\` — output-format requirements for HETS spawns

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

  const created = [];
  const skipped = [];
  const malformed = []; // M1 (VALIDATE hacker): exists-but-broken (no frontmatter / empty body)
  for (const p of PERSONAS) {
    const target = path.join(AGENTS_DIR, `${p.agent}.md`);
    if (fs.existsSync(target) && !isForce) {
      // M1: `--check` must catch a stub that EXISTS but lost its frontmatter / is empty (an unspawnable
      // persona that would otherwise pass CI green on existsSync alone). A well-formed stub opens with a
      // `---` frontmatter block (closing `---` on its own line) and has a non-trivial body.
      if (isCheck) {
        const content = fs.readFileSync(target, 'utf8');
        const hasFm = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/.test(content);
        if (!hasFm || content.trim().length < 20) malformed.push(p.agent);
      }
      skipped.push(p.agent);
      continue;
    }
    if (!isCheck) {
      fs.writeFileSync(target, renderAgentMd(p));
    }
    created.push(p.agent);
  }

  if (isCheck) {
    const problems = [];
    if (created.length > 0) problems.push(`${created.length} missing (${created.join(', ')})`);
    if (malformed.length > 0) problems.push(`${malformed.length} malformed/no-frontmatter (${malformed.join(', ')})`);
    if (problems.length > 0) {
      process.stdout.write(`generate-persona-agents: ${problems.join('; ')}\n`);
      process.exit(1);
    }
    process.stdout.write(`generate-persona-agents: clean — all ${PERSONAS.length} persona agents present + well-formed\n`);
    return;
  }

  process.stdout.write(`generate-persona-agents: ${isForce ? 'regenerated' : 'created'} ${created.length}, skipped ${skipped.length}\n`);
  if (created.length > 0) {
    process.stdout.write(`  ${isForce ? 'regenerated' : 'created'}: ${created.join(', ')}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`  skipped (already exists; use --force to overwrite): ${skipped.join(', ')}\n`);
  }
}

main();
