---
kb_id: design-pushback/synchronous-llm-calls-in-request-path
version: 1
tags: [design-pushback, ml, web, backend, latency, medium-severity]
related:
  - architecture/ai-systems/inference-cost-management
  - architecture/ai-systems/agent-design
  - architecture/discipline/reliability-scalability-maintainability
status: active+enforced
pattern: |
  Making a synchronous LLM API call (Claude/OpenAI/etc.) inside the
  request-handler hot path for a user-facing endpoint, blocking the
  HTTP response until the LLM finishes. Includes chained LLM calls
  (one waiting for another) without streaming or async-queue
  decomposition.
severity: MEDIUM
applies_when:
  intent: [build, plan]
  domain: [web, backend, ml]
  feature_keywords:
    - LLM
    - Claude
    - OpenAI
    - GPT
    - inference
    - generation
    - summarize
    - "ask AI"
    - chatbot
    - completion
    - embedding
applies_NOT_when:
  - "streaming response — client receives tokens as they generate"
  - "background job triggered by HTTP, completes asynchronously"
  - "edge function with 60s+ timeout budget AND explicit p95 latency target"
  - "internal admin tool with single user, no concurrency concern"
preferred_alternative:
  - "Streaming response (SSE / chunked transfer) — client sees tokens in <500ms"
  - "Async job queue (BullMQ / inngest / Temporal / SQS) + polling/webhook for completion"
  - "Background worker + WebSocket for real-time updates"
  - "Cached precomputed result (when the LLM output is bounded/enumerable)"
why_better: |
  - **P99 latency**: LLM calls have multi-second tail latencies (Claude
    Sonnet typical: p50 ~2s, p99 ~15s; longer outputs 10x worse). A
    synchronous LLM call makes your endpoint's p99 = the LLM's p99.
    Streaming or async breaks this coupling.
  - **Concurrency**: HTTP servers have finite worker pool. A synchronous
    LLM call ties up a worker for the full duration. 100 concurrent
    users × 5s LLM call × Node single-thread = blocked event loop or
    requires 100+ workers. Async queues decouple this.
  - **Timeout sensitivity**: gateways (CloudFlare 100s, AWS ALB 60s,
    Vercel 30s by default) and clients (browser fetch 60s, mobile
    typically 30s) impose ceilings. Long LLM outputs hit these limits.
    Streaming + async-queue patterns route around them.
  - **Retry economics**: a failed sync request requires the client to
    re-issue and wait again from scratch (paying the LLM cost twice).
    Async-queue retries happen server-side, transparent to the client.
  - **Cost observability**: async job state machines naturally expose
    "how much LLM spend per task type" — finance / capacity planning
    needs this. Sync calls obscure cost attribution.
  - **UX feedback**: streaming gives the user immediate feedback
    (tokens appearing). A 5-second blank wait + sudden full response
    feels broken even if the total time is identical. Modern users
    expect streaming for any LLM-mediated experience.
override_requires: |
  Explicit acknowledgment of:
  - Your p99 endpoint latency target is >= the LLM's p99 (typically
    >10s); your gateway / client timeouts accommodate this
  - Your concurrency model handles N-second blocking calls without
    saturation (worker pool sized for N × concurrent_users)
  - You accept the cost-attribution opacity
  Or: explain the constraint that prevents streaming/async (e.g.,
  legacy client that can't handle streaming responses).
empirical_origin: |
  v2.8.2-run1 (PDF-to-Tutorial): the brief's Phase 3 had Server Action
  for "Generate Quiz" that called OpenAI synchronously. Live-OpenAI-
  through-UI was deferred (P3-5) precisely because of UX-latency
  concerns; the Phase 3 architecture was correct (Server Action returns
  immediately with a job ID) but the brief's wording could have led an
  unconstrained team to build the sync version. This entry exists to
  catch THAT class of brief.
---

## Quick Reference

**The anti-pattern**: A web route handler does something like:

```js
// Express / Next.js Route Handler
app.post('/generate-summary', async (req, res) => {
  const summary = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [...],
  });  // Blocks 5-15 seconds
  res.json({ summary: summary.choices[0].message.content });
});
```

**Why it bites**: at 50 concurrent users, your Node process is blocked
on outbound LLM calls. New requests queue. Existing connections hit
gateway timeouts. Users see "loading..." for 8 seconds, then either get
the answer or a 504. Your error budget burns.

**The fix**: pick one of three patterns based on your UX:

```js
// Pattern 1: Streaming (best UX for chat / long-form output)
app.post('/generate-summary', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const stream = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [...],
    stream: true,
  });
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk.choices[0])}\n\n`);
  }
  res.end();
});

