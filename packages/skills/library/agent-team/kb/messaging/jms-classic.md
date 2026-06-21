---
kb_id: messaging/jms-classic
version: 1
tags:
  - messaging
  - jms
  - jakarta
  - activemq
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-jms"
  - "The Evolution of JMS to Jakarta Messaging (medium.com/@kaustubh.saha)"
  - "Apache ActiveMQ Classic | endoflife.date"
related:
  - messaging/amqp-model
  - messaging/enterprise-integration-patterns
status: active
---

## Summary

**Concept**: Classic Spring JMS — the *old-school* XML + raw `MessageListener` + `DefaultMessageListenerContainer` idiom over ActiveMQ 5.x "Classic" (no Spring Boot, no `@JmsListener`).
**Key APIs**: `JmsTemplate.send`/`convertAndSend`/`receiveAndConvert`; `javax.jms.MessageListener.onMessage(Message)` MDP; custom `MessageConverter` (Object ↔ `MapMessage`); `DefaultMessageListenerContainer` + `SingleConnectionFactory`/`CachingConnectionFactory`.
**Gotcha**: `receiveAndConvert()` blocks indefinitely with no receive timeout; `onMessage` silently ignores non-`TextMessage` bodies; two consumers on one point-to-point queue compete (exactly one gets each message).
**2026-currency**: THE gating migration is `javax.jms.* → jakarta.jms.*` (Spring Boot 3/4 require it); CVE-2023-46604 OpenWire RCE on unpatched ActiveMQ Classic 5.x.
**Sources**: Baeldung `spring-jms` module; Jakarta Messaging migration + endoflife.date 2026.

## Quick Reference

**This is the legacy idiom** — XML bean config + a raw `MessageListener` wired into a container bean. The corpus teaches NO modern annotation-driven JMS (`@JmsListener`/`@EnableJms`/Spring Boot auto-config).

**Sending**:
```java
jmsTemplate.send(queue, messageCreator);   // low-level
jmsTemplate.convertAndSend(employee);      // POJO via a MessageConverter
Object o = jmsTemplate.receiveAndConvert(); // SYNCHRONOUS, blocks if no timeout
```

**Receiving (Message-Driven POJO)**: a plain class implements `javax.jms.MessageListener.onMessage(Message)`, wired into a `DefaultMessageListenerContainer` (connectionFactory + destinationName + messageListener + errorHandler) for async receipt. Guard with `instanceof TextMessage` before casting (`TextMessage.getText()`; `MapMessage.setString`/`getInt`).

**Custom conversion**: implement `org.springframework.jms.support.converter.MessageConverter` (`toMessage`/`fromMessage`, Object ↔ `MapMessage`) and register it on the `JmsTemplate` so `convertAndSend`/`receiveAndConvert` use it transparently.

**Connection factories**: `SingleConnectionFactory` (one shared connection) vs `CachingConnectionFactory` (session pooling for concurrent consumers); wrap `ActiveMQConnectionFactory` + `ActiveMQQueue`. Custom `ErrorHandler.handleError(Throwable)` plugged into the container fires ONLY on thrown exceptions.

**Top gotchas**:
- `receiveAndConvert()` blocks indefinitely if no message and no receive timeout is set.
- `onMessage` silently ignores non-`TextMessage` bodies — the error handler only fires on thrown exceptions, not silently-dropped bodies.
- Two consumers on one point-to-point queue compete: the Baeldung module runs a `DefaultMessageListenerContainer` AND `JmsTemplate.receiveAndConvert()` on the same `IN_QUEUE`, so exactly one gets each message.
- A weak test (`testSimpleSend`) only checks "doesn't throw" — no assertion the listener received anything.

**Current (mid-2026)**: the single biggest migration concern. `javax.jms.*` (JMS 2.0) → `jakarta.jms.*` (Jakarta Messaging 3.x); Spring Boot 3 (late 2022) and Boot 4 require the Jakarta namespace; Tomcat 10+/WildFly 27+ run Jakarta 3.1 and cannot run a JMS-2.0-compiled library without bytecode transformation. ActiveMQ Classic 6.x is current; prefer ActiveMQ Artemis for new projects.

## Full content

The Baeldung `spring-jms` module (Spring 4.3.4, ActiveMQ 5.14.1 "Classic") teaches JMS through its oldest idiom: XML bean wiring, a raw `MessageListener`, and a container bean — explicitly NOT the modern `@JmsListener`/`@EnableJms`/Spring Boot auto-config approach (which appears nowhere in the corpus).

