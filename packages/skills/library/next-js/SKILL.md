---
skill: next-js
status: active
domain: web-dev
canonical_source: https://nextjs.org/docs
forged_via: 'Phase-0-pdf-tutorial-shakedown-2026-05-21 (closes kb:hets/stack-skill-map gap — next-js referenced as required across SSR stack entries but not authored as a standalone skill; react-essentials covers React but not App Router specifics)'
evolved: '2026-05-21 (post-Phase-3 bundled cycle; 4 closures from PDF→Tutorial shakedown: next.config.ts version gating, serverComponentsExternalPackages for native-node libs, cookies() sync-vs-async by version, async params required-vs-forward-compatible)'
related_kb: [web-dev/react-essentials, web-dev/typescript-react-patterns, backend-dev/node-runtime-basics]
tags: [nextjs, app-router, server-components, server-actions, caching, ssr, react, version-pinning, native-modules]
---

# Next.js (App Router)

Specialist skill for Next.js 13+ projects using the **App Router** (`/app` directory). Covers the architectural patterns that diverge meaningfully from Pages Router and from plain React: the server/client boundary, route handlers, server actions, and the four-layer cache.

## When to use this skill

Trigger when:
- Building or modifying a Next.js project using `/app` (not `/pages`)
- Designing server/client component boundaries — deciding where data fetching, mutations, or interactivity belong
- Implementing route handlers (`route.ts`), server actions (`"use server"`), or middleware
- Diagnosing caching surprises — stale data, unexpected re-renders, build-time vs runtime fetches
- Reasoning about static vs dynamic rendering and revalidation strategies

**Skip** when the project still uses Pages Router (use `react` skill + plain Next.js conventions), the issue is a generic React problem (hooks, state, props — use `react`), or the work is purely about an API endpoint with no Next-specific concerns.

## Version notes (Next 14 vs Next 15)

**Check the project's `package.json` BEFORE writing config or async-context code.** Several App Router surfaces changed between Next 14 and Next 15 in ways that compile but misbehave at runtime, or fail at boot. The signature-shape and config-file-shape changed; the conceptual model didn't.

| Surface | Next 14.x | Next 15+ | If you get it wrong |
|---|---|---|---|
| Config file | `next.config.js` or `next.config.mjs` | also accepts `next.config.ts` | Next 14 errors at boot: `Configuring Next.js via 'next.config.ts' is not supported. Please replace the file with 'next.config.js' or 'next.config.mjs'` |
| `cookies()` / `headers()` / `draftMode()` signature | **sync** — returns `ReadonlyRequestCookies` directly | **async** — returns `Promise<…>`; must `await` | Next 14 with `await cookies()` is harmless (await on non-thenable). Next 15 without `await` returns a Promise where you expect a value — silent type confusion. |
| Dynamic route `params` / `searchParams` | both sync (plain object) AND async (`Promise<…>`) accepted | **async REQUIRED** — must be typed `Promise<…>` and awaited | Next 14: works either way. Next 15: sync access throws / type-errors. Writing async-first is forward-compatible. |
| External packages config | `experimental.serverComponentsExternalPackages: [...]` | promoted to **top-level** `serverExternalPackages: [...]` (experimental form deprecated) | Next 15 warns but still works with the experimental form for now; future versions will remove. |
| `caches` / fetch-default behavior | `fetch()` cached by default (Data Cache opt-in) | `fetch()` **uncached** by default; opt in via `{ cache: 'force-cache' }` or `revalidate` | Next 15 silently bypasses the Data Cache for unannotated fetches — performance regression if you migrate without auditing. |
| Router Cache TTL | client cache aggressive (5min static, 30s dynamic) | client cache reduced; per-segment opt-in via `staleTimes` config | Next 15 navigation may feel "fresher" out-of-the-box; if your app relied on the implicit cache for perceived speed, set `experimental.staleTimes`. |

**The pragma**: when teaching the Next 15 idiom (async cookies, async params), write it that way — it's forward-compatible. When *diagnosing* on a Next 14 project, remember the signatures and config formats are different and you'll see misleading symptoms.

## Core competencies

### The server/client boundary — the single most important concept

In App Router, **everything is a Server Component by default**. Server Components:
- Run on the server during render — never ship to the client
- Can be `async` and `await` data directly (no `useEffect`, no SWR for the initial fetch)
- Cannot use browser APIs (`window`, `document`), React hooks (`useState`, `useEffect`), or event handlers
- Can import Client Components and pass them as children or props

Client Components require **`"use client"`** at the top of the file. They:
- Get bundled and sent to the browser as JS
- Can use hooks, browser APIs, event handlers
- Are server-rendered ONCE on initial request, then hydrate
- Should be as small + leaf-ish as possible to minimize bundle size

