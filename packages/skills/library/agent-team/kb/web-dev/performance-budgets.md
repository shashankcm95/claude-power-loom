---
kb_id: web-dev/performance-budgets
version: 1
tags:
  - web
  - frontend
  - performance
  - core-web-vitals
  - budgets
  - foundational
  - quality-baseline
sources_consulted:
  - "web.dev — Web Vitals (web.dev/articles/vitals) — the Core Web Vitals set + the 75th-percentile 'good/needs-improvement/poor' framing; LCP ≤2.5s, INP ≤200ms, CLS ≤0.1"
  - "web.dev — Largest Contentful Paint (web.dev/articles/lcp) — LCP bands: good ≤2.5s / needs-improvement 2.5–4.0s / poor >4.0s at the 75th percentile"
  - "web.dev — Interaction to Next Paint (web.dev/articles/inp) — INP bands: good ≤200ms / needs-improvement 200–500ms / poor >500ms; INP is the successor to FID"
  - "web.dev — Cumulative Layout Shift (web.dev/articles/cls) — CLS bands: good ≤0.1 / needs-improvement 0.1–0.25 / poor >0.25 (unitless)"
  - "web.dev Blog — Interaction to Next Paint becomes a Core Web Vital on March 12 (web.dev/blog/inp-cwv-march-12, 2024) — INP replaced FID on 2024-03-12; FID deprecated"
  - "web.dev — Performance budgets 101 (web.dev/articles/performance-budgets-101, Milica Mihajlija, 2018) — the three budget types (quantity / milestone / rule-based); 170 KB critical-path; <5s TTI"
  - "web.dev — Incorporate performance budgets into your build tools (web.dev/articles/incorporate-performance-budgets-into-your-build-tools) — Lighthouse budget.json resourceSizes/resourceCounts categories (script, image, total, third-party…)"
  - "Addy Osmani — The Cost of JavaScript (medium.com/dev-channel/the-cost-of-javascript-84009f51e99e) + The Cost of JavaScript in 2019 (v8.dev/blog/cost-of-javascript-2019) — parse/compile/execute + download/CPU; <170 KB minified+compressed mobile JS budget; split bundles >50–100 KB"
  - "MDN Web Docs — Performance budgets (developer.mozilla.org/en-US/docs/Web/Performance/Guides/Performance_budgets) — warning vs error levels; bundlesize / webpack performance hints / Lighthouse Bot tooling"
related:
  - web-dev/accessibility-essentials
  - web-dev/react-essentials
  - web-dev/typescript-react-patterns
  - architecture/discipline/trade-off-articulation
  - architecture/ai-systems/inference-cost-management
  - architecture/discipline/reliability-scalability-maintainability
status: active
---

## Summary

**Principle**: Treat performance as a **budget with enforced limits, not an afterthought.** A page that exceeds its byte or latency budget is over budget the same way a feature that fails a test is broken — it is caught at the gate, not discovered in production by a user on a mid-range phone.
**The user-facing target (Core Web Vitals)**: **LCP ≤ 2.5s** (loading), **INP ≤ 200ms** (responsiveness — replaced FID on 2024-03-12), **CLS ≤ 0.1** (visual stability), each judged at the **75th percentile** of real-user page loads, segmented by device.
**The enforcement mechanism (performance budgets)**: quantity budgets (JS KB, image KB, request count), milestone budgets (FCP, TTI), and rule-based budgets (Lighthouse score), wired into CI so a regression *fails the build* rather than shipping.
**The dominant cost (Osmani)**: JavaScript is the most expensive byte you ship — it must be downloaded *and then* parsed, compiled, and executed on the main thread. Budget it; code-split it; tree-shake it; lazy-load it.
**Test**: does the change have a JS/total byte budget enforced in CI (bundlesize / size-limit / Lighthouse `budget.json`), and does it keep LCP/INP/CLS in the "good" band at the 75th percentile?
**Sources**: web.dev (Web Vitals, LCP/INP/CLS, Performance budgets 101, budget.json) + the web.dev INP-on-March-12 announcement + Addy Osmani's *Cost of JavaScript* + MDN Performance budgets.

## Quick Reference

**Core Web Vitals — the three metrics + bands** (web.dev/articles/vitals; per-metric pages). Each band boundary is the **75th-percentile** value across real page loads, segmented across mobile and desktop:

