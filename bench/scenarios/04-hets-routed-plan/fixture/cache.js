#!/usr/bin/env node

// bench/scenarios/04-hets-routed-plan/fixture/cache.js
//
// In-process LRU cache with naive eviction. The boot task asks for a
// substantive refactor: TTL support + concurrent-access safety + observable
// hit/miss stats. Multi-file + multi-design-choice → HETS-routed.

'use strict';

class Cache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.store = new Map();
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      this.store.delete(firstKey);
    }
    this.store.set(key, value);
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    return this.store.delete(key);
  }

  size() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { Cache };
