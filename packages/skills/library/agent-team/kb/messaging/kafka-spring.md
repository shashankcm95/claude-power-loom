---
kb_id: messaging/kafka-spring
version: 1
tags:
  - messaging
  - kafka
  - spring
  - producer-consumer
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-kafka"
  - "Spring Kafka 4.0 GA (spring.io/blog/2025/11/18/spring-kafka-4)"
  - "Apache Kafka 4.0.0 Release Announcement (kafka.apache.org/blog/2025/03/18)"
related:
  - messaging/kafka-reliability-ops
  - messaging/rocketmq
  - messaging/jgroups-group-messaging
status: active
---

## Summary

**Concept**: Apache Kafka via Spring for Apache Kafka — topic/partition sharding + consumer-group fan-out, producer/consumer factory beans, annotation listeners.
**Key APIs**: `KafkaTemplate`/`ProducerFactory`, `@KafkaListener`/`ConcurrentKafkaListenerContainerFactory`, `@EnableKafka`, `NewTopic`/`KafkaAdmin`, `@TopicPartition`, `JsonSerializer`/`JsonDeserializer`.
**Gotcha**: same topic + two `groupId`s = fan-out; same `groupId` across instances = load-balance. Null key + explicit partition overrides round-robin.
**2026-currency**: `KafkaTemplate.send` returns `CompletableFuture` (was `ListenableFuture`) in Spring Kafka 3.x+; Kafka 4.0 is KRaft-only (no ZooKeeper).
**Sources**: Baeldung `spring-kafka` module; spring.io / kafka.apache.org 2026.

## Quick Reference

**Canonical producer**: a `Map` of `ProducerConfig` keys → `DefaultKafkaProducerFactory` → `KafkaTemplate`. `template.send(topic, key, value)` is async and returns a future; attach a callback to read the committed offset on success (`getRecordMetadata().offset()`) or handle failure.

**Canonical consumer**: `Map` of `ConsumerConfig` keys → `DefaultKafkaConsumerFactory` → `ConcurrentKafkaListenerContainerFactory` (one per consumer group). `@KafkaListener(topics=, groupId=, containerFactory=)` on a method; `containerFactory="..."` selects which factory.

```java
@KafkaListener(topics = "greetings", groupId = "group-1",
               containerFactory = "greetingKafkaListenerContainerFactory")
public void listen(@Payload Greeting g,
                   @Header(KafkaHeaders.RECEIVED_PARTITION_ID) int partition) { ... }
```

**Key names/annotations**: `@EnableKafka`, `KafkaTemplate`, `ProducerFactory`/`ConsumerFactory`, `ConcurrentKafkaListenerContainerFactory`, `@TopicPartition(partitions={"0","3"})`, `KafkaAdmin` + `NewTopic(name, partitions, replicationFactor)`, `JsonSerializer` / `new JsonDeserializer<>(Greeting.class)`, `factory.setRecordFilterStrategy(record -> ...)`.

**Topology model**:
- **Partitions** shard a topic; targeted send `send(topic, partition, key, value)`; partition-restricted consume via `@TopicPartition`.
- **Consumer groups**: messages load-balance across instances of the *same* group; *different* groups each receive every message (fan-out demonstrated by two `@KafkaListener` on one topic with distinct `groupId`).

**Top gotchas**:
- Fan-out vs load-balance is entirely a `groupId` decision — easy to misconfigure.
- `JsonDeserializer` trusted-packages restriction: works in the Baeldung demo only because the target type is passed explicitly (`new JsonDeserializer<>(Greeting.class)`); the default restriction otherwise rejects deserialization.
- Topic creation can be duplicated/mismatched: manual `kafka-topics.sh` vs a `NewTopic` bean with a different partition count.

**Current (mid-2026)**: Spring for Apache Kafka 4.1.0 / 4.0.6 / 3.3.16 (kafka-clients 4.1.1). `KafkaTemplate.send` returns `CompletableFuture<SendResult<K,V>>` — use `future.whenComplete(...)`; `ListenableFuture` was removed in Spring 6. Apache Kafka 4.0 (Mar 2025) is KRaft-only; `--zookeeper` is gone, use `--bootstrap-server`. New: KIP-848 incremental rebalance (no stop-the-world) and KIP-932 "Queues for Kafka" share groups (`@ShareKafkaListener`, Preview).

## Full content

Spring for Apache Kafka layers template + annotation idioms over the raw Kafka client. The Baeldung `spring-kafka` module (spring-kafka 2.7.2 in the 2021 snapshot) teaches the full producer/consumer/listener/serde/topic surface.

### Producing

Build a `KafkaTemplate` from a `DefaultKafkaProducerFactory` configured by a `Map` of `ProducerConfig` keys (`KafkaProducerConfig.java:22-36`). `send` is asynchronous and returns a future (`ListenableFuture<SendResult>` in the 2021 era). The idiom is to attach a callback and log the committed offset (`getRecordMetadata().offset()`) on success or handle the failure branch (`KafkaApplication.java:105-119`).

