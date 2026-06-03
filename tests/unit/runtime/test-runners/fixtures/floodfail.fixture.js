// R12 fixture — floods stdout (>pipe buffer) then exits 1. Proves pass/fail follows
// the EXIT CODE even when output is truncated (hacker C1: no forge-a-green). NOT *.test.js.
'use strict';
process.stdout.write('A'.repeat(20 * 1024 * 1024));
process.exit(1);
