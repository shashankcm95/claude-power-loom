---
kb_id: messaging/amqp-reliability
version: 1
tags:
  - messaging
  - amqp
  - rabbitmq
  - reliability
  - dead-letter
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-amqp (errorhandling, exponentialbackoff)"
  - "Spring AMQP 4.0.0 Available (spring.io/blog/2025/11/19)"
  - "RabbitMQ 4.0 quorum queue features (rabbitmq.com/blog/2024/08/28)"
related:
  - messaging/amqp-model
  - messaging/enterprise-integration-patterns
  - messaging/rocketmq
status: active
---

## Summary

**Concept**: AMQP error handling done deepest in the corpus — dead-letter exchange/queue (DLX/DLQ), parking-lot, poison-message prevention, and two contrasting exponential-backoff strategies (blocking in-memory vs non-blocking retry-queues).
**Key APIs**: queue args `x-dead-letter-exchange` + `x-dead-letter-routing-key` via `QueueBuilder`; `RetryInterceptorBuilder.stateless().backOffOptions(...)`; `ConditionalRejectingErrorHandler` + `FatalExceptionStrategy`; `AmqpRejectAndDontRequeueException`.
**Reliability**: a retry that re-publishes to the main exchange MUST carry/increment a count header (`x-retries-count`) or it loops forever; `default-requeue-rejected=false` stops infinite requeue-on-exception.
**2026-currency**: classic DLX APIs unchanged in Spring AMQP 4.0; quorum queues are the HA target in RabbitMQ 4.0.
**Sources**: Baeldung `spring-amqp` errorhandling + exponentialbackoff packages; spring.io / rabbitmq.com 2026.

## Quick Reference

**Dead-letter wiring**: queue args `x-dead-letter-exchange` + `x-dead-letter-routing-key`, set via `QueueBuilder.durable(name).withArgument(...)` (or `.deadLetterExchange(...).deadLetterRoutingKey(...)`). Rejected/failed messages route to a DLQ.

**The four DLQ strategies** (Baeldung selects one at runtime via `@ConditionalOnProperty(value="amqp.configuration.current", havingValue=...)`):

| Strategy | Behavior |
|---|---|
| simple-dlq | default-exchange dead-lettering to one DLQ |
| routing-dlq | dead-letter via a fanout DLX → DLQ |
| dlx-custom | DLQ consumer increments an `x-retries-count` header, re-publishes to the main exchange until `MAX_RETRIES_COUNT`, then **discards** |
| parking-lot-dlx | same header-counted retry, but after max retries forwards to a **parking-lot queue** for manual inspection instead of discarding |

**Poison-message prevention**: `spring.rabbitmq.listener.simple.default-requeue-rejected=false` globally stops infinite requeue-on-exception loops; failed messages dead-letter instead.

**Exponential backoff — two approaches contrasted**:
- *Blocking, in-memory (Spring Retry)*: `RetryInterceptorBuilder.stateless().backOffOptions(initial, multiplier, max).maxAttempts(n).recoverer(new RejectAndDontRequeueRecoverer())` added to the container advice chain. **Blocks the consumer thread** during backoff.
- *Non-blocking, dead-letter "retry queues"*: a custom AOP `MethodInterceptor` (`RetryQueuesInterceptor`) republishes to the next `retry-queue-N` with a per-message TTL (`props.setExpiration(initialInterval * factor^retry)`, capped); each retry queue dead-letters after TTL to a `retry-wait-ended-queue` whose listener re-routes back to the original exchange/routing-key (`x-original-exchange`/`x-original-routing-key` headers); count in `x-retried-count`; manual ack/reject (`ackMode="MANUAL"`).

**Listener-level error handling**: a custom `org.springframework.util.ErrorHandler` (convert non-business exceptions to `AmqpRejectAndDontRequeueException` → dead-letter; leave business exceptions to requeue); `ConditionalRejectingErrorHandler` + a custom `FatalExceptionStrategy` overriding `isFatal`.

**Top gotchas**:
- A DLQ retry that re-publishes WITHOUT carrying/incrementing a count header loops indefinitely.
- Blocking retry advice ties up the consumer thread — throughput hit.
- `RetryQueuesInterceptor` relies on positional `invocation.getArguments()[1]/[0]` being `Message`/`Channel` — brittle to listener-method argument order.

**Current (mid-2026)**: classic DLX / `QueueBuilder` / `@RabbitListener` error-handling APIs are retained in Spring AMQP 4.0 (Java 17+). At the broker, quorum queues (RabbitMQ 4.0) are the HA answer (mirrored queues removed); per-message TTL retry-queue tricks still work but quorum-queue semantics differ slightly.

## Full content

Error handling, dead-lettering, and retry are taught most deeply in the Baeldung `spring-amqp` module — it is the richest reliability material in the whole messaging corpus.