### Consuming

A `ConcurrentKafkaListenerContainerFactory` is built per consumer group from a `DefaultKafkaConsumerFactory` (`KafkaConsumerConfig.java:24-64`). `@EnableKafka` activates annotation processing; `@KafkaListener(topics=, groupId=, containerFactory=, topicPartitions=@TopicPartition(...))` binds a method. Header injection via `@Header(KafkaHeaders.RECEIVED_PARTITION_ID)` + `@Payload` (`KafkaApplication.java:157-161`). Record filtering: `factory.setRecordFilterStrategy(record -> record.value().contains("World"))` (`KafkaConsumerConfig.java:67-71`).

### Partitions and consumer groups

A topic is sharded into partitions; `send(topic, partition, key, value)` targets one, and `@TopicPartition(partitions={"0","3"})` restricts consumption. A null key plus an explicit partition argument overrides the default round-robin/sticky partitioning. Consumer groups define delivery: instances of the *same* group load-balance the partitions between them; *distinct* groups each get every message (the fan-out pattern — two listeners on one topic with different `groupId`, `KafkaApplication.java:145-155`).

### Serialization

Spring Kafka's `JsonSerializer` (`KafkaProducerConfig.java:38-50`) and `JsonDeserializer` (`KafkaConsumerConfig.java:74-86`) carry POJOs. `new JsonDeserializer<>(Greeting.class)` passes the target type explicitly, which sidesteps the default trusted-packages restriction — a pitfall in real code where the restriction would otherwise reject deserialization.

### Topic declaration as beans

`KafkaAdmin` + `NewTopic(name, partitions, replicationFactor).configs(...)` beans declare topics at startup (`KafkaTopicConfig.java:34-68`). Note the Baeldung pitfall: the README also lists manual `kafka-topics.sh` creation with a mismatched partition count (README 5 vs config 6).

### Pitfalls

- Fan-out vs load-balance is purely a `groupId` choice — a duplicated `groupId` silently turns intended fan-out into load-balancing.
- `JsonDeserializer` trusted-packages restriction (above).
- Tests are sometimes brittle: a Kafka test asserts `ConsumerRecord.toString()` `containsString("embedded-test-topic")`; modules mix JUnit 4 and 5.

### 2026 currency

- **Async result type changed.** Spring for Apache Kafka 3.0+ returns `CompletableFuture<SendResult<K,V>>` from `KafkaTemplate.send` (handle via `future.whenComplete(...)`); `RequestReplyFuture` is now a `CompletableFuture`; Spring 6 removed `ListenableFuture`. [Spring Kafka — Sending Messages](https://docs.spring.io/spring-kafka/reference/kafka/sending-messages.html), [RequestReplyFuture (Spring Kafka API)](https://docs.spring.io/spring-kafka/api/org/springframework/kafka/requestreply/RequestReplyFuture.html)
- **KRaft only.** Apache Kafka 4.0 (Mar 18, 2025) removed ZooKeeper; KRaft is the sole metadata mode. There is no direct ZK→4.0 upgrade — migrate to KRaft on a 3.x release first. Manual topic commands use `--bootstrap-server`, not the removed `--zookeeper`. [Apache Kafka 4.0.0 Release Announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- **KIP-848 next-gen rebalance** (GA in Kafka 4.0): server-driven, incremental rebalancing that eliminates stop-the-world rebalances — a net-new operational concept the 2021 consumer-group material predates. [Kafka 4.0.0 announcement](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- **KIP-932 "Queues for Kafka" / share groups** (early access in 4.0): point-to-point/queue semantics on standard topics with cooperative consumption; surfaced in Spring Kafka 4.0 via `SharedConsumerContainer` + `@ShareKafkaListener` (Preview). [Spring Kafka 4.0.0 GA](https://spring.io/blog/2025/11/18/spring-kafka-4/)
- **Versions (mid-2026)**: Spring for Apache Kafka 4.1.0 / 4.0.6 / 3.3.16 (Jun 9, 2026) on kafka-clients 4.1.1; Spring Retry removed from Spring Kafka 4. Spring Boot 4 mandates Jackson 3, so `JsonSerializer`/`JsonDeserializer` need Jackson-3 awareness on that baseline. [Spring Kafka 4.0 GA](https://spring.io/blog/2025/11/18/spring-kafka-4/), [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **Not covered by the corpus (still gaps in 2026)**: Kafka Streams / Schema Registry / Avro, exactly-once transactional Kafka, rebalance listeners, Spring Cloud Stream binder, reactive (Reactor Kafka, on the 1.3.x line). [Spring Cloud Stream Kafka Streams binder](https://docs.spring.io/spring-cloud-stream-binder-kafka/docs/current/reference/html/kafka-streams.html)
