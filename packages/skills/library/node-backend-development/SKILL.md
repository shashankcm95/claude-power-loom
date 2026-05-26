---
skill: node-backend-development
status: active
domain: backend-dev
canonical_source: https://nodejs.org/docs/latest/api/
forged_via: H.6.7-canonical-source-registry
related_kb: [backend-dev/node-runtime-basics, backend-dev/express-essentials]
---

# Node Backend Development

Specialist skill for the `13-node-backend` HETS persona (and any other persona that needs Node.js / Express expertise). Loaded on demand via the `Skill` tool when the spawn prompt lists `node-backend-development` as required.

## When to use this skill

Trigger when:
- Building or modifying a Node.js HTTP service (Express, Koa, Fastify, NestJS, raw `http`)
- Debugging async issues, memory leaks, event-loop blocking, unhandled rejections
- Designing module boundaries (CommonJS vs ESM), package layout, dependency choices
- Discussing API design where Node.js idioms matter (streams, EventEmitter, async iteration)

**Skip** when the runtime is browser-only (use `react` skill or 09-react-frontend persona); the work is full-stack and other concerns dominate (use a full-stack persona); or the task is package-management / tooling only — that's CI/SRE work.

## Core competencies

### Async-first idioms

- **Promises + async/await are default** for all I/O. Callbacks are legacy except for streams and EventEmitter.
- **Never block the event loop** — CPU-bound work belongs in `worker_threads` or external services. The single thread serves ALL requests; one synchronous `JSON.parse` on 50MB of data freezes the entire process.
- **Always handle async errors** — `await` paths use try/catch; raw Promises use `.catch(...)`. Add `process.on('unhandledRejection')` for visibility. In Node 15+ unhandled rejections crash the process by default.
- **Avoid floating Promises** — fire-and-forget loses errors. Either await them, store in a list and `Promise.all`, or explicitly attach `.catch(...)`.

### Event loop awareness

- Phases: timers → pending callbacks → idle/prepare → poll → check → close. Each phase processes its callback queue before yielding.
- `setImmediate(cb)` runs in the *check* phase (after I/O); `process.nextTick(cb)` runs after the current operation finishes (BEFORE the next event loop tick) — use sparingly to avoid starving I/O.
- `setTimeout(cb, 0)` ≠ `setImmediate(cb)` — they fire in different phases. For "do this after pending I/O", prefer `setImmediate`.

See `kb:backend-dev/node-runtime-basics` for the V8 + libuv + event-loop deep dive.

### Streams

- Use streams for backpressure-sensitive data (file uploads, large responses, log piping). Don't `await fs.promises.readFile` on a 1 GB file.
- `readable.pipe(writable)` is the basic shape; `pipeline()` from `node:stream/promises` adds error propagation across the whole chain.
- `for await (const chunk of readable)` is the modern consumption idiom.

### HTTP server patterns

- **Validate input at the boundary** — body-parser limits, header sizes, query param types. Untrusted data is the attack surface.
- **Rate limiting on every public endpoint** — `express-rate-limit` or equivalent; per-IP windowed counter at minimum, per-user when auth is in scope. Production deployments need a shared store (Redis) so the limit is enforced across replicas.
- **Sensible defaults** — `server.timeout`, max header size, max body size. Node's defaults are too permissive for hostile traffic.
- **Connection lifecycle** — graceful shutdown via SIGTERM → close server → drain in-flight requests → exit. Never leave hanging connections.

See `kb:backend-dev/express-essentials` for express-specific middleware ordering + production checklist.

### Module systems

- ESM (`import`/`export`, `.mjs` or `"type": "module"` in package.json) is the modern path. CJS (`require`/`module.exports`) for legacy + interop.
- Mixing them is painful. Prefer ESM-only for new projects; ESM with a CJS shim only when a critical dep is CJS-only.
- Top-level await (TLA) works in ESM, not CJS. TLA-using modules cannot be `require()`-d from CJS — only imported from ESM.

### Error handling

- Distinguish `Error` instances (operational, expected) from programmer errors (bugs). Recover from the former; crash on the latter.
- Wrap external calls in try/catch; let bugs propagate to a top-level handler — don't silently swallow.
- For async Express middleware: use `express-async-errors` or wrap each handler; otherwise rejected promises bypass `next(err)` and the request hangs.

### Observability

- `node:perf_hooks` for latency measurements (request start, DB call, response).
- `node:async_hooks` for tracing async context across async/await boundaries — what tracers (Datadog APM, OpenTelemetry) hook into.
- Structured logging (pino, winston) with request IDs propagated via `cls-rtracer` or `AsyncLocalStorage`.

### Production readiness checklist

- Health endpoints (`/health`, `/ready`) with shallow DB ping
- Graceful shutdown handler (SIGTERM → close server → drain → exit)
- PID file or process manager (systemd, pm2, Kubernetes)
- Secrets via env, not source. Never commit `.env`.
- Resource limits (`ulimit -n` for FDs; container memory limits)
- Correlation IDs flowing through logs, traces, downstream calls

## Common pitfalls

1. **Synchronous APIs in hot paths** — `fs.readFileSync`, `crypto.randomBytesSync` block the event loop. Use the async variants always in serving code.
2. **Missing response timeouts** — slow clients can exhaust connection pools. Set `server.timeout` + per-request `socket.setTimeout`.
3. **Memory leaks via closures** — long-lived event listeners or timers retaining large objects. Use `WeakMap` / `WeakRef` for caches that can be GC'd.
4. **Unhandled rejections** — pre-Node-15 they were warnings; now they crash. Always `.catch(...)` or await with try.
5. **Importing CJS into ESM** — works but the `default` export shape differs from named-export imports; prefer pure ESM dependencies when possible.
6. **Single-instance rate limits** — `express-rate-limit` with the default in-memory store breaks across replicas. Use a Redis store in any multi-instance deploy.

## Sources

- Node.js API reference: https://nodejs.org/docs/latest/api/ (canonical source per `kb:hets/canonical-skill-sources` H.6.7 registry)
- Async hooks: https://nodejs.org/api/async_hooks.html
- Streams: https://nodejs.org/api/stream.html
- Event loop guide: https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick
- Express 4.x API reference: https://expressjs.com/en/4x/api.html

## When to forge specialized sub-skills

If a task surfaces a sub-domain not adequately covered above (e.g., GraphQL server-side patterns, gRPC services, message queues), surface a `request: forge-skill` via missing-capability-signal back to root. Don't try to cover everything here — this skill is the Node.js + Express runtime baseline.
