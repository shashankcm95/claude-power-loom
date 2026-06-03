// Shared raw path-segment safety check for the v3.2 Wave-1 decomposition
// primitives (R6 trampoline + R7 todo-checkpoint). The SINGLE source so the
// security gate is audited/fixed in ONE place (DRY for a security-load-bearing
// check).
//
// WHY a RAW-STRING check (not just checkWithinRoot): `runStateDir(runId)` and the
// leaf-folder paths are built with `path.join(BASE, untrusted)`, and `path.join`
// runs `path.normalize`, which COLLAPSES `..` BEFORE a downstream `checkWithinRoot`
// can see it. So `checkWithinRoot(path.join(BASE, 'a/../a'), BASE)` passes (the
// collapsed `BASE/a` is within BASE) — the traversal is invisible post-join. The
// canonical defense (mirrors record-store.js isSafeRunId) is to reject the RAW
// token BEFORE it is ever joined; checkWithinRoot remains a useful second layer.
//
// This closes the runId-traversal cross-run-clobber a hacker-lens review found in
// the first Wave-1 build (runId `realrun/../realrun` overwrote `realrun`'s state;
// `x/..` wrote at the run-state root).

'use strict';

const path = require('path');

// True iff `id` is a safe SINGLE path segment: a non-empty string with no path
// separators, no `..`/`.` traversal, and no NUL byte. Same contract as
// record-store.js isSafeRunId — applied to both runIds and leaf-folder ids.
function isSafePathSegment(id) {
  return typeof id === 'string' && id.length > 0 &&
    id.indexOf('\0') === -1 &&
    id.indexOf('/') === -1 && id.indexOf(path.sep) === -1 &&
    id !== '.' && id !== '..';
}

module.exports = { isSafePathSegment };
