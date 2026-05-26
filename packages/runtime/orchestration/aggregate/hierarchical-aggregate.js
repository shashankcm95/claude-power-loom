#!/usr/bin/env node

// Hierarchical aggregator for the chaos-test tree.
//
// Tree model (built incrementally as nodes complete):
//   Each finding file is named node-{id}.md and starts with a YAML
//   frontmatter block:
//     ---
//     id: super-root
//     role: super | orchestrator | actor
//     depth: 0
//     parent: null | "<parent-id>"
//     task: "..."
//     persona: "01-hacker" (actors only)
//     children: ["id1", "id2"]  (orchestrators/super only)
//     ---
//     # findings markdown body
//     ## CRITICAL ...
//
// This script:
//   1. Loads all node-*.md files in a run-state directory
//   2. Parses YAML frontmatter + finding sections
//   3. Builds the tree structure
//   4. Rolls findings up the tree (each parent inherits children's
//      severity counts)
//   5. Compares to a previous run if available (delta analysis)
//   6. Outputs hierarchical-report.md and (optionally) JSON
//
// Usage:
//   node hierarchical-aggregate.js <run-id> [--previous <prior-run-id>] [--json]

const fs = require('fs');
const path = require('path');
// HT.1.2 — `parseFrontmatter` consolidated to canonical helper (was 1 of 4
// inline copies post-H.8.7 chaos-H4 extraction; the inline version here did
// not support block lists or digit-bearing keys — canonical supports both).
// HT.0.9-verify code-reviewer enumerated the 4 sites.
const { parseFrontmatter } = require('../../../kernel/_lib/frontmatter');
// Phase 0 (v3.0-alpha): file moved from swarm/ to packages/runtime/orchestration/aggregate/.
// Use shared RUN_STATE_BASE/runStateDir instead of __dirname-relative run-state path.
const { RUN_STATE_BASE, runStateDir } = require('../../../kernel/_lib/runState');

const args = process.argv.slice(2);
const runId = args[0];
if (!runId) {
  console.error('Usage: hierarchical-aggregate.js <run-id> [--previous <prior-run-id>] [--json]');
  process.exit(1);
}
const jsonOnly = args.includes('--json');
const prevIdx = args.indexOf('--previous');
const previousRunId = prevIdx >= 0 ? args[prevIdx + 1] : autodetectPrevious(runId);

const RUN_DIR = runStateDir(runId);
if (!fs.existsSync(RUN_DIR)) {
  console.error(`Run directory not found: ${RUN_DIR}`);
  process.exit(1);
}

// Discover previous run if not specified
function autodetectPrevious(currentRunId) {
  const stateDir = RUN_STATE_BASE;
  if (!fs.existsSync(stateDir)) return null;
  const all = fs.readdirSync(stateDir)
    .filter((d) => d.startsWith('chaos-') && d !== currentRunId)
    .sort();
  return all.length > 0 ? all[all.length - 1] : null;
}

// === Tree parsing ===