| Metric | Measures | Good | Needs improvement | Poor | Source |
|--------|----------|------|-------------------|------|--------|
| **LCP** (Largest Contentful Paint) | Loading | **≤ 2.5 s** | 2.5 s – 4.0 s | **> 4.0 s** | web.dev/articles/lcp |
| **INP** (Interaction to Next Paint) | Responsiveness | **≤ 200 ms** | 200 ms – 500 ms | **> 500 ms** | web.dev/articles/inp |
| **CLS** (Cumulative Layout Shift) | Visual stability | **≤ 0.1** | 0.1 – 0.25 | **> 0.25** | web.dev/articles/cls |

> **INP replaced FID** as a Core Web Vital on **2024-03-12** (web.dev/blog/inp-cwv-march-12). FID (First Input Delay) was deprecated and removed from the program. INP measures *all* interactions across the page's lifetime, not just the first — if you still see "FID" in a doc or tool, it is stale. CLS is **unitless** (a score, not seconds).

**Performance-budget types** (web.dev/articles/performance-budgets-101, Mihajlija 2018):

| Type | Limits on… | Examples |
|------|-----------|----------|
| **Quantity-based** | Concrete assets | JS KB, image KB, total page weight, HTTP request count, web-font count |
| **Milestone timings** | User-centric load events | First Contentful Paint (FCP), Time to Interactive (TTI) |
| **Rule-based** | Best-practice scores | Lighthouse / PageSpeed performance score |

**Sourced starter numbers** (treat as defaults to tune, not laws):

| Budget | Value | Source |
|--------|-------|--------|
| Critical-path resources (compressed/minified) | **< 170 KB** | web.dev Performance budgets 101 |
| Mobile JavaScript (minified + compressed) | **< 170 KB** (~0.7 MB uncompressed) | Osmani, *Cost of JavaScript* |
| Split a bundle once it exceeds | **~50–100 KB** | Osmani, *Cost of JavaScript* |
| Time to Interactive (slow 3G) | **< 5 s** | web.dev / MDN |
| Lighthouse performance score | **> 80** (example) | web.dev Performance budgets 101 |

**The JS cost model (Osmani)** — a downloaded script is not "done"; the engine must still **parse → compile → execute** it on the main thread before it is interactive. The dominant costs today are **download + CPU execution time**. Levers, cheapest-impact first:

- **Tree-shake** — ship only the exports actually used (ES-module imports + a bundler that drops dead code).
- **Code-split at the route** — load a route's JS only when the user navigates to it.
- **Lazy-load below the fold** — defer components/images the first paint doesn't need.
- **Prefer the platform** — don't ship 40 KB of library to format a date the platform (`Intl`) already formats.

**CI enforcement tools** (MDN; web.dev):

| Tool | Enforces | Fails the build when… |
|------|----------|------------------------|
| **bundlesize** | Per-file gzip/brotli byte limits | a tracked file exceeds its limit (blocks the PR) |
| **size-limit** | Bundle byte size (+ optional run-time cost) | the configured byte limit is exceeded |
| **webpack performance hints** | Asset / entrypoint byte size | `hints: "error"` and an asset is oversized |
| **Lighthouse CI** (`budget.json`) | `resourceSizes` / `resourceCounts` + metrics, per route | an assertion at `error` level is over budget |

**Top smells**:

- "We'll optimize performance later" — the bolt-on anti-pattern this doc exists to refuse.
- A new dependency added with no glance at what it costs the bundle (`npm i` then ship).
- Lab-only thinking — a green Lighthouse run on a fast laptop while real users (75th percentile, mid-range phone) are in the "poor" band.
- A hero image / late-injected ad / web-font swap that tanks LCP or CLS, unbudgeted.
- A budget that exists in a doc but is not wired into CI — advisory budgets decay silently.

## Intent

Most slow pages are not built by developers who *chose* slowness — they are built by developers who never put a number on it. Each individual addition ("just one more dependency", "just this one library to format dates") looks free in isolation; the cost is the sum, paid by the user on a mid-range device on a slow network, who the developer on a fast laptop never feels. This is the exact same deferred-quality failure mode as accessibility-as-a-bolt-on: the defect enters because performance was an aspiration, not a gate.

A **performance budget** converts "fast" from a vibe into a checkable, enforced limit — the way a test converts "correct" into pass/fail. Core Web Vitals give you the *outcome* targets (what the user actually experiences, measured in the field at the 75th percentile); byte and milestone budgets give you the *leading indicators* you can enforce in CI *before* the regression ships. The two layers compose: byte budgets fail early and deterministically in the pipeline; field Vitals confirm the bytes you saved actually moved the user-experienced number.

