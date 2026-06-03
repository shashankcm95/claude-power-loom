// Shared raw path-segment safety check for the v3.2 Wave-1 decomposition
// primitives (R6 trampoline + R7 todo-checkpoint).
//
// SINGLE SOURCE OF TRUTH (post-merge reconciliation): this module RE-EXPORTS the
// canonical `isSafePathSegment` from the kernel path-safety module
// (`kernel/_lib/path-canonicalize`). Wave 1 (PR #214) and the checkWithinRoot
// pre-normalization audit (PR #215) independently introduced behaviorally-identical
// raw-segment checks; the audit lifted the canonical implementation into the kernel
// (and DRYed record-store's isSafeRunId onto it). This thin runtime wrapper now
// delegates so there is exactly ONE implementation to audit/fix. (runtime → kernel
// is the legal import direction; the wrapper keeps the runtime callers' import path
// `./_lib/safe-segment` stable.)
//
// WHY a RAW-STRING check (not just checkWithinRoot): `runStateDir(runId)` and the
// leaf-folder paths are built with `path.join(BASE, untrusted)`, and `path.join`
// runs `path.normalize`, which COLLAPSES `..` BEFORE a downstream `checkWithinRoot`
// can see it. So `checkWithinRoot(path.join(BASE, 'a/../a'), BASE)` passes (the
// collapsed `BASE/a` is within BASE) — the traversal is invisible post-join. The
// canonical defense is to reject the RAW token BEFORE it is ever joined;
// checkWithinRoot remains a useful second layer. (Closed the runId-traversal
// cross-run-clobber a hacker-lens review found in the first Wave-1 build.)

'use strict';

// Re-export the canonical kernel implementation — do NOT re-implement (DRY; one
// source of truth for this security-load-bearing check).
const { isSafePathSegment } = require('../../../kernel/_lib/path-canonicalize');

module.exports = { isSafePathSegment };
