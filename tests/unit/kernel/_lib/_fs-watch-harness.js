// tests/unit/kernel/_lib/_fs-watch-harness.js
//
// Injectable fs-watch event source (Round-3d C4 / persona-Tess T2).
//
// K14's event-stream variant (v3.1) and the INV-28-K13K14SerialClosure tests
// (PR 4) need DETERMINISTIC, push-driven filesystem events — never a real
// `fs.watch` (which is wallclock-bound, OS-dependent, and flaky in CI). Code
// under test takes a watcher via dependency injection; tests drive it by
// calling `emit()` explicitly. F23 discipline: activation is code-path-only
// (function call), never an env-var trigger.

'use strict';

/**
 * Create an injectable fs-watch double.
 *
 * Shape mirrors the subset of `fs.FSWatcher` that the K14 event-stream variant
 * consumes: `.on('change'|'rename', cb)` registration. Tests additionally get
 * `.emit()` to push events deterministically and `.events()` for assertions.
 *
 * @returns {{
 *   on: (eventType: string, cb: Function) => object,
 *   emit: (eventType: string, filename: string) => object,
 *   events: () => Array<{eventType: string, filename: string, seq: number}>,
 *   close: () => void,
 *   isClosed: () => boolean
 * }}
 */
function createInjectableFsWatch() {
  const listeners = [];
  const log = [];
  let closed = false;

  const watcher = {
    on(eventType, cb) {
      if (typeof cb !== 'function') return watcher;
      listeners.push({ eventType, cb });
      return watcher;
    },
    emit(eventType, filename) {
      if (closed) throw new Error('_fs-watch-harness: emit after close');
      const evt = { eventType, filename, seq: log.length };
      log.push(evt);
      for (const l of listeners) {
        if (l.eventType === '*' || l.eventType === eventType) {
          l.cb(eventType, filename);
        }
      }
      return evt;
    },
    events() {
      return log.slice();
    },
    close() {
      closed = true;
    },
    isClosed() {
      return closed;
    },
  };

  return watcher;
}

module.exports = { createInjectableFsWatch };