The intent of this doc is to turn "make it fast" into a small set of **sourced, checkable commitments** — the three CWV thresholds, the budget types, the JS cost model, and the CI tools — that the `09-react-frontend` lens applies reflexively under its *bundle-budget* instinct.

## The Principle

> "A performance budget is a set of limits imposed on metrics that affect site performance." — *web.dev, Performance budgets 101*

and the user-experienced target it serves:

> "To provide a good user experience, sites should strive to have [an LCP of 2.5 seconds or less / an INP of 200 milliseconds or less / a CLS of 0.1 or less] … measured at the 75th percentile of page loads, segmented across mobile and desktop devices." — *web.dev, Web Vitals*

Reformulated:

- **Put a number on it, then enforce the number.** A budget you cannot fail a build against is a wish. Quantity budgets (JS KB, total weight) are the most enforceable because they are deterministic and fail early in CI.
- **Measure the user, not the laptop.** Core Web Vitals are field metrics at the **75th percentile** — you are accountable to the slow three-quarters mark, not the median and not your dev machine. Lab tools (Lighthouse) approximate this; field data (CrUX / RUM) is the truth.
- **JavaScript is the expensive byte.** A KB of JS costs far more than a KB of image, because it must be parsed, compiled, and executed on the main thread after download (Osmani). Budget JS first.
- **Budget the leading indicators.** Bytes shipped and milestone timings are *causes* you control in CI; Vitals are the *effect* in the field. Gate on the causes; verify with the effect.

## Core Web Vitals in practice

The three metrics map to the three things a user feels: *is it showing up, does it respond, does it hold still.*

### LCP — loading (good ≤ 2.5s)

LCP marks when the largest content element (hero image, headline block, video poster) finishes rendering. The common killers: an unoptimized hero image, render-blocking CSS/JS, slow server response (TTFB), and client-side rendering that delays the largest paint. Levers: optimize/preload the LCP image, cut render-blocking resources, server-render the above-the-fold content.

### INP — responsiveness (good ≤ 200ms; the FID successor since 2024-03-12)

INP measures the latency of *interactions* (taps, clicks, key presses) across the whole page lifetime — the worst-ish interaction, not just the first (which is all FID measured). High INP almost always means **long tasks blocking the main thread** — exactly the JS-execution cost Osmani warns about. Levers: break up long tasks, defer non-critical JS, ship less JS (code-split), keep event handlers cheap.

### CLS — visual stability (good ≤ 0.1, unitless)

CLS sums the unexpected layout shifts that move content out from under the user (the "I tapped the wrong button because an ad loaded" tax). Levers: set explicit `width`/`height` (or `aspect-ratio`) on media, reserve space for late content (ads, embeds, banners), use `font-display` strategies that avoid a reflowing font swap.

All three are judged at the **75th percentile** of real page loads, segmented mobile vs desktop — a metric that is "good" on average but "poor" at p75 fails.

## Performance budgets in practice

### The three budget types (Mihajlija, web.dev)

1. **Quantity-based** — hard limits on concrete assets: JS KB, image KB, total page weight, request count, font count. Most enforceable; fail earliest in CI; most deterministic.
2. **Milestone timings** — user-centric load events: FCP, TTI. Closer to experience; noisier; need a controlled lab environment to compare run-to-run.
3. **Rule-based** — a minimum Lighthouse / PageSpeed score. A coarse catch-all best used as a backstop, not the primary gate.

MDN's refinement: set **two levels** per budget — a **warning** level (proactive planning, doesn't block) and an **error** level (the upper bound where impact is real and the build should fail). This mirrors Lighthouse CI's ESLint-style assertion levels (`off` / `warn` / `error`).

### Wiring budgets into CI (the enforcement that makes it real)

A budget that is not in CI decays. The canonical wirings:

- **Lighthouse `budget.json`** (web.dev/incorporate-performance-budgets-into-your-build-tools): a JSON budget supports `resourceSizes` and `resourceCounts` per resource type — **`script`, `image`, `stylesheet`, `font`, `media`, `document`, `third-party`, `total`** — plus timing budgets. Run it via **Lighthouse CI**, which asserts against the budget per route at `warn` / `error` levels and **fails the build** on an `error`-level breach.
- **bundlesize** (MDN): per-file compressed-size limits checked on every PR; a failing check blocks the merge (integrates with the common CI providers).
- **size-limit**: configure a byte ceiling per bundle; CI fails when exceeded (can also estimate run-time cost).
- **webpack performance hints**: set `performance.maxAssetSize` / `maxEntrypointSize` with `hints: "error"` to fail the production build on oversized assets.

