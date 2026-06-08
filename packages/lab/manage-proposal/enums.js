#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - shared manage-proposal enums + R4 validation re-export. SIDE-EFFECT-FREE (no env
// read, no I/O, no module-load state) so store.js / manage-ops.js / projections.js can all require it
// without triggering store-state resolution.
//
// DISAMBIGUATION (load-bearing): this `quarantine` op_type is a Memory MANAGE-LAYER op - it marks a
// memory RECORD as quarantined (retrieval-suppressed). It is UNRELATED to the kernel's
// packages/kernel/_lib/quarantine-promote.js (the PR-3c spawn-delta STAGING materializer). They collide
// only on the English word; the path (lab/manage-proposal vs kernel/_lib/quarantine-promote) + the
// node_type ('manage-proposal') namespace them. No shared code, no functional overlap.
//
// R4 (closed enums + canonicalization): the homoglyph/NFC defense is the SHARED kernel/_lib/enum-validate
// leaf (the 5th extract-to-_lib; a security validator must not be duplicated). Re-exported here so the
// store/wrapper/projection import one module.

'use strict';

const { validateEnum, normalizeAsciiEnum } = require('../../kernel/_lib/enum-validate');

// The v3.5 manage-op set (the FULL closed enum, like RELATIONS lists all 9; Wave 3b.1 exercises
// 'quarantine' only - the destructive-proposal ops content-dedup/cull/merge are Wave 3b.2 wrappers over
// this same store). Each is a CONCEPTUAL op; the record is a Lab advisory-cache write, NEVER a kernel
// operation_class (the v6 operation_class enum is LOCKED).
const OP_TYPES = Object.freeze(['quarantine', 'content-dedup', 'cull', 'merge']);

// A proposal's MUTABLE disposition (the human's verdict; the updateEdgeStatus / faithfulness analog):
//   pending  - R1 fail-closed default; awaiting human disposition (NOT actionable)
//   approved - a human approved the op (RECORDED-not-executed in v3.5; the v3.6 promotion enforces it)
//   rejected - a human rejected the op (EXCLUDED from the projection)
const DISPOSITIONS = Object.freeze(['pending', 'approved', 'rejected']);

// R1 fail-closed default - a new proposal is NEVER born approved.
const DEFAULT_DISPOSITION = 'pending';

// The disposition that makes a proposal's target "actionable" in the projection (the walker-eligible analog).
const APPROVED_DISPOSITION = 'approved';

module.exports = {
  OP_TYPES,
  DISPOSITIONS,
  DEFAULT_DISPOSITION,
  APPROVED_DISPOSITION,
  validateEnum,
  normalizeAsciiEnum,
};
