// FIXTURE (K12 regression) — the commented-out require below is a kernel→runtime
// violation that MUST be suppressed by the comment heuristic; only the real
// same-layer import counts (so this file must NOT be flagged). Not real code.
// module.exports = require('../../runtime/should-be-ignored');
module.exports = require('./real-peer');
