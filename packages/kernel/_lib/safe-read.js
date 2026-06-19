'use strict';

// packages/kernel/_lib/safe-read.js
//
// TOCTOU-safe regular-file read primitive. A name-based statSync->readFileSync pair
// has a check->read swap window: replace the path with a FIFO between the two and
// the read BLOCKS FOREVER (a FIFO open without O_NONBLOCK waits for a writer; a
// readFileSync on it never returns). That hang has been a HIGH/CRITICAL elsewhere in
// this kernel (evolution-snapshot-read.js readWitnessRowsSafe; CodeRabbit on PR #371
// flagged the same in the ghost-heartbeat carrier + producer).
//
// The fix is to pin the read to the inode at OPEN time: open O_NONBLOCK (a FIFO /
// device / dir opens instantly instead of blocking), fstat the BOUND fd, reject any
// non-regular file, and read FROM THAT fd — never re-open by path. A post-open path
// swap cannot redirect a bound fd. O_NONBLOCK is a no-op for regular-file reads, so
// the happy path is unchanged.

const fs = require('fs');

// Open `filePath` O_NONBLOCK, fstat the fd, and if it is a regular file call
// fn(fd, stat) and return its result. Otherwise (absent / unopenable / non-regular /
// fn throws) return `fallback`. Never blocks, never throws. The fd is always closed.
function withRegularFileFd(filePath, fn, fallback = undefined) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch {
    return fallback; // absent / unopenable
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fallback; // FIFO / dir / device / socket -> no blocking read
    return fn(fd, st);
  } catch {
    return fallback;
  } finally {
    try { fs.closeSync(fd); } catch { /* best-effort */ }
  }
}

module.exports = { withRegularFileFd };
