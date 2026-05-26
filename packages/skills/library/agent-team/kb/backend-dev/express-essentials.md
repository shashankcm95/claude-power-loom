---
kb_id: backend-dev/express-essentials
version: 1
tags: [backend, node, express, middleware, http, rate-limiting]
---

## Summary

Express essentials for HETS node-backend personas: middleware-chain architecture; explicit error handling via the 4-arg `(err, req, res, next)` signature; input validation at the edge (zod / joi); rate limiting via `express-rate-limit`; secure defaults via `helmet`; structured logging via `pino-http`; never trust client-set headers without `app.set('trust proxy', ...)` configuration. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Application bootstrap

```js
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

const app = express();

// Security: secure defaults BEFORE any route definitions
app.use(helmet());

// Rate limiting: applied broadly, then tighter limits per-route
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 100,                   // 100 req per window per IP
  standardHeaders: true,      // RateLimit-* headers
  legacyHeaders: false,       // skip X-RateLimit-*
}));

// Body parsing: explicit + size-capped
app.use(express.json({ limit: '100kb' }));

// Logging: per-request structured logs
app.use(pinoHttp());

// Routes registered after middleware
app.use('/api', apiRouter);

// Error handler: ALWAYS LAST + 4-arg signature
app.use((err, req, res, next) => {
  req.log.error({ err }, 'unhandled');
  res.status(500).json({ error: 'internal' });
});
```

### Middleware order matters

- Middleware runs in registration order. Security (helmet) → rate limit → body parser → logger → routes → error handler
- `next(err)` short-circuits to the error handler (4-arg). Plain `next()` continues to next middleware
- A middleware that's missing `next()` and doesn't `res.send()` HANGS the request — every middleware must terminate or pass through

### Input validation at the edge

```js
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

app.post('/users', (req, res, next) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ errors: parsed.error.flatten() });
  // parsed.data is now typed + validated
  return createUser(parsed.data).then((user) => res.status(201).json(user)).catch(next);
});
```

- Validate at the request boundary, not deep in business logic
- zod gives you runtime + compile-time types from one schema; ajv is faster for hot paths
- Never trust `req.body`, `req.query`, `req.params` — they're attacker-controlled

### Rate limiting patterns

- **Broad floor** — `express-rate-limit` at app-level (above example: 100 req / 15 min / IP)
- **Per-route tighter caps** — auth endpoints (login, password reset) at e.g. 5 req / 15 min / IP
- **Per-user limits** (vs per-IP) — keyed on `req.user.id` once auth resolves; needs custom keyGenerator
- **Distributed** — single-instance memory store doesn't survive restarts or scale across pods. Use `rate-limit-redis` for production
- **Trust proxy correctly** — behind a reverse proxy (k8s ingress, ELB), `app.set('trust proxy', 1)` so `req.ip` reflects client IP, not the proxy. Wrong setting = trivial bypass via `X-Forwarded-For` spoofing

### Async route handlers

Express 4.x: an unhandled rejection in an async handler doesn't reach the error handler — the request hangs. Two fixes:

1. **Wrap with `.catch(next)`** every time:
```js
app.get('/users/:id', (req, res, next) => {
  getUser(req.params.id).then((u) => res.json(u)).catch(next);
});
```
2. **Express 5.x** (currently beta) handles async automatically — until you ship 5.x, use the wrapper or `express-async-handler`

### Common pitfalls

- **Missing rate limits on auth endpoints** → credential stuffing
- **Trusting `X-Forwarded-For` without `trust proxy`** → IP spoofing
- **Body parser without size limit** → memory DoS
- **`cors()` with wildcard** in production → cross-origin credential theft
- **Missing CSRF** on cookie-auth POST/PUT/DELETE → forged actions from third-party origins
- **`req.session` without rotation on auth** → session fixation
- **Error handler swallowing `err.message` to the client** → information disclosure (stack traces, DB schemas)
- **`console.log` instead of structured logger** → unsearchable in production

### Production checklist

- [ ] `helmet` enabled (sets ~15 security-related HTTP headers)
- [ ] Rate limit at app-level + tighter per-route on auth endpoints
- [ ] `app.set('trust proxy', N)` configured to match infrastructure
- [ ] Body parser size limits (`{limit: '100kb'}` for JSON, smaller for tight endpoints)
- [ ] Input validation at every route via zod / joi / ajv
- [ ] Structured logging via `pino-http` (NOT `console.log`)
- [ ] Error handler last; never leaks stack traces to client
- [ ] CORS configured with explicit origin list (not `*`)
- [ ] Graceful shutdown: SIGTERM handler closes server + drains connection pool
- [ ] Health probe endpoints (`/healthz`, `/readyz`) — different semantics; readyz can fail temporarily for in-flight migration

### Related KB docs (planned)

- `kb:backend-dev/node-runtime-basics` — runtime + module + async essentials
- `kb:backend-dev/auth-patterns-node` — JWT vs session, token rotation, secure cookies
- `kb:backend-dev/postgres-pool-patterns` — connection pool sizing, prepared statements, transaction boundaries
