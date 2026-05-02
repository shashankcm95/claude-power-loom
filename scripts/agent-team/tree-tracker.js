#!/usr/bin/env node

// Tree tracker — persists the spawn graph for a HETS run.
// Tree shape: { nodes: { [id]: NodeRecord }, root: id }
// Stored at: swarm/run-state/{run-id}/tree.json
//
// Subcommands:
//   spawn    — record a new spawn event (parent → child)
//   complete — mark a node as complete (status: pass/partial/fail)
//   bfs      — print nodes in level order
//   dfs      — print nodes in depth-first order
//   status   — show current state of all nodes
//
// Usage:
//   node tree-tracker.js spawn --run-id X --parent P --child C --task "..." --role R
//   node tree-tracker.js complete --run-id X --node C --status pass
//   node tree-tracker.js bfs --run-id X
//   node tree-tracker.js dfs --run-id X
//   node tree-tracker.js status --run-id X

const fs = require('fs');
const path = require('path');
const { withLock } = require('./_lib/lock'); // H.3.2 (CS-1 code-reviewer X-3)

// H.2.1 path-resolution fix: previously `path.join(__dirname, '..', '..', ...)`
// resolved differently when invoked from ~/.claude/scripts/ vs the toolkit copy,
// leading to "Node not found" errors when spawn and complete were called from
// different copies (surfaced in chaos-20260502-060039). Now: env-var override,
// fall back to the toolkit-canonical path.
const RUN_STATE_BASE = process.env.HETS_RUN_STATE_DIR ||
  path.join(process.env.HOME, 'Documents', 'claude-toolkit', 'swarm', 'run-state');

function treePath(runId) {
  return path.join(RUN_STATE_BASE, runId, 'tree.json');
}

function load(runId) {
  const p = treePath(runId);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { runId, root: null, nodes: {}, createdAt: new Date().toISOString() }; }
}

