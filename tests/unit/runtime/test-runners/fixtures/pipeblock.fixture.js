// R12 fixture — writes 1 MiB (well past the ~64 KiB OS pipe buffer) then HANGS
// forever without exiting. Proves the runner cannot deadlock on a pipe-pressured
// child: spawnSync drains the pipe concurrently AND the wall-clock timeout SIGKILLs
// regardless (user residual-risk C2). NOT *.test.js.
'use strict';
process.stdout.write('X'.repeat(1024 * 1024));
setInterval(() => {}, 1000);
