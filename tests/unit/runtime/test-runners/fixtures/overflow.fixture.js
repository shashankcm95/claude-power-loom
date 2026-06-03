// R12 node-runner fixture — floods stdout to exceed a small maxBuffer, then exits 0.
// Proves a verbose-but-PASSING test is reported as `output-overflow`, NOT a silent
// exit-fail. NOT *.test.js (see plan F2). The test passes a tiny maxBufferBytes so
// this 256 KiB write overflows it.
'use strict';
process.stdout.write('x'.repeat(256 * 1024));
process.exit(0);
