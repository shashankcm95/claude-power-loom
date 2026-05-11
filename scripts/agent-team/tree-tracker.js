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
// H.5.5 (CS-2/CS-3 theo HIGH): RUN_STATE_BASE was duplicated in 3 substrate
// scripts; now single-sourced via _lib/runState.js (closes "_lib/ is a
// directory of one" finding).
const { runStateDir } = require('./_lib/runState');
// H.9.8: migrated from inline atomic-write pattern (Class B substrate
// try-catch-cleanup-throw) to shared helper. Cleanup-on-error absorbed into
// helper post-condition; defensive mkdirSync preserved per HT.2.3 HIGH-A2.
const { writeAtomic } = require('./_lib/atomic-write');

function treePath(runId) {
  return path.join(runStateDir(runId), 'tree.json');
}

function load(runId) {
  const p = treePath(runId);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { runId, root: null, nodes: {}, createdAt: new Date().toISOString() }; }
}

// H.3.6 (CS-2 code-reviewer.jade BLOCK): the H.3.2 fix wrapped only the WRITE
// in withLock — but cmdSpawn / cmdComplete do load() → modify → save(), so
// concurrent callers all read pre-modification state, then serialize their
// writes; last writer wins, others' updates lost. Same race the H.3.2
// own-validation probe 3 explicitly proved fatal for budget-tracker; not
// back-applied to tree-tracker until now.
//
// Fix mirrors budget-tracker.js: writeTreeAtomic is a plain atomic write
// (tmp + rename, no lock); withTreeLock wraps the WHOLE RMW at the callsite.
function writeTreeAtomic(runId, tree) {
  const p = treePath(runId);
  // H.9.8: defensive mkdirSync preserved per HT.2.3 HIGH-A2 (helper covers).
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeAtomic(p, tree);
}

// 15s timeout (vs default 3s) to match budget-tracker — chaos-test convention
// fires N concurrent spawn calls and busy-wait fairness is poor under contention.
function withTreeLock(runId, fn) {
  const lockPath = treePath(runId) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  return withLock(lockPath, fn, { maxWaitMs: 15000 });
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
  // CS-1 code-reviewer C-2: validate args BEFORE entering the lock — these are
  // pure arg checks, no need to hold the lock for them.
  if (args.parent && args.parent === args.child) {
    console.error(`Error: --child cannot equal --parent ("${args.child}"). Refusing self-cycle spawn.`);
    process.exit(1);
  }
  const maxDepth = parseInt(args['max-depth'] || '3', 10);

  // H.3.6 (CS-2 code-reviewer.jade BLOCK): wrap the WHOLE RMW in withTreeLock.
  // Previously load() + modify + save() were independent, so concurrent spawns
  // (typical chaos-test workload) all read pre-spawn state, then last writer
  // wins — losing siblings, parent.children entries, and depth checks.
  let result;
  withTreeLock(args['run-id'], () => {
    const tree = load(args['run-id']);
    // H.3.1 (CS-1 architect HIGH): max_depth enforcement inside the lock so
    // depth check + child insert are atomic w.r.t. concurrent inserts that
    // could change the parent chain underneath us.
    if (args.parent && tree.nodes[args.parent]) {
      const parentDepth = depthOf(args.parent, tree);
      if (parentDepth >= 0 && parentDepth + 1 > maxDepth) {
        console.error(`Error: spawn would exceed max_depth=${maxDepth} (parent depth=${parentDepth}, child would be at depth=${parentDepth + 1}). Refusing.`);
        process.exit(1);
      }
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
    writeTreeAtomic(args['run-id'], tree);
    result = { action: 'spawned', node: args.child, parent: args.parent || null };
  });
  console.log(JSON.stringify(result, null, 2));
}

function cmdComplete(args) {
  if (!args['run-id'] || !args.node || !args.status) {
    console.error('Usage: complete --run-id X --node N --status pass|partial|fail');
    process.exit(1);
  }
  // H.3.6 (CS-2 code-reviewer.jade BLOCK): wrap RMW in withTreeLock so the
  // complete event isn't lost when a concurrent spawn writes between our
  // load() and save().
  let result;
  withTreeLock(args['run-id'], () => {
    const tree = load(args['run-id']);
    const node = tree.nodes[args.node];
    if (!node) {
      console.error(`Node not found: ${args.node}`);
      process.exit(1);
    }
    node.status = args.status;
    node.completedAt = new Date().toISOString();
    writeTreeAtomic(args['run-id'], tree);
    result = { action: 'completed', node: args.node, status: args.status };
  });
  console.log(JSON.stringify(result, null, 2));
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
