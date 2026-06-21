---
kb_id: messaging/amqp-model
version: 1
tags:
  - messaging
  - amqp
  - rabbitmq
  - routing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-amqp, rabbitmq"
  - "Spring AMQP 4.0.0 Available (spring.io/blog/2025/11/19)"
  - "RabbitMQ | endoflife.date"
related:
  - messaging/amqp-reliability
  - messaging/jms-classic
  - messaging/enterprise-integration-patterns
status: active
---

## Summary

**Concept**: AMQP 0-9-1 routing model — producers publish to *exchanges*, exchanges route to *queues* via *bindings* + routing keys. Taught via Spring AMQP (rich) and the native RabbitMQ client (no Spring).
**Key APIs**: `RabbitTemplate.convertAndSend`, `@RabbitListener`/`@EnableRabbit`, `Queue`/`DirectExchange`/`FanoutExchange`/`TopicExchange`/`Binding`/`BindingBuilder`/`Declarables`; native `Channel.queueDeclare`/`exchangeDeclare`/`queueBind`/`basicPublish`/`basicConsume`.
**Gotcha**: exchange type determines routing — direct (exact key), fanout (broadcast, key ignored), topic (`*`=one word, `#`=zero+ words); the nameless `""` exchange binds every queue by its name.
**2026-currency**: Spring AMQP 4.0 (Java 17+) keeps classic APIs; RabbitMQ 4.0 added native AMQP 1.0 and replaced mirrored queues with quorum queues.
**Sources**: Baeldung `spring-amqp` + `rabbitmq` modules; spring.io / endoflife.date 2026.

## Quick Reference

**Exchange types** (the heart of AMQP routing):

| Type | Routing rule |
|---|---|
| direct | routing-key exact match |
| fanout | broadcast to all bound queues, routing key ignored |
| topic | pattern routing — `*` = exactly one word, `#` = zero or more words (`*.important.*`, `#.error`) |
| default/nameless (`""`) | implicitly binds every queue by its own name |

**Bindings** wire a queue to an exchange with a routing key. **Alternate exchange** (`alternate-exchange` arg) catches unroutable messages.

**Spring AMQP idiom**:
```java
rabbitTemplate.convertAndSend(exchange, routingKey, payload);   // + optional post-processor lambda

@RabbitListener(queues = "myQueue", containerFactory = "...", ackMode = "MANUAL")
public void handle(MyEvent e) { ... }
```
Declare topology as beans: `BindingBuilder.bind(queue).to(exchange).with(pattern)`; register a group via `Declarables`. Classes: `org.springframework.amqp.core.{Queue, QueueBuilder, DirectExchange, FanoutExchange, TopicExchange, Binding, BindingBuilder, Declarables}`; `@EnableRabbit`.

**Native RabbitMQ client (no Spring)**:
```java
Connection c = factory.newConnection();
Channel ch = c.createChannel();
ch.queueDeclare(name, durable, exclusive, autoDelete, argsMap);
ch.exchangeDeclare(name, BuiltinExchangeType.DIRECT, durable, autoDelete, argsMap);
ch.queueBind(queue, exchange, routingKey);
ch.basicPublish(exchange, routingKey, props, body);
ch.basicConsume(queue, autoAck, consumer);   // consume via DefaultConsumer.handleDelivery(...)
```
Queue args map carries `x-message-ttl`, `x-max-priority`, `alternate-exchange`.

**Top gotchas**:
- Native auto-ack (`basicConsume(..., true, ...)`) removes the message *before* processing — a crash loses it. (See `messaging/amqp-reliability`.)
- `spring.main.allow-bean-definition-overriding=true` is needed when conditional configs declare same-named beans.

**Current (mid-2026)**: Spring AMQP 4.0.0 (Nov 2025, Spring Framework 7, Java 17+) retains `RabbitTemplate`/`@RabbitListener`/`QueueBuilder`/`Declarables`/DLX APIs; a new `spring-rabbitmq-client` module targets AMQP 1.0. RabbitMQ server 4.x added native AMQP 1.0 and replaced classic mirrored queues with Raft-based quorum queues. Native Java client 5.31.0 prefers the `DeliverCallback`/`CancelCallback` lambda style over `DefaultConsumer`.

## Full content

