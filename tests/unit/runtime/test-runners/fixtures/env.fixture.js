// R12 fixture — prints whether the child sees a parent SECRET vs a DECLARED var, to
// prove least-privilege env scrubbing (hacker M2). NOT *.test.js.
'use strict';
process.stdout.write('SECRET=' + (process.env.LOOM_SECRET || '') + '|DECLARED=' + (process.env.LOOM_DECLARED || ''));
process.exit(0);
