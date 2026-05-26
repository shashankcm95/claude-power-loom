---
kb_id: backend-dev/node-runtime-basics
version: 1
tags: [backend, node, javascript, typescript, runtime, async]
---

## Summary

Node.js runtime essentials for HETS node-backend personas: V8 + libuv architecture; single-threaded event loop with libuv worker pool for I/O; promises + async/await as the modern idiom (callbacks are legacy); CommonJS vs ESM module systems; package management (npm / pnpm / yarn); structured logging + observability via OpenTelemetry. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Runtime architecture

- **V8** runs JavaScript single-threaded; **libuv** provides async I/O via a thread pool (default 4 threads, tunable via `UV_THREADPOOL_SIZE`)
- **Event loop phases**: timers → pending callbacks → idle/prepare → poll → check → close. Microtasks (promises) run after each phase; `process.nextTick()` runs before microtasks
- **CPU-bound work blocks the event loop**. Offload via `worker_threads` or out-of-process; never `JSON.parse` a 100MB string on the main thread

### Module systems

- **CommonJS** (`require` / `module.exports`) — legacy default; synchronous resolution; `__dirname` / `__filename` available
- **ESM** (`import` / `export`) — modern default for new code; asynchronous; use `import.meta.url` instead of `__dirname`
- **Interop**: ESM can import CommonJS via default import; CommonJS can import ESM via dynamic `import()`. Mixing is supported but expensive — pick one per package
- `package.json` `"type": "module"` opts the package into ESM; `.cjs` / `.mjs` extensions override per-file

### Package management

- **npm** — bundled with Node; lockfile `package-lock.json`
- **pnpm** — content-addressable store; faster, lower disk; lockfile `pnpm-lock.yaml`. Default for new projects unless monorepo tooling dictates otherwise
- **yarn** — older alternative; v1 is legacy, v3+ is plug-n-play (incompatible with many tools)
- **Always commit lockfiles**. Differences between dev/prod installs are a debugging black hole
- Pin Node version via `.nvmrc` or `engines` in `package.json`

### Async patterns

- `async`/`await` is the canonical idiom. Mix-and-match with raw promises where chaining is cleaner (`Promise.all`, `Promise.race`)
- **Always handle rejections**. `process.on('unhandledRejection')` should LOG and EXIT — silent rejection is a memory leak suspect
- Don't `await` inside `forEach` — it doesn't block. Use `for...of` or `Promise.all(arr.map(async ...))`
- Streaming: `pipeline()` from `stream/promises` — handles errors + cleanup correctly. `.pipe()` doesn't propagate errors

### Common pitfalls

- **Event-loop blocks** — `bcrypt.compareSync`, large JSON parses, regex with catastrophic backtracking. Profile with `--inspect` + Chrome DevTools → Performance tab
- **Memory leaks** — long-lived event listeners (`emitter.setMaxListeners` warning is a signal); unbounded caches; closures capturing large parents; not cleaning up `setInterval`
- **Connection pool exhaustion** — DB pools, HTTP keep-alive agents, Redis clients. Size pools to expected concurrency × p99 latency
- **`require()` cycles** — partial exports at cycle time; refactor to break the cycle, don't paper over with lazy lookups
- **Mixing callbacks and promises** — pick one error-propagation strategy per function; never both
- **`process.env` in tight loops** — it's a getter that traverses the env. Cache the value once at startup

### Observability essentials

- **Structured logs**: pino (default) or winston; emit JSON; include request ID, user ID, span/trace ID
- **Metrics**: Prometheus client (`prom-client`); RED method (Rate, Errors, Duration) per endpoint
- **Traces**: OpenTelemetry; auto-instrument popular libs (Express, fetch, pg, mongoose) before manual spans

### Related KB docs (planned)

- `kb:backend-dev/express-essentials` — Express + middleware patterns + rate limiting + validation
- `kb:backend-dev/node-deployment-patterns` — process management, graceful shutdown, k8s readiness probes
- `kb:backend-dev/typescript-server-patterns` — strict tsconfig, type-narrow validation, zod integration
