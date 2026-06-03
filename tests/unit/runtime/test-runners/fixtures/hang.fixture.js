// R12 node-runner fixture — HANGS forever (keeps the event loop alive) so the
// adapter's timeout must kill it. NOT *.test.js (see plan F2). A plain timer (no
// SIGTERM trap) — the killSignal:SIGKILL path is for trap-resistant hangs, beyond
// this fixture's scope.
'use strict';
process.stdout.write('hang.fixture: sleeping\n');
setInterval(() => {}, 1000);
