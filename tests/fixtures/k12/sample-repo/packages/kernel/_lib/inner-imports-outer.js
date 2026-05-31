// FIXTURE (K12 regression) — INTENTIONAL VIOLATION: a kernel file importing a
// runtime path (inner → outer breaks the dependency rule). Not real code.
module.exports = require('../../runtime/service');