// H.3.2 (CS-1 code-reviewer X-3): RMW race possible when multiple actors
// spawn concurrently from a chaos-test super-agent. Lock the read-modify-write.
function save(runId, tree) {
  const p = treePath(runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  withLock(p + '.lock', () => {
    const tmp = p + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, JSON.stringify(tree, null, 2));
      fs.renameSync(tmp, p);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function cmdSpawn(args) {
  if (!args['run-id'] || !args.child) {
    console.error('Usage: spawn --run-id X --parent P --child C --task "..." --role R [--max-depth N]');
    process.exit(1);
  }
  // H.3.1 (CS-1 architect HIGH, persistent from chaos-20260502-060039):
  // max_depth enforcement. SKILL.md documents max_depth=3 invariant; without
  // this guard, a hostile or buggy spawner can create depth-7+ nodes.
  // CS-1 architect: "ZERO progress in 9 sub-phases". 3 lines now.
  const maxDepth = parseInt(args['max-depth'] || '3', 10);
  const tree = load(args['run-id']);
  if (args.parent && tree.nodes[args.parent]) {
    const parentDepth = depthOf(args.parent, tree);
    if (parentDepth >= 0 && parentDepth + 1 > maxDepth) {
      console.error(`Error: spawn would exceed max_depth=${maxDepth} (parent depth=${parentDepth}, child would be at depth=${parentDepth + 1}). Refusing.`);
      process.exit(1);
    }
  }
  // CS-1 code-reviewer C-2: cmdSpawn allows --child === --parent producing a self-cycle.
  // depthOf catches the symptom (returns -1) but the bug is upstream.
  if (args.parent && args.parent === args.child) {
    console.error(`Error: --child cannot equal --parent ("${args.child}"). Refusing self-cycle spawn.`);
    process.exit(1);
  }
  // M-2 fix (H.2.1): warn (don't silently overwrite) on duplicate spawn.
  // Audit trail is the whole point of tree.json — losing prior status / completedAt /
  // children silently is the failure mode chaos-20260502-060039 flagged.
  if (tree.nodes[args.child]) {
    const existing = tree.nodes[args.child];
    console.error(`Warning: spawn collision for "${args.child}" (existing status: ${existing.status}, spawnedAt: ${existing.spawnedAt}). Preserving prior children list; updating other fields.`);
  }
  const existingChildren = tree.nodes[args.child]?.children || [];
  const node = {
    id: args.child,
    parent: args.parent || null,
    role: args.role || 'actor',
    task: args.task || '',
    status: 'pending',
    spawnedAt: new Date().toISOString(),
    completedAt: null,
    children: existingChildren,
  };
  tree.nodes[args.child] = node;
  if (args.parent && tree.nodes[args.parent]) {
    if (!tree.nodes[args.parent].children.includes(args.child)) {
      tree.nodes[args.parent].children.push(args.child);
    }
  }
  if (!tree.root || !args.parent) tree.root = args.child;
  save(args['run-id'], tree);
  console.log(JSON.stringify({ action: 'spawned', node: args.child, parent: args.parent || null }, null, 2));
}

function cmdComplete(args) {
  if (!args['run-id'] || !args.node || !args.status) {
    console.error('Usage: complete --run-id X --node N --status pass|partial|fail');
    process.exit(1);
  }
  const tree = load(args['run-id']);
  const node = tree.nodes[args.node];
  if (!node) {
    console.error(`Node not found: ${args.node}`);
    process.exit(1);
  }
  node.status = args.status;
  node.completedAt = new Date().toISOString();
  save(args['run-id'], tree);
  console.log(JSON.stringify({ action: 'completed', node: args.node, status: args.status }, null, 2));
}

function bfs(tree) {
  if (!tree.root || !tree.nodes[tree.root]) return [];
  const queue = [tree.root];
  const order = [];
  const seen = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = tree.nodes[id];
    if (!node) continue;
    order.push(node);
    for (const childId of (node.children || [])) {
      if (!seen.has(childId)) queue.push(childId);
    }
  }
  return order;
}

function dfs(tree) {
  if (!tree.root || !tree.nodes[tree.root]) return [];
  const order = [];
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const node = tree.nodes[id];
    if (!node) return;
    order.push(node);
    for (const childId of (node.children || [])) visit(childId);
  }
  visit(tree.root);
  return order;
}

function cmdBfs(args) {
  const tree = load(args['run-id']);
  console.log(JSON.stringify({ runId: tree.runId, order: bfs(tree).map((n) => ({ id: n.id, role: n.role, status: n.status, depth: depthOf(n.id, tree) })) }, null, 2));
}

function cmdDfs(args) {
  const tree = load(args['run-id']);
  console.log(JSON.stringify({ runId: tree.runId, order: dfs(tree).map((n) => ({ id: n.id, role: n.role, status: n.status, depth: depthOf(n.id, tree) })) }, null, 2));
}

function depthOf(id, tree) {
  // H-2 fix: cycle guard. cmdSpawn does not validate child !== parent, so a
  // corrupted or adversarial tree.json can produce a parent cycle. Without
  // visited tracking, every bfs/dfs/status call hangs. Return -1 on cycle.
  let depth = 0;
  let cur = tree.nodes[id];
  const visited = new Set();
  while (cur && cur.parent) {
    if (visited.has(cur.id)) return -1;
    visited.add(cur.id);
    depth++;
    cur = tree.nodes[cur.parent];
  }
  return depth;
}

function cmdStatus(args) {
  const tree = load(args['run-id']);
  const nodes = Object.values(tree.nodes);
  const stats = {
    total: nodes.length,
    byStatus: { pending: 0, pass: 0, partial: 0, fail: 0 },
    byRole: {},
  };
  for (const n of nodes) {
    stats.byStatus[n.status] = (stats.byStatus[n.status] || 0) + 1;
    stats.byRole[n.role] = (stats.byRole[n.role] || 0) + 1;
  }
  console.log(JSON.stringify({ runId: tree.runId, root: tree.root, ...stats, nodes: nodes.map((n) => ({ id: n.id, role: n.role, status: n.status, parent: n.parent })) }, null, 2));
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case 'spawn':    cmdSpawn(args); break;
  case 'complete': cmdComplete(args); break;
  case 'bfs':      cmdBfs(args); break;
  case 'dfs':      cmdDfs(args); break;
  case 'status':   cmdStatus(args); break;
  default:
    console.error('Usage: tree-tracker.js {spawn|complete|bfs|dfs|status} --run-id X [args]');
    process.exit(1);
}