Best practice (web.dev / MDN synthesis): combine a **byte budget** (deterministic, fails early — e.g. one JS budget + one total-weight/image budget) with **one metric/Lighthouse budget** (closer to the user). Byte budgets catch the cause in seconds; the metric budget confirms the effect.

## The cost of JavaScript (the why behind a JS budget)

Osmani's load-bearing point: a JavaScript byte is the most expensive byte you ship. After it **downloads**, the engine must still **parse → compile → execute** it — and in the modern era the dominant costs are **download + CPU execution time**, paid on the main thread, which is also where your interactions run (hence JS bloat is the usual root cause of bad INP). Concretely:

- A **< 170 KB** minified-and-compressed mobile JS budget still decompresses to **~0.7 MB** of code the engine must process.
- Once a bundle exceeds **~50–100 KB**, split it; ship the route's code on navigation and lazy-load the rest.
- **Tree-shaking** removes dead exports; **code-splitting** defers off-route code; **lazy-loading** defers below-the-fold code; **prefer-the-platform** avoids the dependency entirely. These are the four levers behind every JS budget.

## Substrate-Specific Examples

> **Honest scope note**: Power Loom is a CLI/kernel substrate. Performance budgets are a **Runtime-layer** concern that applies *only* when a spawn produces a user-facing web frontend under the `09-react-frontend` lens — never to the kernel, the hooks, the record-store, or the CLI. The example below is deliberately bounded to that surface. (Distinct from `inference-cost-management`, which is the substrate-internal "budget the token/inference cost of a *spawn*" sibling — see Related.)

### `09-react-frontend` — `bundle-budget` as a named instinct (the KB-gap this doc closes)

The react-frontend persona (`packages/runtime/personas/09-react-frontend.md`) opens by stating the lens "think[s] in component composition, render lifecycles, accessibility trees, **bundle sizes, and Core Web Vitals**", and lists *Bundle-budget* as instinct #10, framed verbatim:

> **Bundle-budget** — "What does this import *cost* the user's download?" Every dependency is a tax; tree-shake, code-split at the route, lazy-load below the fold, and prefer the platform over a library that ships 40 KB to format a date.