**Composition rules**:
- Server → Client: ✅ allowed (the typical pattern — Client island inside Server tree)
- Client → Server: ❌ not allowed via `import`, BUT ✅ via `children` prop or props. This lets you nest a Server Component inside a Client wrapper.
- Props passed from Server to Client must be **serializable** — no functions (except Server Actions), no Dates that haven't been stringified, no class instances.

**Mistakes to catch**:
- Putting `"use client"` at the root layout — turns the whole app into a SPA, defeats Server Components
- Importing a Client Component into a Server Component for no reason — fine in isolation, but watch for accidental tree-wide client conversion
- Using `next/dynamic` with `ssr: false` inside a Server Component — must be inside a Client Component (compiler enforces this in Next 14+)
- Forgetting `"use client"` for a component that calls `useState` / `useEffect` — runtime error, not a build error

### Route handlers — the new API route

In `/app`, API endpoints are `route.ts` files that export HTTP method functions:

```typescript
// app/api/items/route.ts
export async function GET(request: Request) {
  const items = await db.select().from(itemsTable);
  return Response.json(items);
}

export async function POST(request: Request) {
  const body = await request.json();
  // ... validate, persist
  return new Response(null, { status: 201 });
}
```

- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Return `Response` or `NextResponse` — both work; `NextResponse` adds cookie/header helpers
- **Default runtime is Node.js**. Add `export const runtime = 'edge'` for Edge Runtime (faster cold-start, no Node APIs).
- Dynamic params come via the function's second arg: `(request, { params })`
- Route handlers are **NOT cached by default** when they read `Request` (Next 14+ behavior; older versions cached `GET` by default — verify your version)

**When to use a route handler vs a Server Action vs a Server Component**:
- Direct DB read for page rendering → **Server Component** (no API needed)
- Form submission / mutation triggered from a Client Component → **Server Action**
- Third-party webhook receiver, public API, OAuth callback → **Route Handler**
- Anything called by a non-React client (mobile app, curl, scripts) → **Route Handler**

### Server Actions — mutation without an API

```typescript
// app/items/actions.ts
"use server";

import { revalidatePath } from "next/cache";

export async function createItem(formData: FormData) {
  const title = formData.get("title") as string;
  // ... persist
  revalidatePath("/items");
}
```

- `"use server"` at the **top of a file** marks every export as a Server Action; alternatively `"use server"` at the **top of a function body** marks only that function
- Client Components can import + invoke Server Actions directly: `<form action={createItem}>` or `onClick={() => createItem(...)}`
- Server Actions are **public endpoints** — Next.js generates an opaque RPC route. **You MUST authenticate + authorize inside the action**. Treat the function signature as untrusted input.
- Server Actions return values must be serializable
- Errors thrown inside a Server Action propagate to the nearest `error.tsx`; for form-shaped errors, return `{ error: '...' }` instead

**Mistakes to catch**:
- Trusting the user via Server Action arguments without re-authenticating
- Calling `revalidatePath` / `revalidateTag` BEFORE the mutation completes (use after)
- Server Actions in development sometimes need dev-server restart after first creation — Next 14+ improved this but still happens

### Caching — the four layers

| Layer | Lives in | Scope | Default | How to opt out |
|---|---|---|---|---|
| **Request Memoization** | React | Per-request, server-side | On | Not configurable (React-level) |
| **Data Cache** | Server (file-system or Redis adapter) | Cross-request, persisted | On for `fetch()` | `fetch(url, { cache: 'no-store' })` |
| **Full Route Cache** | Server build output | Build-time | On for static routes | Use dynamic functions (cookies, headers) or `export const dynamic = 'force-dynamic'` |
| **Router Cache** | Browser memory | Per-session, client-side | On (~30s for dynamic, 5min for static in dev; configurable in Next 15) | `router.refresh()` or `revalidatePath` |

**Revalidation**:
- **Time-based**: `fetch(url, { next: { revalidate: 60 } })` — refresh after 60s
- **Tag-based**: `fetch(url, { next: { tags: ['posts'] } })` then `revalidateTag('posts')` in a Server Action
- **Path-based**: `revalidatePath('/posts')` in a Server Action
- **On-demand from outside Next**: hit a route handler that calls `revalidateTag` (webhook-driven CMS pattern)

**Static vs dynamic rendering** — decided at build time per route:
- Reading `cookies()`, `headers()`, or `searchParams` → forces dynamic
- `fetch(url, { cache: 'no-store' })` → forces dynamic
- `export const dynamic = 'force-dynamic'` → forces dynamic
- Otherwise → static (rendered at build time, served from Full Route Cache)

**Mistakes to catch**:
- `fetch` with `Authorization` header from cookies — silently caches the authed response across users. Use `cache: 'no-store'` or move to a Server Action.
- Hard-coded `revalidate = 0` everywhere "to be safe" — defeats the cache entirely; pick per-route
- Expecting `router.push` to refetch a Server Component — it uses the Router Cache. Use `router.refresh()` after a mutation, or trigger `revalidatePath`.

