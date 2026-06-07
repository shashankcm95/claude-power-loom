#!/usr/bin/env node
'use strict';

// scripts/generate-signpost.js - thin CLI for the W0.1 repo signpost generator
// (v3.5 Memory Manage-Layer, Wave 0). Delegates to the testable core in
// packages/kernel/recall/signpost.js.
//
//   node scripts/generate-signpost.js           # regenerate docs/SIGNPOST.md
//   node scripts/generate-signpost.js --check    # exit 1 on drift (CI gate)
//
// Mirrors scripts/generate-persona-agents.js (the --check fixed-roster-guard precedent).

require('../packages/kernel/recall/signpost').runCli();
