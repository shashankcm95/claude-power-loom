#!/usr/bin/env node

// bench/fixture/cli.js — minimal todo CLI used as boot-test fixture.
//
// The boot test asks Claude to ADD a feature here (e.g. `export <path>` that
// dumps the todos to a JSON archive at <path>, with input validation + tests).
// Whether Claude does this well — with plan, security review, KB consultation,
// agent spawns — is what the boot-test harness measures.
//
// Keep this file small (< 60 LoC). The boot task's surface should be the
// FEATURE being added, not understanding 500 lines of pre-existing code.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'todos.json');

function loadTodos() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveTodos(todos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

function cmdList() {
  const todos = loadTodos();
  if (todos.length === 0) {
    process.stdout.write('(no todos)\n');
    return;
  }
  for (const t of todos) {
    const mark = t.done ? '[x]' : '[ ]';
    process.stdout.write(`${mark} ${t.id}: ${t.text}\n`);
  }
}

function cmdAdd(text) {
  if (!text) throw new Error('add: text required');
  const todos = loadTodos();
  const id = todos.length === 0 ? 1 : Math.max(...todos.map(t => t.id)) + 1;
  todos.push({ id, text, done: false });
  saveTodos(todos);
  process.stdout.write(`added: ${id}\n`);
}

function main(argv) {
  const [, , sub, ...args] = argv;
  if (sub === 'list') return cmdList();
  if (sub === 'add') return cmdAdd(args.join(' '));
  process.stderr.write('usage: cli.js <list|add> [args]\n');
  process.exit(2);
}

if (require.main === module) main(process.argv);

module.exports = { loadTodos, saveTodos, cmdList, cmdAdd };
