// R12 fixture — the leaf SIGKILLs ITSELF (a crash, NOT a parent timeout). The runner
// must report reason:'killed-by-signal', NOT 'timeout' (hacker M1). NOT *.test.js.
'use strict';
process.kill(process.pid, 'SIGKILL');
