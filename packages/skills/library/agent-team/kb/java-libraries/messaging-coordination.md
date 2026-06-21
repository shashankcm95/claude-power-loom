---
kb_id: java-libraries/messaging-coordination
version: 1
tags:
  - java-libraries
  - messaging
  - distributed-coordination
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-libraries (pulsar/zookeeper/curator/geode), hazelcast, atomix, libraries-6 (kafka-tx), libraries-server (mqtt/smack)"
  - "Hazelcast 5.x (Jet merged into core via HazelcastInstance.getJet())"
related:
  - java-libraries/web-rpc-serialization
  - java-libraries/in-process-caching
status: active
---

## Summary

**Concept**: Java messaging + distributed-coordination libraries — Apache Pulsar (pub/sub), ZooKeeper (raw) + Curator (high-level coordination), Hazelcast (IMDG + Jet pipelines), Atomix (Raft), MQTT/NATS/XMPP clients, and the Kafka exactly-once transactional loop.
**Key APIs**: `PulsarClient.builder().serviceUrl(..)`; `new ZooKeeper(host,timeout,watcher)`; `CuratorFrameworkFactory.newClient` + recipes (`LeaderSelector`, `InterProcessSemaphoreMutex`, `SharedCount`); `Hazelcast.newHazelcastInstance()` + `IMap`; Kafka `initTransactions`/`beginTransaction`/`sendOffsetsToTransaction`/`commitTransaction`.
**Gotcha**: ZooKeeper `OPEN_ACL_UNSAFE` is world-writable (demo only); Pulsar's `MessageBuilder.create()` is replaced by `producer.newMessage().value(..).send()`; Atomix 1.x → 3.x is a total rewrite (no API survives); Kafka exactly-once needs idempotent producer + `read_committed` consumer isolation.
**2026-currency**: Hazelcast 5.x merged Jet into core (`getJet()`); Atomix 1.x dead; Curator is the recommended layer over raw ZK.
**Sources**: Baeldung `apache-libraries`/`hazelcast`/`atomix`/`libraries-6`/`libraries-server` modules.

## Quick Reference

**Apache Pulsar (pub/sub):**

```java
PulsarClient client = PulsarClient.builder().serviceUrl("pulsar://localhost:6650").build();
producer.compressionType(CompressionType.LZ4);
// modern send: producer.newMessage().value(..).send();
consumer.subscriptionType(SubscriptionType.Shared);  // Exclusive/Shared/Failover
consumer.receive(); consumer.acknowledge(msg);
```

**ZooKeeper (raw) → Curator (recommended high-level layer):**

```java
new ZooKeeper(host, timeout, watcher);   // Watcher.process awaits SyncConnected via CountDownLatch
// Curator:
CuratorFramework cf = CuratorFrameworkFactory.newClient(conn, new RetryNTimes(..));
// recipes: LeaderSelector, InterProcessSemaphoreMutex, SharedCount
// AsyncCuratorFramework for CompletableFuture-style
```
`OPEN_ACL_UNSAFE` = world-writable (demo only).

**Hazelcast (IMDG + Jet):**

```java
HazelcastInstance h = Hazelcast.newHazelcastInstance();  // auto-forms cluster
IMap<K,V> map = h.getMap("m");  FlakeIdGenerator id = h.getFlakeIdGenerator("g");
// native client: HazelcastClient.newHazelcastClient(new ClientConfig().setClusterName("dev"))
// Jet pipeline: readFrom → flatMap → filter → groupingKey → aggregate → writeTo
```

**Kafka exactly-once (consume-process-produce atomic loop):**

```java
producer.initTransactions();
// per batch:
producer.beginTransaction();
// produce ...
producer.sendOffsetsToTransaction(offsets, groupId);
producer.commitTransaction();   // or abortTransaction()
// consumer: isolation.level = read_committed
```

**Other clients:** MQTT (Eclipse Paho `MqttClient` + QoS/retained/`MqttConnectOptions`); NATS (`Nats.connect`); XMPP Smack (`XMPPTCPConnection`/`ChatManager`); Atomix (Raft — `AtomixReplica`, `CompletableFuture`-everywhere).

**Current (mid-2026):** Hazelcast **5.x** merged Jet into core (`HazelcastInstance.getJet()`); **Jet 4.2 was a separate artifact**. Atomix **1.x is dead** (3.x total rewrite, no API survives). Curator is the recommended layer over raw ZK.

## Full content

This atom groups the libraries that move messages between processes and coordinate distributed nodes. **Apache Pulsar** is a pub/sub messaging system: a `PulsarClient` (built with `serviceUrl("pulsar://...")`) creates producers (configurable `compressionType`, e.g. `LZ4`) and consumers with one of three `subscriptionType`s (Exclusive/Shared/Failover), using `receive()`/`acknowledge()`. The 2.1-era `MessageBuilder.create()` shown in the base is replaced by the fluent `producer.newMessage().value(..).send()` in modern Pulsar.

For coordination, the corpus teaches **ZooKeeper** at two levels. The raw client (`new ZooKeeper(host, timeout, watcher)`) requires manually awaiting `SyncConnected` in the `Watcher.process` callback via a `CountDownLatch`, then doing versioned znode CRUD; the demo `OPEN_ACL_UNSAFE` ACL is world-writable and never appropriate for production. **Apache Curator** is the recommended high-level layer: `CuratorFrameworkFactory.newClient` with a retry policy, an `AsyncCuratorFramework` for CompletableFuture-style usage, and battle-tested recipes (`LeaderSelector`, `InterProcessSemaphoreMutex`, `SharedCount`) plus a modeled API (`ModelSpec`/`ModeledFramework` with a Jackson serializer).

**Hazelcast** is an in-memory data grid: an embedded member (`Hazelcast.newHazelcastInstance()`) auto-discovers peers and forms a cluster, exposing distributed structures like `IMap` and `FlakeIdGenerator`; a native client connects via `HazelcastClient.newHazelcastClient`. Hazelcast Jet adds data-pipeline processing (`readFrom` → `flatMap` → `filter` → `groupingKey` → `aggregate` → `writeTo`). **Atomix** is Raft-based coordination, but its 1.x API (`AtomixReplica`, distributed Map/Lock) is entirely obsolete — 3.x is a total rewrite. The **Kafka exactly-once** loop is the standout correctness pattern: a transactional producer (`initTransactions`, then per-batch `beginTransaction` → produce → `sendOffsetsToTransaction` → `commitTransaction`/`abortTransaction`) combined with an idempotent producer and a `read_committed` consumer isolation level is the only way to get an atomic consume-process-produce cycle. The lightweight clients (Eclipse Paho MQTT with QoS/retained/auto-reconnect, NATS, XMPP Smack) round out the messaging surface.

### 2026 currency

- **Hazelcast 5.x merged Jet into core** — `HazelcastInstance.getJet()` replaces the separate **Jet 4.2 artifact** the base used. [Hazelcast 5.x docs]
- **Atomix 1.x is dead**: 3.x is a total rewrite and *none* of the 1.0-rc9 API survives — do not seed Atomix coordination code from the base. The base's abandoned-library finding holds.
- **Curator** remains the recommended layer over the raw ZooKeeper client; the recipe set (`LeaderSelector`, locks, `SharedCount`) is current.
- The MQTT `iot.eclipse.org` broker the base targets has been decommissioned — point examples at a current broker. Pulsar, Curator, and the Kafka transactional API carry forward at concept level (bump pins).