### File conventions

```
app/
├── layout.tsx          // Root layout, wraps every page. Must render <html> + <body>.
├── page.tsx            // Route at "/"
├── loading.tsx         // Streamed loading UI (wraps page in Suspense)
├── error.tsx           // Error boundary for this route segment (Client Component)
├── not-found.tsx       // 404 for this segment
├── global-error.tsx    // Root-level error (only at app/, replaces root layout on error)
├── api/
│   └── items/
│       └── route.ts    // Route Handler at /api/items
├── (marketing)/        // Route group — doesn't affect URL, groups for layouts
│   └── about/page.tsx  // → /about
└── [slug]/             // Dynamic segment
    └── page.tsx        // → /:slug
```

- **`generateStaticParams`** — pre-render dynamic segments at build time
- **`generateMetadata`** — dynamic `<head>` per route
- **`middleware.ts`** at the root — runs on Edge Runtime before every matching request; use for auth gates, geo-redirects, A/B headers

**Project-root config files** (note version constraint per the Version notes table above):
- `next.config.mjs` (ESM) or `next.config.js` (CJS) — universal; works in all Next 13+ versions
- `next.config.ts` — Next 15+ ONLY; will error at boot on Next 14 with a clear message about replacing the file
- `tsconfig.json` — TypeScript config; Next auto-inserts the required compiler options on first run
- `tailwind.config.ts` / `postcss.config.mjs` — Tailwind config; both formats accepted regardless of Next version (Tailwind has its own loader)

### Native-Node packages in App Router

Some Node packages — those that mutate globals at module-load, run their own worker threads, or use platform-specific binaries — break inside webpack's RSC bundler. Symptoms:
- `TypeError: Object.defineProperty called on non-object`
- `Cannot transfer object of unsupported type`
- `Module not found: Can't resolve 'node:...'`
- Worker errors at first invocation of the affected route

The fix is to mark them as **server-only externals** — webpack leaves them in Node's loader untouched. In `next.config.{js,mjs,ts}`:

```javascript
// Next 14.x
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', 'sharp', 'canvas', 'puppeteer', 'playwright'],
  },
};
```

```javascript
// Next 15+
const nextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'sharp', 'canvas', 'puppeteer', 'playwright'],
};
```

Common candidates: `pdf-parse` / `pdfjs-dist`, `sharp`, `canvas`, `puppeteer` / `playwright`, `@google-cloud/*`, `aws-sdk` v2, `bcrypt`, `argon2`, `better-sqlite3`, `node-canvas`, any package that includes `.node` binary addons.

**Even after externalization, some libs still misbehave**: pdfjs-dist's worker postMessage breaks if you call methods concurrently on a single PDFParse instance (`Promise.all([getText(), getInfo()])` triggers `Cannot transfer object of unsupported type`). Switch to sequential calls if you see worker-transfer errors. This is a library-internal constraint, not a Next.js bug.

**If externalization isn't enough**: the library may require a runtime that the App Router doesn't support. Options:
- Move the work to a Route Handler with `export const runtime = 'nodejs'` (default; explicit pin)
- Spawn a child process from a Route Handler / Server Action
- Use a different library (e.g., `pdf2json` is pure JS — no workers, no native bindings)

### Node-side ESM dep gotchas

The § Native-Node packages pattern above solves "webpack bundler breaks the package" via the externals list — webpack leaves the package alone and Node's native loader handles it. A DIFFERENT problem class arises when the package itself needs an **absolute on-disk path to a sibling file** at module-load time (typical: a `workerSrc` for a worker file the package will load synchronously). The two problems require different fixes; both can be needed for the same package.

**Symptom**: webpack build error or runtime throw:
```
Module not found: ESM packages (X) need to be imported.
Use 'import' to reference the package instead.
```
Surfaces when you do `require('foo-esm/...')` or `createRequire(import.meta.url).resolve('foo-esm/...')` from a Route Handler. Webpack 5 statically analyses both forms and tries to bundle the ESM target — which fails because the target is `.mjs` and webpack's CJS-style resolve can't import it.

