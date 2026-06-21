---
kb_id: messaging/jgroups-group-messaging
version: 1
tags:
  - messaging
  - jgroups
  - group-communication
  - reliability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jgroups"
  - "org.jgroups:jgroups — Maven Central (central.sonatype.com)"
  - "Virtual Threads / JEP 491 — Java Code Geeks (javacodegeeks.com 2026/05)"
related:
  - messaging/kafka-spring
status: active
---

## Summary

**Concept**: JGroups — reliable peer-to-peer group communication with NO broker; cluster membership + reliable/ordered delivery configured entirely by a protocol stack.
**Key APIs**: `JChannel("udp.xml")` (`connect`/`send`/`getState`/`view`/`close`); `ReceiverAdapter` overriding `viewAccepted(View)`/`receive(Message)`/`getState`/`setState`; broadcast (`null` dest) vs unicast (specific `Address`); `Message(dest, payload)`.
**Reliability**: stack protocols `NAKACK2` (reliable multicast), `UNICAST3` (reliable unicast), `STABLE`, `GMS` (membership), `FD_SOCK`/`FD_ALL`/`VERIFY_SUSPECT` (failure detection), `MERGE3`.
**Security/2026-currency**: untrusted Java deserialization in `receive`/state-transfer is an RCE class; JGroups 4.x → 5.x (`Receiver` default methods replace `ReceiverAdapter`; `Message` is now an interface).
**Sources**: Baeldung `jgroups` module; Maven Central + JEP 491 (2026).

## Quick Reference

**No broker** — peers form a cluster and exchange messages directly; reliability and ordering are properties of the protocol stack (`udp.xml`), not a central server.

**Channel lifecycle**:
```java
JChannel ch = new JChannel("udp.xml");
ch.name("nodeA").setReceiver(this).setDiscardOwnMessages(true);
ch.connect("cluster-name");
ch.getState(null, 0);          // late joiner pulls shared state
ch.send(new Message(dest, payload));  // dest == null → broadcast; specific Address → unicast
ch.view();                     // current membership
ch.close();
```

**Receiver** (`ReceiverAdapter`): override `viewAccepted(View)` (membership-change callback; `View.newMembers`/`leftMembers`), `receive(Message)`, and `getState(OutputStream)`/`setState(InputStream)` for state transfer.

**Reliability protocols** in the stack (the actual delivery guarantees live here, not in app code):

| Protocol | Role |
|---|---|
| NAKACK2 | reliable, ordered multicast (NAK-based retransmission) |
| UNICAST3 | reliable unicast |
| STABLE | garbage-collects stable (acked-by-all) messages |
| GMS | group membership service (join/leave/merge) |
| FD_SOCK / FD_ALL / VERIFY_SUSPECT | failure detection + suspicion verification |
| MERGE3 | heals a network partition (cluster merge) |

**Top gotchas**:
- `receive` deserializes arbitrary objects via `Util.objectFromStream` — a real-world RCE risk (untrusted Java deserialization).
- UDP multicast transport requires multicast on the network — frequently blocked on cloud/containers; needs a TCP + TCPPING stack instead.
- `messageCount` is mutated from the channel thread without synchronization (the code itself admits "should be synchronized!").
- Relative config path (`"src/main/resources/udp.xml"`) only works from the module root.

**Current (mid-2026)**: JGroups 5.5.5.Final. The `Receiver` interface's default methods replace the deprecated `ReceiverAdapter`; in 5.x `Message` is an interface with factory methods — the 4.x `new Message(dest, payload)` constructor is gone. Java-serialization state transfer is discouraged. JEP 491 (JDK 24/25) fixed virtual-thread pinning on `synchronized`, relevant to broker-client-style code that synchronizes around I/O.

## Full content

JGroups is the outlier in this domain: there is no broker. Peers join a named cluster and communicate directly; every reliability and ordering guarantee is supplied by a configurable protocol stack. The Baeldung `jgroups` module (jgroups 4.0.10.Final) teaches the membership + reliable-delivery model through one messenger class (`JGroupsMessenger.java`) and a `udp.xml` stack.

### Channel + membership

A `JChannel("udp.xml")` is named, given a receiver, told to discard its own messages, and connected to a cluster. `view()` reports current membership; the receiver's `viewAccepted(View)` fires on every membership change, exposing `View.newMembers` / `leftMembers`. Sending with a `null` destination broadcasts to the whole cluster; a specific `Address` unicasts.

### State transfer

A late joiner pulls the shared cluster state with `channel.getState(null, 0)`; the state-holding peers implement `getState(OutputStream)` / `setState(InputStream)`. The Baeldung example uses Java serialization for state — which is exactly the security pitfall below.

### Reliability via the protocol stack

The delivery guarantees are NOT in the application code — they are layered protocols in `udp.xml`: `NAKACK2` (reliable ordered multicast), `UNICAST3` (reliable unicast), `STABLE` (stability/GC of acked messages), `GMS` (membership), the `FD_SOCK`/`FD_ALL`/`VERIFY_SUSPECT` failure-detection trio, and `MERGE3` (partition healing). Swapping the transport (UDP→TCP) or detectors is a config change, not a code change.

### Pitfalls

- **Untrusted Java deserialization** in `receive` (`Util.objectFromStream`) is a real RCE risk — a design-level Java-deserialization RCE *class*, not a single patched CVE. Mitigate by never deserializing untrusted state-transfer/receive streams.
- **UDP multicast** is frequently blocked on cloud/containers; a TCP + TCPPING stack is the portable alternative.
- **Unsynchronized mutation**: `messageCount` is touched from the channel thread without synchronization (the code admits it).
- **Relative config path** only resolves from the module root.

### 2026 currency

- **JGroups 4.x → 5.x** (current 5.5.5.Final). The `Receiver` interface's default methods replace the deprecated `ReceiverAdapter`; in 5.x `Message` is an interface with factory methods, so the 4.x `new Message(dest, payload)` constructor is gone. Java-serialization state transfer is discouraged (security + portability). [org.jgroups:jgroups — Maven Central](https://central.sonatype.com/artifact/org.jgroups/jgroups)
- **Untrusted-deserialization RCE class** remains real in 2026 — JGroups 5 discourages Java-serialization state transfer; mitigate by avoiding `Util.objectFromStream` on untrusted streams. This is a design-level class, not one patched CVE.
- **Virtual threads (JEP 444, GA Java 21) + JEP 491 (JDK 24, Mar 2025, into Java 25 LTS)** fixed virtual-thread pinning on `synchronized` blocks, so a virtual thread can now unmount during blocking I/O inside `synchronized` — removing the main footgun for any group/broker-client code that synchronizes around I/O (directly relevant to the unsynchronized-counter and per-thread send patterns here). [Virtual Threads / JEP 491 — Java Code Geeks](https://www.javacodegeeks.com/2026/05/virtual-threads-two-years-in-production-war-stories-the-pinning-edge-cases-and-what-jdk-25-fixed.html)
- The membership/reliable-group-delivery concepts carry forward unchanged; the churn is the 4.x→5.x API rename and the (unchanged) deserialization-security caveat.