// Pattern 2: Async job queue (best for batch / heavy generation)
app.post('/generate-summary', async (req, res) => {
  const jobId = await queue.enqueue('generate-summary', req.body);
  res.json({ jobId, statusUrl: `/jobs/${jobId}` });
});
// Worker process picks up the job, calls LLM, stores result; client polls

// Pattern 3: Cached precompute (best when LLM output is enumerable)
app.post('/get-summary/:docId', async (req, res) => {
  const cached = await db.summaries.findOne({ docId: req.params.docId });
  if (cached) return res.json(cached);
  // Trigger background job to generate; return 202 Accepted + retry-after
  await queue.enqueue('generate-summary', { docId: req.params.docId });
  res.status(202).set('Retry-After', '5').json({ status: 'generating' });
});
```

## Full content

### Pattern selection guide

| UX need | Pattern | Why |
|---------|---------|-----|
| Chat / conversation | Streaming SSE | User expects tokens-as-generated; latency-to-first-token matters more than total |
| Long-form generation (article, report) | Streaming OR async + WebSocket | If user is waiting at screen: stream. If they'll come back: queue + notify. |
| Batch / one-off (PDF→tutorial, summarize-archive) | Async queue + status endpoint | Total throughput matters; per-request latency doesn't. Cost-optimal. |
| Triggered analytics (auto-tag, classify) | Async queue, no user waiting | Pure background; user never sees the LLM call exist. |
| Search / RAG | Sync OK if <1s p99 (embedding + retrieve) | Embeddings are usually fast enough; final LLM generation may stream. |

### The streaming-as-required-default position

In 2024+, **streaming is the default expectation** for any user-facing
LLM feature, not a fancy optimization. The reasoning:

- All major LLM providers expose streaming APIs as primary
- Browser EventSource + Server-Sent Events is universally supported
- Server Actions in Next.js, Streams in Express, ReadableStream in
  Cloudflare Workers all support streaming as first-class
- User-perceived latency to first token (typically <1s) is what feels
  responsive; total token time is secondary

A brief that says "build an LLM feature" without specifying streaming
should be interpreted as "streaming, unless explicitly contraindicated".
The pushback exists to surface this assumption before the team builds
the sync version and has to refactor.

### The cost-observability angle

Sync LLM calls embed cost in request-response logs. To answer "how much
are we spending on summaries this month?", you have to:

1. Filter access logs for the relevant endpoint
2. Estimate token counts from request/response sizes
3. Multiply by per-model rates

Async jobs make cost first-class:

```
jobs table:
  id | type             | tokens_in | tokens_out | model | cost_usd | created_at
  --------------------------------------------------------------------------
  1  | generate-summary | 1200      | 350        | gpt-4 | 0.024    | ...
```

Aggregating cost is `SELECT SUM(cost_usd) FROM jobs WHERE type = 'X'`.
This matters once spend exceeds noise — typically around month-2 of any
LLM-feature deployment.

### When sync IS acceptable

There are legitimate sync-LLM contexts:

- **Tooling / dev workflows**: an internal `claude review-pr` CLI tool
  where the user is at a terminal and 8s is fine
- **Cron / scheduled jobs**: a nightly tagging job where there are no
  concurrent users
- **Single-user productivity tools**: a personal app where concurrency
  = 1 by definition
- **Edge functions with explicit timeout budget**: Cloudflare Worker
  with 30s budget AND explicit p95 target that includes the LLM time

If your context matches one of these, override the pushback with the
override rationale spelling out which.

### References

- OpenAI streaming docs: https://platform.openai.com/docs/api-reference/streaming
- Anthropic streaming docs: https://docs.anthropic.com/en/api/messages-streaming
- "Building production-grade LLM apps" — common industry write-ups
- BullMQ / inngest / Temporal docs for async-queue patterns
- Server-Sent Events spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