That persona's *Instinct → KB referral* block explicitly flags this as a **KB-gap**: *"bundle-budget (no perf / Core-Web-Vitals doc in catalog)."* **This doc is the referral target that closes that gap** — when the lens drives a performance finding on a spawn's React output, it cites the CWV thresholds and the budget/CI machinery from here rather than re-deriving them. It pairs naturally with `accessibility-essentials` (instinct #2): both are baseline-quality gates the react-frontend lens treats as ship-blockers, not polish passes, and CLS sits at the seam (a layout shift is both a Vital and an a11y/usability harm).

## Tension with Other Principles

### Performance budget vs YAGNI / velocity

"Optimize later" feels like YAGNI applied to a hypothetical slow user. It is not — the mid-range-phone user on a slow network exists on day one and is exactly who the 75th percentile measures. **Resolution**: the *baseline* (a JS/total byte budget in CI, the three CWV thresholds as targets) is cheap to keep green from the start and expensive to retrofit; treat it as part of "done," like a test. The genuinely deferrable tail — squeezing the last few KB, exotic micro-optimizations — is where YAGNI legitimately applies; articulate that line explicitly (see [trade-off-articulation](../architecture/discipline/trade-off-articulation.md)).

### Budget strictness vs feature richness

A rich feature (a heavy chart library, a fancy editor, a video hero) costs bytes and may bust the budget. **Resolution**: this is a `trade-off-articulation` decision, not an excuse to silently bust the budget. State what the feature buys against what it costs the user (KB, LCP, INP); if it earns its weight, *raise the budget deliberately and record why* — don't let the budget rot by quietly ignoring the failing check.

### Lab metrics vs field metrics

Lighthouse (lab) is reproducible and CI-friendly but is a *simulation*; CrUX/RUM (field, p75) is the truth but lags and is noisier. **Resolution**: gate CI on lab byte/Lighthouse budgets (fast, deterministic) **and** monitor field Vitals at p75 (real outcome). A green lab run with red field Vitals means your lab profile doesn't match real users — fix the profile, don't trust the lab alone.

### KISS vs containment of JS cost

Code-splitting, lazy boundaries, and dynamic imports add structure a single bundle doesn't have. **Resolution**: the bar is the budget. For a small app comfortably under budget, elaborate splitting is complexity for nothing (KISS wins). For an app over its JS budget, splitting *is* the needed fix — that's precisely the case KISS doesn't veto.

## When to use / When NOT to use

**Use this doc when**:

- A spawn produces or modifies a **user-facing web frontend** under the `09-react-frontend` lens.
- Reviewing a change that adds a dependency, a route, a heavy component, a hero image, or anything on the critical path.
- A `tech-stack-analyzer` plan resolves a React/web UI build (the referral target for the bundle-budget instinct).

**Do NOT reach for it when**:

- The work is kernel / hooks / record-store / CLI / pure library code with **no rendered web frontend** — the vast majority of this substrate. (For the substrate-internal cost concern — token/inference budget of a *spawn* — use [inference-cost-management](../architecture/ai-systems/inference-cost-management.md), not this.)
- The surface is a native iOS app — Core Web Vitals are a web metric; iOS performance is a different toolset (Instruments, not Lighthouse).
- You are tempted to add an elaborate budget to an app that is trivially under budget — that is process theater (KISS).

## Failure modes

- **Bolt-on performance** — "optimize later"; it never comes, or arrives as an expensive rewrite. *Fix*: a byte budget in CI from the start; baseline is part of "done."
- **Advisory-only budget** — a budget in a wiki that no build enforces; it decays silently as each PR nudges past it. *Fix*: wire `budget.json` / bundlesize / size-limit into CI at `error` level.
- **Lab-only validation** — green Lighthouse on a fast machine while p75 field Vitals are "poor." *Fix*: monitor field CWV at the 75th percentile (CrUX/RUM), not just the lab.
- **Stale FID thinking** — optimizing for First Input Delay, which was deprecated 2024-03-12. *Fix*: target **INP** (all interactions), the long-task / main-thread problem.
- **Dependency-by-reflex** — `npm i` a 40 KB library for a one-line job without checking the bundle cost. *Fix*: the bundle-budget instinct — prefer the platform; measure the import's cost.
- **Unbudgeted media/late content** — an unsized hero image (LCP) or a late-injected ad/banner (CLS) that no budget guards. *Fix*: set `width`/`height`/`aspect-ratio`; reserve space; budget image KB.
- **Budget-busting without articulation** — raising or ignoring the budget for a feature with no recorded rationale. *Fix*: treat a budget change as a `trade-off-articulation` decision; record the why.

## Tests / verification

Static byte budgets catch the cause early and deterministically; field Vitals confirm the effect. Use both.

**Automated (the CI floor)**:

- **Byte budget**: `bundlesize` / `size-limit` / webpack performance hints fail the build when a tracked bundle exceeds its compressed limit. Run on every PR; a breach blocks merge.
- **Lighthouse CI**: assert a `budget.json` (`resourceSizes` for `script` / `image` / `total` / `third-party`, plus timing budgets) per route at `error` level; the build fails on an over-budget assertion.
- **Rule-based backstop**: a minimum Lighthouse performance score (e.g. > 80) as a coarse catch-all.

**Manual / field (the part automation approximates)**:

- **CWV at p75**: read field data (CrUX / a RUM tool) for **LCP / INP / CLS** at the **75th percentile**, segmented mobile vs desktop. "Good" at p75 is the bar — not the average.
- **Throttled lab pass**: run Lighthouse under mobile + slow-network throttling (not your laptop's profile) and read the LCP/INP-proxy/CLS bands.
- **Interaction pass for INP**: actually click/tap/type through the primary flows and watch for jank — long main-thread tasks are the usual INP culprit (the JS-execution cost).
- **The load-bearing test**: does this change keep LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1 at the 75th percentile *and* stay within its enforced byte budget? If a byte budget is breached or a Vital drops to "needs improvement"/"poor," it is a regression to fix before shipping — not a polish-later item.

## Related Patterns

- [web-dev/accessibility-essentials](accessibility-essentials.md) — the sibling baseline-quality gate for the same `09-react-frontend` lens; both refuse "harden later," and CLS sits at the a11y/perf seam.
- [web-dev/react-essentials](react-essentials.md) — the React idioms (render discipline, code-splitting boundaries, `lazy`/`Suspense`) these budgets are enforced against.
- [web-dev/typescript-react-patterns](typescript-react-patterns.md) — typed component/route patterns that keep code-split boundaries safe.
- [architecture/discipline/trade-off-articulation](../architecture/discipline/trade-off-articulation.md) — busting or raising a budget for a feature is a trade-off to articulate and record, not to silently ignore.
- [architecture/ai-systems/inference-cost-management](../architecture/ai-systems/inference-cost-management.md) — the substrate-internal sibling: budgeting the *token/inference* cost of a spawn, the same "budget, don't hope" discipline applied to LLM cost rather than browser bytes.
- [architecture/discipline/reliability-scalability-maintainability](../architecture/discipline/reliability-scalability-maintainability.md) — performance is a quality attribute in the same non-negotiable-baseline tier as reliability and maintainability.

## Sources

Authored by multi-source synthesis of verified, canonical sources (each URL web-searched/fetched during authoring):

1. **web.dev — Web Vitals** (web.dev/articles/vitals). The Core Web Vitals set (LCP, INP, CLS), the "good ≤ 2.5s / ≤ 200ms / ≤ 0.1" good-thresholds, and the **75th-percentile, device-segmented** measurement framing.
2. **web.dev — LCP / INP / CLS** (web.dev/articles/lcp, /inp, /cls). The full three-band boundaries: LCP good ≤2.5s / NI 2.5–4.0s / poor >4.0s; INP good ≤200ms / NI 200–500ms / poor >500ms; CLS (unitless) good ≤0.1 / NI 0.1–0.25 / poor >0.25.
3. **web.dev Blog — Interaction to Next Paint becomes a Core Web Vital on March 12** (web.dev/blog/inp-cwv-march-12, 2024). **INP replaced FID** as a Core Web Vital on **2024-03-12**; FID was deprecated and removed from the program. (Corroborated by Google Search Central's 2023 "Introducing INP to Core Web Vitals" announcement.)
4. **web.dev — Performance budgets 101** (web.dev/articles/performance-budgets-101, Milica Mihajlija, 2018-11-05). The three budget types (quantity-based / milestone timings / rule-based) and the starter numbers: < 170 KB critical-path resources, < 5 s TTI, Lighthouse score > 80.
5. **web.dev — Incorporate performance budgets into your build tools** (web.dev/articles/incorporate-performance-budgets-into-your-build-tools). The Lighthouse `budget.json` `resourceSizes` / `resourceCounts` categories — `document, font, image, media, other, script, stylesheet, third-party, total` — and asserting them via Lighthouse CI.
6. **Addy Osmani — The Cost of JavaScript** (medium.com/dev-channel/the-cost-of-javascript-84009f51e99e) and **The cost of JavaScript in 2019** (v8.dev/blog/cost-of-javascript-2019). The download → parse → compile → execute cost model, the modern "download + CPU execution time" dominance, the < 170 KB minified+compressed (~0.7 MB uncompressed) mobile JS budget, and the split-bundles-over-~50–100 KB guidance.
7. **MDN Web Docs — Performance budgets** (developer.mozilla.org/en-US/docs/Web/Performance/Guides/Performance_budgets). The warning-vs-error two-level budget guidance and the CI tooling: **bundlesize**, **webpack performance hints**, and **Lighthouse Bot**.

Substrate grounding cites the live persona definition `packages/runtime/personas/09-react-frontend.md` — instinct #10 *Bundle-budget* (quoted verbatim) and the *Instinct → KB referral* block that explicitly names this as a KB-gap ("no perf / Core-Web-Vitals doc in catalog") — and its contract `09-react-frontend.contract.json`.

## Phase

Authored: kb authoring batch (web-dev, single-lens KB-gap harvest). The canonical performance/Core-Web-Vitals referral for the `09-react-frontend` lens, closing the explicitly-codified *bundle-budget* KB-gap. Deliberately scoped as a Runtime-layer concern (user-facing web frontend only), explicitly NOT a kernel concern, and explicitly disjoint from the substrate-internal `inference-cost-management` (token/spawn cost). Multi-source synthesis from seven verified web.dev / MDN / Osmani sources; all CWV band boundaries, the 2024-03-12 INP-replaces-FID date, the three budget types, the JS cost model, and the CI tool set are grounded in checkable sources with years. Pairs with `accessibility-essentials` as a sibling baseline-quality gate for the same lens.
