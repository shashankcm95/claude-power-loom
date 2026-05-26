// route-decide-export.js — H.7.0 helper module.
//
// Re-exports `scoreTask` from route-decide.js so other scripts (e.g.,
// agent-identity.js's bucketTaskComplexity helper) can call it as a function
// rather than spawning a subprocess per call. Pure refactor; route-decide.js's
// CLI behavior is unchanged.
//
// Per architect-mira H.7.0 design pass (Implementation handoff §1):
//   "packages/kernel/_lib/route-decide-export.js (NEW, ~15 LoC) — re-exports
//    scoreTask as a function. Pure refactor; CLI behavior unchanged."
//
// All scoring constants + scoreTask logic live in route-decide.js; this module
// loads that module via require and re-exports the scoreTask function. The
// require side-effect (running route-decide.js's main block) is suppressed by
// only invoking main behavior when require.main === module (see route-decide.js
// guard at the bottom of that file).

'use strict';

const routeDecide = require('../algorithms/route-decide.js');

module.exports = {
  scoreTask: routeDecide.scoreTask,
  // Surface the threshold constants too — H.7.0 task-complexity bucketer uses
  // ROUTE_THRESHOLD and ROOT_THRESHOLD directly (Decision 2 in mira's design).
  ROUTE_THRESHOLD: routeDecide.ROUTE_THRESHOLD,
  ROOT_THRESHOLD: routeDecide.ROOT_THRESHOLD,
};