function parseFindings(body) {
  const sections = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  let current = null;
  let buf = [];
  for (const line of body.split('\n')) {
    const sec = line.match(/^##\s+(?:🔴|🟠|🟡|🔵)?\s*(CRITICAL|HIGH|MEDIUM|LOW)\b/i);
    if (sec) {
      if (current && buf.length) sections[current].push(buf.join('\n').trim());
      current = sec[1].toUpperCase();
      buf = [];
      continue;
    }
    if (line.match(/^##\s+/)) {
      if (current && buf.length) sections[current].push(buf.join('\n').trim());
      current = null;
      buf = [];
      continue;
    }
    if (current) {
      if (line.match(/^###\s+/) || (line.match(/^[*-]\s+\*\*/) && buf.length === 0)) {
        if (buf.length) sections[current].push(buf.join('\n').trim());
        buf = [line];
      } else {
        buf.push(line);
      }
    }
  }
  if (current && buf.length) sections[current].push(buf.join('\n').trim());
  for (const sev of Object.keys(sections)) sections[sev] = sections[sev].filter((s) => s.trim().length > 0);
  return sections;
}

function loadNodes(runDir) {
  // Support both new node-*.md format and legacy {NN}-{persona}-findings.md
  const files = fs.readdirSync(runDir);
  const nodes = {};

  for (const file of files) {
    if (!file.endsWith('.md') || file === 'aggregated-report.md' || file === 'hierarchical-report.md') continue;
    const fullPath = path.join(runDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    // Synthesize frontmatter for legacy files (no ---)
    if (!frontmatter.id) {
      const m = file.match(/^(\d+)-([a-z-]+)-findings\.md$/);
      if (m) {
        frontmatter.id = `actor-${m[2]}`;
        frontmatter.role = 'actor';
        frontmatter.depth = '1';
        frontmatter.parent = 'orchestrator-flat';
        frontmatter.persona = `${m[1]}-${m[2]}`;
        frontmatter.task = `Persona ${m[2]} chaos test`;
      } else {
        continue; // skip unrecognized
      }
    }

    const findings = parseFindings(body);
    const counts = {
      CRITICAL: findings.CRITICAL.length,
      HIGH: findings.HIGH.length,
      MEDIUM: findings.MEDIUM.length,
      LOW: findings.LOW.length,
    };
    counts.total = counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW;

    nodes[frontmatter.id] = {
      ...frontmatter,
      depth: parseInt(frontmatter.depth || '0', 10),
      findings,
      ownCounts: counts,
      file,
    };
  }

  // Inject synthetic root for legacy flat structure
  if (!nodes['super-root'] && Object.values(nodes).every((n) => n.role === 'actor')) {
    nodes['orchestrator-flat'] = {
      id: 'orchestrator-flat', role: 'orchestrator', depth: 0, parent: null,
      task: 'Flat orchestration (legacy single-tier)',
      children: Object.keys(nodes),
      findings: { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] },
      ownCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 },
      file: '(synthetic)',
    };
    nodes['orchestrator-flat'].children = Object.keys(nodes).filter((k) => k !== 'orchestrator-flat');
  }

  return nodes;
}

// === Tree assembly + roll-up ===

function buildTree(nodes) {
  const roots = [];
  for (const node of Object.values(nodes)) {
    if (node.parent && nodes[node.parent]) {
      nodes[node.parent].children = nodes[node.parent].children || [];
      if (!nodes[node.parent].children.includes(node.id)) {
        nodes[node.parent].children.push(node.id);
      }
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function rollupCounts(node, nodes) {
  const total = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };
  const own = node.ownCounts;
  for (const sev of Object.keys(total)) total[sev] = own[sev] || 0;

  for (const childId of (node.children || [])) {
    const child = nodes[childId];
    if (!child) continue;
    const childRollup = rollupCounts(child, nodes);
    for (const sev of Object.keys(total)) total[sev] += childRollup[sev];
  }

  node.rollup = total;
  return total;
}

// === Cross-run delta ===

function flattenFindings(nodes) {
  // Returns { signature: { severity, snippet, source } } where signature
  // is a stable hash of the finding text (for cross-run matching).
  const flat = {};
  for (const node of Object.values(nodes)) {
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      for (const finding of node.findings[sev] || []) {
        // Signature: take first 80 chars after stripping markdown markers
        const sig = finding
          .replace(/^[#*-]+\s*/g, '')
          .replace(/\*\*/g, '')
          .slice(0, 80)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_');
        flat[sig] = { severity: sev, snippet: finding.slice(0, 200), source: node.id };
      }
    }
  }
  return flat;
}

function computeDeltas(currentNodes, previousNodes) {
  const cur = flattenFindings(currentNodes);
  const prev = flattenFindings(previousNodes);

  const newFindings = [];
  const persistentFindings = [];
  const resolvedFindings = [];

  for (const sig of Object.keys(cur)) {
    if (prev[sig]) persistentFindings.push({ ...cur[sig], signature: sig });
    else newFindings.push({ ...cur[sig], signature: sig });
  }
  for (const sig of Object.keys(prev)) {
    if (!cur[sig]) resolvedFindings.push({ ...prev[sig], signature: sig });
  }

  return { newFindings, persistentFindings, resolvedFindings };
}

function summarizeRun(nodes) {
  const totals = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };
  for (const node of Object.values(nodes)) {
    if (node.role !== 'actor') continue; // count actors only (avoid double-count)
    for (const sev of Object.keys(totals)) totals[sev] += node.ownCounts[sev] || 0;
  }
  return totals;
}

// === Render ===

function renderTreeAscii(node, nodes, prefix = '', isLast = true) {
  const lines = [];
  const branch = prefix === '' ? '' : (isLast ? '└── ' : '├── ');
  const tag = `[${node.role}/${node.depth}]`;
  const counts = node.rollup
    ? `(C:${node.rollup.CRITICAL} H:${node.rollup.HIGH} M:${node.rollup.MEDIUM} L:${node.rollup.LOW})`
    : '';
  lines.push(`${prefix}${branch}${tag} ${node.id} ${counts}`);
  if (node.task) lines.push(`${prefix}${isLast ? '    ' : '│   '}${node.task}`);

  const children = (node.children || []).map((id) => nodes[id]).filter(Boolean);
  children.forEach((child, i) => {
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    const isChildLast = i === children.length - 1;
    lines.push(...renderTreeAscii(child, nodes, childPrefix, isChildLast));
  });
  return lines;
}

function render(runId, previousRunId, currentNodes, currentSummary, previousNodes, deltas) {
  const lines = [];
  lines.push('# Hierarchical Chaos Report');
  lines.push('');
  lines.push(`**Run**: \`${runId}\``);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  if (previousRunId) lines.push(`**Compared to**: \`${previousRunId}\``);
  lines.push('');

  // Current totals
  lines.push('## Current Run Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    lines.push(`| ${sev} | ${currentSummary[sev]} |`);
  }
  lines.push(`| **TOTAL** | **${currentSummary.total}** |`);
  lines.push('');

  // Cross-run delta
  if (previousNodes && deltas) {
    const prev = summarizeRun(previousNodes);
    lines.push('## Before/After Delta');
    lines.push('');
    lines.push('| Severity | Previous | Current | Δ |');
    lines.push('|----------|----------|---------|---|');
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      const delta = currentSummary[sev] - prev[sev];
      const sign = delta > 0 ? `+${delta}` : `${delta}`;
      const trend = delta < 0 ? '✓ improved' : delta > 0 ? '⚠ regressed' : '— stable';
      lines.push(`| ${sev} | ${prev[sev]} | ${currentSummary[sev]} | ${sign} ${trend} |`);
    }
    const totalDelta = currentSummary.total - prev.total;
    lines.push(`| **TOTAL** | **${prev.total}** | **${currentSummary.total}** | **${totalDelta > 0 ? '+' : ''}${totalDelta}** |`);
    lines.push('');

    lines.push(`### ✓ Resolved (${deltas.resolvedFindings.length})`);
    lines.push('');
    if (deltas.resolvedFindings.length === 0) {
      lines.push('_None — either no improvements or signatures didn\'t match._');
    } else {
      for (const f of deltas.resolvedFindings.slice(0, 15)) {
        lines.push(`- **[${f.severity}]** ${f.snippet.slice(0, 100)}...`);
      }
      if (deltas.resolvedFindings.length > 15) lines.push(`- _...and ${deltas.resolvedFindings.length - 15} more_`);
    }
    lines.push('');

    lines.push(`### 🔴 New (${deltas.newFindings.length})`);
    lines.push('');
    if (deltas.newFindings.length === 0) {
      lines.push('_None — no new issues introduced._');
    } else {
      for (const f of deltas.newFindings.slice(0, 15)) {
        lines.push(`- **[${f.severity}]** ${f.snippet.slice(0, 100)}...`);
      }
      if (deltas.newFindings.length > 15) lines.push(`- _...and ${deltas.newFindings.length - 15} more_`);
    }
    lines.push('');

    lines.push(`### ⚠ Persistent (${deltas.persistentFindings.length})`);
    lines.push('');
    if (deltas.persistentFindings.length === 0) {
      lines.push('_None — full turnover from previous run._');
    } else {
      for (const f of deltas.persistentFindings.slice(0, 15)) {
        lines.push(`- **[${f.severity}]** ${f.snippet.slice(0, 100)}...`);
      }
      if (deltas.persistentFindings.length > 15) lines.push(`- _...and ${deltas.persistentFindings.length - 15} more_`);
    }
    lines.push('');
  }

  // Tree
  lines.push('## Hierarchy Tree');
  lines.push('');
  lines.push('```');
  const roots = buildTree(currentNodes);
  for (const root of roots) {
    rollupCounts(root, currentNodes);
    lines.push(...renderTreeAscii(root, currentNodes));
  }
  lines.push('```');
  lines.push('');

  // Per-node detail
  lines.push('## Per-Node Findings');
  lines.push('');
  for (const node of Object.values(currentNodes)) {
    if (node.role !== 'actor') continue;
    if (node.ownCounts.total === 0) continue;
    lines.push(`### ${node.id} (${node.persona || node.task})`);
    lines.push(`- File: \`${node.file}\``);
    lines.push(`- Counts: C:${node.ownCounts.CRITICAL} H:${node.ownCounts.HIGH} M:${node.ownCounts.MEDIUM} L:${node.ownCounts.LOW}`);
    lines.push('');
  }

  return lines.join('\n');
}

// === Main ===

const currentNodes = loadNodes(RUN_DIR);
const currentSummary = summarizeRun(currentNodes);

let previousNodes = null;
let deltas = null;
if (previousRunId) {
  const prevDir = runStateDir(previousRunId);
  if (fs.existsSync(prevDir)) {
    previousNodes = loadNodes(prevDir);
    deltas = computeDeltas(currentNodes, previousNodes);
  }
}

if (jsonOnly) {
  console.log(JSON.stringify({
    runId,
    previousRunId,
    summary: currentSummary,
    previousSummary: previousNodes ? summarizeRun(previousNodes) : null,
    deltas,
    tree: buildTree(currentNodes).map((r) => ({ id: r.id, role: r.role })),
    nodeCount: Object.keys(currentNodes).length,
  }, null, 2));
  process.exit(0);
}

const report = render(runId, previousRunId, currentNodes, currentSummary, previousNodes, deltas);
const outputPath = path.join(RUN_DIR, 'hierarchical-report.md');
fs.writeFileSync(outputPath, report);

console.log(`Hierarchical report: ${outputPath}`);
console.log('');
console.log(`Nodes: ${Object.keys(currentNodes).length}`);
console.log(`Findings: C:${currentSummary.CRITICAL} H:${currentSummary.HIGH} M:${currentSummary.MEDIUM} L:${currentSummary.LOW} (total ${currentSummary.total})`);
if (deltas) {
  const prev = summarizeRun(previousNodes);
  const delta = currentSummary.total - prev.total;
  console.log(`Delta vs ${previousRunId}: ${delta > 0 ? '+' : ''}${delta} findings`);
  console.log(`  Resolved: ${deltas.resolvedFindings.length}`);
  console.log(`  New: ${deltas.newFindings.length}`);
  console.log(`  Persistent: ${deltas.persistentFindings.length}`);
}