### Templates and synchronous receive

`JmsTemplate.send(Queue, MessageCreator)` is the low-level send; `convertAndSend(Object)` runs a POJO through a `MessageConverter`; `receiveAndConvert()` is a *synchronous, blocking* receive (`SampleJmsMessageSender.java:23,27,31`). The blocking receive contrasts with the async MDP path below.

### Message-Driven POJO (MDP)

A plain class implements `javax.jms.MessageListener.onMessage(Message)` and is wired into a `DefaultMessageListenerContainer` for asynchronous receipt (`SampleListener.java:25-37`). Always guard with `instanceof TextMessage` before casting — `onMessage` *silently ignores* a body it does not recognize, and the container's `ErrorHandler` only fires on thrown exceptions, not on silently-dropped bodies.

### Message conversion

JMS message types: `TextMessage` (`getText()`), `MapMessage` (`setString`/`getInt`/...). A custom `org.springframework.jms.support.converter.MessageConverter` does bidirectional Object ↔ `MapMessage` (`toMessage`/`fromMessage`), registered on the `JmsTemplate` so `convertAndSend`/`receiveAndConvert` use it transparently (`SampleMessageConverter.java:13-24`).

### Wiring and connections

Full XML wiring: `JmsTemplate` (template 7-11), a `SingleConnectionFactory` wrapping `ActiveMQConnectionFactory` (13-20), a `DefaultMessageListenerContainer` (42-47) — `applicationContext.xml`. An embedded broker via the `amq:broker` namespace (`EmbeddedActiveMQ.xml:12-17`). `SingleConnectionFactory` shares one connection (no session pooling); use `CachingConnectionFactory` for concurrent consumers.

### Pitfalls

- `receiveAndConvert()` blocks indefinitely with no timeout.
- Competing consumers on one point-to-point queue: the module runs both an async MDP container and a blocking `receiveAndConvert()` on `IN_QUEUE` — exactly one receives each message.
- Vestigial style: XML bean config, `war` packaging with an empty webapp, `MonitoringUtil` mixing `java.util.Date` with `java.time`. The whole idiom is superseded by Boot auto-config + `@EnableJms`/`@JmsListener`.
- Gaps: no JMS topics / pub-sub (only the point-to-point queue), no JMS transactions, no durable subscriptions.

### 2026 currency

- **`javax.jms.* → jakarta.jms.*` is THE gating migration.** JMS 2.0 became Jakarta Messaging 3.x; every enterprise import moved namespace (`javax.jms.Connection` → `jakarta.jms.Connection`). Spring Boot 3 (late 2022) and Spring Boot 4 require the Jakarta namespace; Tomcat 10+/WildFly 27+ run Jakarta 3.1, and a JMS-2.0-compiled library cannot run there without bytecode transformation (Eclipse Transformer / OpenRewrite). Do NOT seed `javax.jms` import paths into a 2026 KB without flagging the rename. [The Evolution of JMS to Jakarta Messaging](https://medium.com/@kaustubh.saha/the-evolution-of-java-message-service-jms-from-boilerplate-to-modern-jakarta-messaging-36b37dce77ed)
- **ActiveMQ Classic 5.x → Artemis for new projects.** Both still ship — ActiveMQ Classic 6.x is current (the message servlet is disabled by default for hardening) and Artemis 2.53.0 (Mar 2026) is the next-gen broker — but the "prefer Artemis" guidance holds. [Apache ActiveMQ Classic | endoflife.date](https://endoflife.date/apache-activemq), [Apache ActiveMQ Artemis | endoflife.date](https://endoflife.date/apache-activemq-artemis)
- **CVE-2023-46604 — ActiveMQ OpenWire RCE.** Unbounded deserialization in the Java OpenWire marshaller (TCP 61616), actively exploited (Kinsing; HelloKitty/TellYouThePass ransomware). Fixed in 5.15.16 / 5.16.7 / 5.17.6 / 5.18.3+ (Oct 2023); any ActiveMQ Classic 5.x below those patch levels is vulnerable. (CVSS 9.8 per the NVD rating.) [ActiveMQ — Update on CVE-2023-46604](https://activemq.apache.org/news/cve-2023-46604), [NVD CVE-2023-46604](https://nvd.nist.gov/vuln/detail/CVE-2023-46604)
- **Modern idiom**: Spring Boot auto-config + `@EnableJms` + `@JmsListener` (none of which appear in the corpus) is the current approach; the conceptual publish/subscribe + point-to-point model carries forward unchanged.
