---
kb_id: messaging/rocketmq
version: 1
tags:
  - messaging
  - rocketmq
  - spring-boot
  - transactions
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-rocketmq"
  - "rocketmq-spring releases (github.com/apache/rocketmq-spring/releases)"
  - "CVE-2023-33246 (SentinelOne vulnerability database)"
related:
  - messaging/kafka-spring
  - messaging/amqp-reliability
status: active
---

## Summary

**Concept**: Apache RocketMQ via the Spring Boot starter — template/listener idiom plus transactional (half-message / 2-phase-commit) messaging.
**Key APIs**: `RocketMQTemplate.convertAndSend(topic, payload)`; `@RocketMQMessageListener(topic=, consumerGroup=)` + `RocketMQListener<T>.onMessage(T)`; `@RocketMQTransactionListener` + `RocketMQLocalTransactionListener` (`executeLocalTransaction`/`checkLocalTransaction` → COMMIT/ROLLBACK/UNKNOWN).
**Reliability**: producer retry tuning (`retry-times-when-send-failed`, `retry-next-server`); transactional half-message resolves UNKNOWN via a broker callback.
**2026-currency**: starter 2.0.4 → 2.3.3 (RocketMQ 5.x); separate `rocketmq-v5-client-spring-boot-starter` for the gRPC client; CVE-2023-33246 unauthenticated RCE (<4.9.6 / <5.1.1).
**Sources**: Baeldung `apache-rocketmq` module; apache/rocketmq-spring + SentinelOne CVE DB 2026.

## Quick Reference

**Send / receive**:
```java
rocketMQTemplate.convertAndSend(topic, payload);   // producer/CartEventProducer.java

@RocketMQMessageListener(topic = "cart-item-add", consumerGroup = "cart-consumer")
public class CartEventConsumer implements RocketMQListener<CartItemEvent> {
    public void onMessage(CartItemEvent e) { ... }   // consumer/CartEventConsumer.java
}
```

**Consumer groups** behave like Kafka's: messages load-balance across instances of one `consumerGroup`; different groups each receive every message.

**Transactional (half-message / 2-phase commit)**:
```java
@RocketMQTransactionListener(txProducerGroup = "test-transaction")
class TransactionListenerImpl implements RocketMQLocalTransactionListener {
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        // run local DB tx → return COMMIT / ROLLBACK / UNKNOWN
    }
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        // broker callback resolving an UNKNOWN result
    }
}
```
The broker holds the "half" message until `executeLocalTransaction` commits; an UNKNOWN is resolved by the broker calling back `checkLocalTransaction`.

**Producer tuning (properties)**: `send-message-timeout`, `compress-message-body-threshold` (4096), `max-message-size` (4194304), `retry-times-when-send-failed`, `retry-times-when-send-async-failed`, `retry-next-server`.

**Top gotchas**:
- The Baeldung transaction listener returns hardcoded states; the `test-transaction` producer group is never exercised by a real `sendMessageInTransaction` call — the transactional send path is declared but not used (tutorial-grade stub).

**Current (mid-2026)**: `rocketmq-spring-boot-starter` 2.0.4 → 2.3.3 (Mar 13, 2025), compatible with RocketMQ 5.x; a separate `rocketmq-v5-client-spring-boot-starter` targets the gRPC client. The template/listener API surface is stable. Patch CVE-2023-33246 (unauthenticated config-update RCE) — ensure 5.x deployments are >= 5.1.1.

## Full content

The Baeldung `apache-rocketmq` module is a single introductory article using `rocketmq-spring-boot-starter 2.0.4`. It covers the basic producer/consumer idiom and declares (but stubs) transactional messaging.

### Producer / consumer

`RocketMQTemplate.convertAndSend(topic, payload)` serializes a domain event (`producer/CartEventProducer.java`); a `@RocketMQMessageListener(topic=, consumerGroup=)` class implementing `RocketMQListener<T>.onMessage(T)` deserializes it (`consumer/CartEventConsumer.java`). Consumer groups follow Kafka semantics — same-group instances load-balance, distinct groups fan out. (See `messaging/kafka-spring` for the parallel consumer-group model.)

### Transactional messaging (half-message / 2-phase commit)

`@RocketMQTransactionListener(txProducerGroup=...)` + `RocketMQLocalTransactionListener` implements two methods: `executeLocalTransaction` runs the local DB transaction and returns `RocketMQLocalTransactionState.{COMMIT, ROLLBACK, UNKNOWN}`; `checkLocalTransaction` is the broker's callback to resolve an UNKNOWN result (`transaction/TransactionListenerImpl.java`). The broker stores a "half" (prepared) message invisible to consumers until the local transaction commits — the 2-phase-commit pattern for transactional messaging.

### Producer reliability tuning

Properties control retry and message sizing: `retry-times-when-send-failed`, `retry-times-when-send-async-failed`, `retry-next-server` (failover to the next broker), plus `send-message-timeout`, `compress-message-body-threshold` (4096), `max-message-size` (4194304). (The retry vocabulary parallels the AMQP retry strategies in `messaging/amqp-reliability`, but here it is broker-side producer config rather than consumer-side dead-lettering.)

### Pitfalls

- Tutorial-grade stub: the transaction listener returns hardcoded states; the `test-transaction` producer group is never exercised by an actual `sendMessageInTransaction` call — the transactional send path is declared but not used, so the half-message flow is shown structurally, not actually run.
- A stray unused `<geode.core>` pom property.

### 2026 currency

- **Starter version moved.** `rocketmq-spring-boot-starter` 2.0.4 → 2.3.3 (Mar 13, 2025), compatible with RocketMQ 5.x. A separate `rocketmq-v5-client-spring-boot-starter` targets the new gRPC client. The template/listener API surface is stable. [rocketmq-spring releases](https://github.com/apache/rocketmq-spring/releases), [v5 starter](https://mvnrepository.com/artifact/org.apache.rocketmq/rocketmq-v5-client-spring-boot-starter)
- **CVE-2023-33246 — RocketMQ unauthenticated config-update RCE.** Affects RocketMQ 5.0.0–5.1.0 and <4.9.5 (NameServer/Broker/Controller exposed without permission checks). Fixed in 4.9.6 / 5.1.1+ — ensure 5.x deployments are >= 5.1.1. [CVE-2023-33246 (SentinelOne DB)](https://www.sentinelone.com/vulnerability-database/cve-2023-33246/), [Juniper threat research — CVE-2023-33246](https://blogs.juniper.net/en-us/threat-research/cve-2023-33246-apache-rocketmq-remote-code-execution-vulnerability)
- The consumer-group + transactional-messaging concepts carry forward unchanged; only the starter version and the RocketMQ 5.x line (with its separate gRPC starter) have moved.