AMQP 0-9-1 separates producers from queues with an *exchange* indirection: a producer never names a queue, it publishes to an exchange with a routing key; the exchange's type + the bindings decide which queues receive the message. This is the conceptual contrast with Kafka (topic/partition log) and JMS (named destination). The Baeldung corpus teaches it twice — richly through Spring AMQP (`spring-amqp`, the deepest single module) and from first principles through the native client (`rabbitmq`).

### Routing model

- **direct** — routing-key exact match.
- **fanout** — broadcast to every bound queue; routing key ignored.
- **topic** — pattern routing: `*` matches exactly one word, `#` matches zero or more words (`*.important.*`, `#.error`).
- The **default/nameless exchange** (`""`) implicitly binds every queue by its own name — publishing with `routingKey = queueName` reaches that queue.
- **Alternate exchange** (`alternate-exchange` queue/exchange arg) forwards unroutable messages to a fallback.

### Spring AMQP

`RabbitTemplate.convertAndSend(exchange, routingKey, payload)` (a POJO is converted by a message converter; an optional post-processor lambda mutates the message). Listeners are annotation-driven: `@RabbitListener(queues=, containerFactory=, ackMode="MANUAL")` + `@EnableRabbit`. Topology is declared as Spring beans via the fluent `BindingBuilder.bind(queue).to(exchange).with(pattern)` and grouped with `Declarables` (`broadcast/BroadcastConfig.java`). Per-queue arguments — `x-message-ttl`, `x-max-priority` — are passed as a `Map<String,Object>` through `QueueBuilder`.

A wiring gotcha: the `spring-amqp` module's strategy-by-property configs declare same-named beans selected at runtime, so it needs `spring.main.allow-bean-definition-overriding=true`.

### Native RabbitMQ client

The no-Spring path exposes the protocol directly: `ConnectionFactory.newConnection()` → `Connection.createChannel()` → a `Channel` on which you `queueDeclare`/`exchangeDeclare(name, BuiltinExchangeType.DIRECT, ...)`/`queueBind`/`basicPublish(exchange, routingKey, BasicProperties, body)`/`basicConsume(queue, autoAck, consumer)`. Consumption is via `DefaultConsumer.handleDelivery(consumerTag, Envelope, BasicProperties, body)`. The same args map carries `x-message-ttl`, `x-max-priority`, `alternate-exchange` (`setup/Setup.java`, `producer/Publisher.java`, `consumer/Receiver.java`).

### Pitfalls

- Native auto-ack loses messages on failure (covered in `messaging/amqp-reliability`).
- Bean-definition-overriding flag (above).
- The corpus has *no* publisher confirms/returns, *no* clustering/HA/quorum queues, and only AMQP 0-9-1 (no AMQP 1.0).

### 2026 currency

- **Spring AMQP 3 (Java 17+) → Spring AMQP 4.0** (Nov 19, 2025, on Spring Framework 7). Package names stay `org.springframework.amqp.*`; classic `RabbitTemplate` / `@RabbitListener` / `QueueBuilder` / `Declarables` / DLX APIs remain valid. A new `spring-rabbitmq-client` module targets AMQP 1.0 (on `com.rabbitmq.client:amqp-client`, RabbitMQ-only). [Spring AMQP 4.0.0 Available](https://spring.io/blog/2025/11/19/spring-amqp-4-0-0-available/)
- **RabbitMQ 4.0**: classic mirrored queues removed (deprecated since 3.9); Raft-based quorum queues are now the HA answer, and native AMQP 1.0 was added. [RabbitMQ | endoflife.date](https://endoflife.date/rabbitmq), [RabbitMQ 4.0 quorum queue features](https://www.rabbitmq.com/blog/2024/08/28/quorum-queues-in-4.0), [Native AMQP 1.0 / migrating to quorum queues](https://www.rabbitmq.com/blog/2025/07/29/latest-benefits-of-rmq-and-migrating-to-qq-along-the-way)
- **Server support window**: RabbitMQ server 4.3.x current; 4.2 support ends Jul 31, 2026; 4.1 EOL Jan 30, 2026 (new CVEs on 4.1 are permanently unpatched — run a supported line). [RabbitMQ | endoflife.date](https://endoflife.date/rabbitmq)
- **Native Java client (0-9-1) 5.31.0** (JDK 8+) prefers `basicConsume` with `DeliverCallback`/`CancelCallback` lambdas over the `DefaultConsumer` subclass shown in 2021. [rabbitmq-java-client releases](https://github.com/rabbitmq/rabbitmq-java-client/releases)
- **Jackson 3 churn** on the Spring Boot 4 baseline affects the AMQP message converter. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
