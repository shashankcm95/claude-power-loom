// R12 (v3.2 Wave 2) — test-runner adapters: public barrel.
//
// `require('packages/runtime/test-runners')` → the registry (with the `node`
// built-in registered) plus the node adapter for direct access. R9 #4 + R11 import
// from here. Keep import-friendly: NO process.exit / top-level side effects beyond
// the registry's built-in registration (R11 imports this into a live process).

'use strict';

const registry = require('./registry');
const nodeRunner = require('./node-runner');

module.exports = Object.freeze({
  ...registry,
  nodeRunner,
});