### Dead-letter exchange / queue (DLX/DLQ)

A queue declared with the args `x-dead-letter-exchange` + `x-dead-letter-routing-key` forwards rejected/expired/failed messages to a DLX, which routes them to a DLQ. In Spring AMQP this is `QueueBuilder.durable(name).withArgument("x-dead-letter-exchange", ...).withArgument("x-dead-letter-routing-key", ...)` (or the fluent `.deadLetterExchange(...).deadLetterRoutingKey(...)`).

### Four DLQ strategies

Selected at runtime via `@ConditionalOnProperty(value="amqp.configuration.current", havingValue=...)`:

- **simple-dlq** — default-exchange dead-lettering to one DLQ.
- **routing-dlq** — dead-letter via a fanout DLX → DLQ.
- **dlx-custom** — the DLQ consumer retries by incrementing a custom `x-retries-count` header and re-publishing to the main exchange until `MAX_RETRIES_COUNT`, then **discards**.
- **parking-lot-dlx** — same header-counted retry, but after max retries forwards to a **parking-lot queue** for manual inspection instead of discarding.

(`errorhandling/configuration/*AmqpConfiguration.java`; needs `spring.main.allow-bean-definition-overriding=true` because each config defines same-named beans.)

### Poison messages

Without `spring.rabbitmq.listener.simple.default-requeue-rejected=false`, a thrown exception in a Spring AMQP listener requeues the message forever (a poison-message loop). Setting it false makes failures dead-letter instead. Equally, a DLQ-driven retry that re-publishes to the main exchange MUST carry and increment a count header (`x-retries-count` / `x-retried-count`) — otherwise it loops indefinitely.

### Listener-level error handlers

A custom `org.springframework.util.ErrorHandler` plugged into the container can convert non-business exceptions to `AmqpRejectAndDontRequeueException` (→ dead-letter) while leaving genuine business exceptions to requeue. `ConditionalRejectingErrorHandler` with a custom `FatalExceptionStrategy` (override `isFatal`) makes the fatal/non-fatal decision declarative.

### Exponential backoff — blocking vs non-blocking

The module contrasts two backoff designs:

- **Blocking, in-memory (Spring Retry)**: `RetryInterceptorBuilder.stateless().backOffOptions(initial, multiplier, max).maxAttempts(n).recoverer(...)` added to the container's advice chain, with `RejectAndDontRequeueRecoverer` as the recoverer. Simple, but it **blocks the consumer thread** during backoff — a throughput hit.
- **Non-blocking, dead-letter "retry queues"** (`RetryQueuesInterceptor`, `RetryQueues.java`): a custom AOP `MethodInterceptor` republishes to the next `retry-queue-N` with a per-message TTL (`props.setExpiration(initialInterval * factor^retry)`, capped). Each retry queue dead-letters after its TTL to a `retry-wait-ended-queue`; that queue's listener re-routes the message back to the original exchange/routing-key using `x-original-exchange`/`x-original-routing-key` headers, with the retry count in `x-retried-count`. Requires manual ack/reject (`ackMode="MANUAL"`). More moving parts but it frees the consumer thread during backoff.

### Pitfalls

- Missing/non-incremented count header → infinite retry loop (above).
- Blocking advice blocks the consumer thread.
- `RetryQueuesInterceptor` uses positional `invocation.getArguments()[1]/[0]` as `Message`/`Channel` — brittle, depends on the listener method's argument order.

### 2026 currency

- **Spring AMQP 4.0** (Nov 19, 2025, Spring Framework 7, Java 17+) keeps the classic DLX / `QueueBuilder` / error-handler / retry APIs valid; only the baseline (Java 17, Jackson 3) moved. [Spring AMQP 4.0.0 Available](https://spring.io/blog/2025/11/19/spring-amqp-4-0-0-available/)
- **Quorum queues are the HA target.** RabbitMQ 4.0 removed classic mirrored queues; Raft-based quorum queues replace them — relevant when a retry/parking-lot design assumes mirrored-queue durability. [RabbitMQ 4.0 quorum queue features](https://www.rabbitmq.com/blog/2024/08/28/quorum-queues-in-4.0), [RabbitMQ | endoflife.date](https://endoflife.date/rabbitmq)
- **RabbitMQ EOL discipline**: 4.1 EOL Jan 30, 2026 (unpatched CVEs); run 4.2 (until Jul 31, 2026) or 4.3.x for a reliability-critical deployment. [RabbitMQ | endoflife.date](https://endoflife.date/rabbitmq)
- The EIP-level analog of the DLX (Camel's Dead Letter Channel) is covered in `messaging/enterprise-integration-patterns`; the conceptual DLQ + retry-strategy vocabulary remains entirely current — the churn is API renames, not obsolete ideas.
