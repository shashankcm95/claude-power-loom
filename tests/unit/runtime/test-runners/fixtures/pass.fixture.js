// R12 node-runner fixture — a PASSING test (exit 0).
// NOT named *.test.js so the CI `find -name '*.test.js'` glob never runs it as a
// suite (it is run ONLY by node-runner.test.js via the adapter). See plan F2.
'use strict';
process.stdout.write('pass.fixture: ok\n');
process.exit(0);
