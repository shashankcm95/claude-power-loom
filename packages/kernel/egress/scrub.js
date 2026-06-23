'use strict';

// @loom-layer: kernel
//
// ③.2.1b PR-B — the egress SECRET-SCRUB entry point (coarse, defense-in-depth). The custody
// env-sanitization killswitch (PR-A) is the PRIMARY control; this scrub is a SECONDARY net over the
// bounded candidate diff before it becomes the PR body. Consumed by emit-pr.js / approve-cli.js via
// `require('./scrub')`.
//
// The implementation now lives in the leaf primitive kernel/_lib/scrub.js (it depends only on
// _lib/secret-patterns). It was hoisted out of this egress module so the spawn-state drift-evidence
// sanitizer could reuse the SAME scrubber with an INWARD require (spawn-state -> _lib), removing the
// prior spawn-state -> egress layering inversion. This file stays the egress-layer entry point and
// re-exports the primitive verbatim (no behavior change; the same { scrubEmitDiff, shannonEntropy,
// ENTROPY_BITS } surface).

module.exports = require('../_lib/scrub');
