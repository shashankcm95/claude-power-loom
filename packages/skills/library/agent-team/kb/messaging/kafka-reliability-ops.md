---
kb_id: messaging/kafka-reliability-ops
version: 1
tags:
  - messaging
  - kafka
  - reliability
  - operations
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-kafka"
  - "Apache Kafka 4.0.0 Release Announcement (kafka.apache.org/blog/2025/03/18)"
  - "Testcontainers Kafka module (java.testcontainers.org/modules/kafka)"
related:
  - messaging/kafka-spring
status: active
---

## Summary

**Concept**: Kafka operational tuning — large-message three-sided config, consumer-lag math, offsets, and the testing surface (`@EmbeddedKafka` / Testcontainers).
**Key APIs**: topic `max.message.bytes`, producer `MAX_REQUEST_SIZE_CONFIG`, consumer `MAX_PARTITION_FETCH_BYTES_CONFIG` + `FETCH_MAX_BYTES_CONFIG`; `AdminClient.listConsumerGroupOffsets`, `KafkaConsumer.endOffsets`.
**Reliability**: lag = end-offset − committed-offset per `TopicPartition`; large messages require all three size limits raised together.
**2026-currency**: KIP-848 incremental rebalance + KIP-932 share groups (Kafka 4.0); `org.testcontainers.kafka.KafkaContainer` replaces the deprecated `containers.KafkaContainer`.
**Sources**: Baeldung `spring-kafka` monitoring + large-message articles; kafka.apache.org / Testcontainers 2026.

## Quick Reference

**Large messages — the three-sided config (raise ALL three or it fails)**:

| Side | Property | Note |
|---|---|---|
| Topic | `max.message.bytes` | per-topic broker limit (also broker `message.max.bytes`) |
| Producer | `MAX_REQUEST_SIZE_CONFIG` | max serialized request size |
| Consumer | `MAX_PARTITION_FETCH_BYTES_CONFIG` + `FETCH_MAX_BYTES_CONFIG` | per-partition and total fetch caps |

The Baeldung demo sets all of them to ~20 MB. Raising only one (e.g., the producer) leaves the broker or consumer rejecting the oversized record.

**Consumer-lag math**: `lag = end_offset − committed_consumer_group_offset`, computed per `TopicPartition`. Committed offsets come from `AdminClient.listConsumerGroupOffsets(groupId).partitionsToOffsetAndMetadata()`; end offsets from `consumer.endOffsets(...)` (`LagAnalyzerService.java:36-90`). Poll on a schedule with `@EnableScheduling` + `@Scheduled(fixedDelay=...)`.

**Testing surface**:
- `@EmbeddedKafka(partitions=1, brokerProperties={...})` + `@SpringBootTest` + `@DirtiesContext` — in-JVM broker (`EmbeddedKafkaIntegrationTest.java:17-51`).
- Testcontainers `KafkaContainer` — a real Dockerized broker (`KafkaTestContainersLiveTest.java:50-125`).
- `CountDownLatch` to assert async receipt.

**Top gotchas**:
- `@EmbeddedKafka` hard-codes `port=9092` → collides with a local broker / parallel runs (the monitoring live test uses 9085 to dodge).
- `computeLags` uses `Math.abs(...)`, masking the sign and hiding anomalous offsets — a teaching quirk, not a pattern to copy.
- `LagAnalyzerApplication` busy-spins (`while(true);`) burning a core; `ProducerSimulator` blocks on `.get()` per send.
- Large-message demo reads `RandomTextFile.txt` from CWD → `NoSuchFileException` (file absent in repo).

**Current (mid-2026)**: KIP-848 server-driven incremental rebalance (no stop-the-world) and KIP-932 share groups arrived in Kafka 4.0. Testcontainers `org.testcontainers.containers.KafkaContainer` is deprecated → use `org.testcontainers.kafka.KafkaContainer` with JUnit-5 `@Testcontainers`/`@Container`; the 2021 `confluentinc/cp-kafka:5.4.3` + JUnit-4 `@ClassRule` pattern is obsolete.

## Full content

This atom collects the operational/reliability concerns the Baeldung `spring-kafka` module demonstrates beyond plain produce/consume.

### Large messages

Kafka enforces size limits at three independent places; an oversized payload must clear all of them. The topic-level `max.message.bytes` (with the broker `message.max.bytes`), the producer `MAX_REQUEST_SIZE_CONFIG`, and the consumer's `MAX_PARTITION_FETCH_BYTES_CONFIG` + `FETCH_MAX_BYTES_CONFIG` are all tuned to ~20 MB in the example (`KafkaApplicationLongMessage.java`, `MAX_*` keys in the config classes, `max.message.bytes` in `KafkaTopicConfig.java:65`). Raising one side alone leaves the others rejecting the record. (In production the alternative is the claim-check EIP pattern — store the blob externally, send a reference — but the corpus only teaches the size-limit approach.)

### Consumer-lag monitoring

Lag is the gap between how far the producer has written and how far the consumer group has committed: `lag = end_offset − committed_offset`, per `TopicPartition`. Committed offsets via `AdminClient.listConsumerGroupOffsets(groupId)`, end offsets via `KafkaConsumer.endOffsets(...)` (`LagAnalyzerService.java:36-90`), polled on a schedule. The `Math.abs` quirk in `computeLags` masks the sign and would hide a negative/anomalous lag — do not copy it.

### Testing

Three approaches: `@EmbeddedKafka` (fast in-JVM broker, but hard-coded `port=9092` collides), Testcontainers `KafkaContainer` (a real Dockerized broker), and a `CountDownLatch` to assert async receipt. The busy-spin (`while(true);`) and per-send `.get()` block are anti-patterns the demo apps carry.

### Offsets and delivery semantics (gaps)

The corpus covers committed-offset reading for lag but does NOT cover exactly-once / transactional Kafka, rebalance listeners, Schema Registry, or Kafka Streams. These remain real gaps.

### 2026 currency

- **KIP-848 next-gen consumer rebalance** (GA in Kafka 4.0): server-driven, incremental, eliminating stop-the-world rebalances — directly relevant to consumer-group lag behavior the 2021 material predates. [Apache Kafka 4.0.0 Release Announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- **KIP-932 "Queues for Kafka" / share groups** (early access in 4.0): cooperative point-to-point consumption on standard topics; Spring Kafka 4.0 surfaces it via `SharedConsumerContainer` + `@ShareKafkaListener` (Preview). [Spring Kafka 4.0.0 GA](https://spring.io/blog/2025/11/18/spring-kafka-4/)
- **Testcontainers API moved.** `org.testcontainers.containers.KafkaContainer` is deprecated; use `org.testcontainers.kafka.KafkaContainer` (official Apache Kafka image) or `org.testcontainers.kafka.ConfluentKafkaContainer` (Confluent `cp-kafka` 7.4.0+), with JUnit-5 `@Testcontainers`/`@Container`. The 2021 `confluentinc/cp-kafka:5.4.3` + JUnit-4 `@ClassRule`/`SpringRunner` pattern is obsolete (current Testcontainers is 1.19+/2.x with KRaft support and a changed `KafkaContainer` API). [Testcontainers Kafka module](https://java.testcontainers.org/modules/kafka/)
- **ZooKeeper removed.** Kafka 4.0 is KRaft-only; any operational tooling that read `--zookeeper localhost:2181` must use `--bootstrap-server`. [Apache Kafka 4.0.0 announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- **Message formats v0/v1 removed** in Kafka 4.0; brokers require Java 17+, clients/Streams Java 11+. [Apache Kafka 4.0.0 announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