**Anti-pattern catalog** (don't do):

- `require('foo-esm/path/to/file.mjs')` from a Route Handler
- `createRequire(import.meta.url).resolve('foo-esm/...')` — webpack STILL statically analyses
- Setting `serverComponentsExternalPackages` alone — applies only to RSC, NOT Route Handlers; the resolve still gets bundled

**Canonical pattern** (do):

```javascript
import { join } from 'node:path';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Build the path at runtime from process.cwd() so webpack sees only an
// opaque string. The package's own runtime loads the file with its native
// resolver — webpack stays out of the way.
GlobalWorkerOptions.workerSrc = join(
  process.cwd(),
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.worker.mjs',
);
```

> ⚠️ **`process.cwd()` is NOT reliable under `next build --standalone`**.
>
> Under `next dev` / `next start` / `next build` (non-standalone), `process.cwd()` resolves to the project root and `node_modules/` is adjacent — the pattern works.
>
> Under `--standalone` output (common for Docker / Railway / self-hosted Node deploys), the standalone server lives at `.next/standalone/server.js` with its own `node_modules/` at `.next/standalone/node_modules/`. If the operator launches with a different `cwd` (e.g. Docker `WORKDIR /app && CMD ["node", ".next/standalone/server.js"]` → `cwd = /app`), the path silently resolves to `/app/node_modules/...` which does not exist; `workerSrc` gets an invalid path and the package errors at first use.
>
> **For standalone deploys**: resolve relative to `__dirname` (CJS) or compute from `import.meta.url` via `fileURLToPath` (ESM), OR pass the absolute worker path via an env var (`WORKER_SRC`) set at container build time. Pick whichever is least fragile for your deploy topology.

**Common offenders**:

- `pdfjs-dist` (4.x is ESM-only; legacy build needs `GlobalWorkerOptions.workerSrc` set at module load)
- native deps with `.node` binaries (better-sqlite3, sharp) — these ALSO need the externals list from § Native-Node packages above; the two fixes layer
- `node-fetch` v3+ (ESM-only) — usually solved by externalize-then-import; the runtime-path pattern is only for the `workerSrc`-style case

**Which pattern when**: if the package needs to be **imported normally** but webpack can't bundle it → externalize via § Native-Node packages above. If the package needs an **absolute on-disk path to a sibling file** at module-load → use the runtime path construction here. For packages that need both (pdfjs-dist + better-sqlite3 in the same Route Handler), layer the fixes — they're orthogonal.

### Streaming with Suspense

Wrap slow Server Components in `<Suspense>` to send the rest of the page immediately and stream in the slow part:

```tsx
export default async function Page() {
  return (
    <>
      <Header />
      <Suspense fallback={<Skeleton />}>
        <SlowList />  {/* awaits inside; streams when ready */}
      </Suspense>
    </>
  );
}
```

`loading.tsx` is sugar for wrapping the entire `page.tsx` in `<Suspense>` automatically.

## Common pitfalls

1. **Importing server-only utilities into Client Components** → bundle pollution + runtime errors. Use the `server-only` package to fail-loud at build time.
2. **Stuffing all state into a top-level Client Component** → bundle bloat. Push `"use client"` to the smallest leaf possible (e.g., just the `<Button>`).
3. **`searchParams` / `params` / `cookies()` / `headers()` signature shifted** → async in Next 15+ (must `await`); sync in Next 14 (await is a harmless no-op). See Version notes section. Writing async-first is forward-compatible and recommended; checking project's `package.json` first is mandatory before debugging "why does my promise have no `.then()`".
4. **Forgetting `cache: 'no-store'` on user-specific `fetch()`** → cross-user data leak via Data Cache.
5. **Tree-shaking server-only deps** → Next strips them via the React Server Components compiler IF they're only imported in Server Components; if a Client Component touches them, the dep is bundled.
6. **Server Actions called from inside `useEffect`** → fine technically, but defeats the point. They're designed for direct invocation from event handlers or form `action` props.
7. **Mixing Pages Router (`pages/`) and App Router (`app/`)** → supported but `app/` wins for overlapping routes; double-check both trees during migration.
8. **Native-Node package fails at boot** with webpack errors → externalize via `serverComponentsExternalPackages` (14.x) or `serverExternalPackages` (15+). See the "Native-Node packages in App Router" core competency for the full list of common candidates + post-externalization gotchas.
9. **Library worker-error after externalization** (e.g., `Cannot transfer object of unsupported type`) → not a Next.js issue; it's the library's own runtime constraint. For pdfjs-dist specifically: use sequential calls, not `Promise.all`, on a single instance.

## Related KB

- `kb:web-dev/react-essentials` — React fundamentals; this skill assumes them
- `kb:web-dev/typescript-react-patterns` — typing patterns for components, props, hooks
- `kb:backend-dev/node-runtime-basics` — Route Handler default runtime
- `kb:hets/stack-skill-map` — SSR stack entries pull this skill

## What this skill is NOT

- Not a Next.js tutorial — assumes you've shipped a Next app before
- Not Pages Router (`pages/`) — that has its own conventions; this skill is App Router only
- Not deployment-specific — Vercel / Cloudflare Pages / self-hosted Node all run App Router; deployment quirks belong in `engineering:deploy-checklist`
- Not a substitute for reading the official docs when caching behavior surprises you — caching semantics shifted between Next 13, 14, and 15
