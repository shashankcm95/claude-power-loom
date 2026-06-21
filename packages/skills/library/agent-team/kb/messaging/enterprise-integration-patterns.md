---
kb_id: messaging/enterprise-integration-patterns
version: 1
tags:
  - messaging
  - eip
  - camel
  - spring-integration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-apache-camel, spring-integration, muleesb"
  - "Apache Camel | endoflife.date"
  - "Spring Integration AMQP reference (docs.spring.io/spring-integration/reference/amqp.html)"
related:
  - messaging/amqp-model
  - messaging/amqp-reliability
  - messaging/jms-classic
status: active
---

## Summary

**Concept**: The Hohpe/Woolf Enterprise Integration Patterns (router, splitter, translator, multicast/recipient-list, service activator, dead-letter channel) expressed across two DSLs — Apache Camel `RouteBuilder` and Spring Integration flows (plus a Mule-3 ESB footnote).
**Key APIs**: Camel `from/to/choice/when/split/multicast/transform/errorHandler/deadLetterChannel`, `Processor.process(Exchange)`; Spring Integration `@ServiceActivator`/`@Transformer`/`@MessagingGateway`, `IntegrationFlows`, `DirectChannel`/`QueueChannel`/`PublishSubscribeChannel`, `route`/`routeToRecipients`.
**Gotcha**: `file://dir?delete=true` deletes the source after routing (destructive); relative paths only work from the module root.
**2026-currency**: Camel 2.x→4.x (JUnit-5 test base); Spring Integration `IntegrationFlows`→`IntegrationFlow` (SI 6+); Mule 3 EOL (scopes removed, MEL→DataWeave).
**Sources**: Baeldung `spring-apache-camel` + `spring-integration` + `muleesb`; endoflife.date / spring.io 2026.

## Quick Reference

**The shared EIP vocabulary (same patterns, two DSLs)**:

| EIP | Camel (`RouteBuilder`) | Spring Integration |
|---|---|---|
| Message Translator | `transform(body().append(...))` / `Processor` | `@Transformer` |
| Content-Based Router | `choice().when(simple("${file:ext} == 'txt'")).to(...).otherwise()...` | `route(...)` + channelMapping/subFlowMapping |
| Splitter | `split(body().convertToString().tokenize("\n"))` | `.split()` |
| Multicast / Recipient List | `multicast().to("direct:append","direct:prepend")` | `routeToRecipients` + `recipient(channel, selector)` |
| Publish-Subscribe | pub-sub channel | `PublishSubscribeChannel` |
| Dead Letter Channel | `deadLetterChannel("log:dead?level=ERROR").maximumRedeliveries(3).redeliveryDelay(1000)` | DLQ |
| Service Activator | `to(bean)` | `@ServiceActivator` |

**Camel essentials**: `RouteBuilder.configure()` with `from(uri)...to(uri)`; the `file://dir?delete=true` component is the workhorse, `direct:` for in-process chaining; Camel Simple language `${body}`, `${file:ext}`, `${file:name}`. Java-config base `CamelConfiguration` overriding `routes()`; XML `<camelContext>`/`<route>` also supported. camel-jackson: `JacksonDataFormat` / `ListJacksonDataFormat(Fruit.class)` for JSON arrays.

**Spring Integration essentials** — three config styles (annotation/Java-config, XML, fluent Java DSL):
```java
IntegrationFlows.from(...).filter(...).handle(...).get();   // Pollers.fixedDelay, GenericSelector, MessageChannels.queue()
```
Channels: `DirectChannel`, `QueueChannel`, `PriorityChannel`, `PublishSubscribeChannel`. Annotations: `@EnableIntegration`, `@InboundChannelAdapter` + `@Poller`, `@ServiceActivator`, `@MessagingGateway` + `@Gateway(requestChannel=...)`. Transactional poller via `PollerMetadata.advice(transactionInterceptor())` + `ExpressionEvaluatingTransactionSynchronizationProcessor`. Channel security: `@SecuredChannel` + `ChannelSecurityInterceptor`, `SecurityContextPropagationChannelInterceptor` across threads.

**Testing**: Camel `CamelTestSupport` + `MockEndpoint` (`expectedMessageCount`, `assertMockEndpointsSatisfied()`) with `direct:`/`mock:` endpoints — the canonical Camel unit-test pattern.

**Top gotchas**:
- `file://...?delete=true` deletes the source file after routing — destructive on real data.
- Relative filesystem paths (`src/test/data/input`) only work from the module root.
- `App.main` keeping the JVM alive with `Thread.sleep(5000)` is a fragile timing harness.

**Current (mid-2026)**: Apache Camel is on the 4.x line (4.20.0, Apr 2026; 4.18 LTS / 4.14 LTS); the 3.x LTS line is past support. The modern Camel test base is JUnit-5 `org.apache.camel.test.junit5.CamelTestSupport`. Spring Integration 6+ deprecated `IntegrationFlows` (use `IntegrationFlow.from(...)`). Mule 3.9 is EOL — its variable scopes were removed in Mule 4. Consider Spring Cloud Stream's functional model for new broker-binding work.

## Full content

The corpus teaches the Hohpe/Woolf Enterprise Integration Patterns vocabulary across multiple DSLs — Apache Camel's `RouteBuilder`, Spring Integration's flows, and a Mule-3 ESB module — so the same patterns are recognizable regardless of framework.

### Apache Camel route DSL

`RouteBuilder` exposes `from/to/process/choice/when/otherwise/split/multicast/transform/setHeader/simple/errorHandler/deadLetterChannel` (`camel/file/*.java`). A `Processor.process(Exchange)` mutates the exchange (`Exchange.getIn().getBody(...)`, `setHeader(Exchange.FILE_NAME, ...)`). The `file://dir?delete=true` component is the workhorse endpoint (destructive — deletes the source after routing); `direct:` chains routes in-process. The Camel Simple language (`${body}`, `${file:ext}`, `${file:name}`) drives predicates and expressions. camel-jackson adds `JacksonDataFormat` and `ListJacksonDataFormat(Fruit.class)` (a JSON array → `List<Fruit>`).

The canonical Camel **Dead Letter Channel** mirrors AMQP's DLX: `errorHandler(deadLetterChannel("log:dead?level=ERROR").maximumRedeliveries(3).redeliveryDelay(1000)...)` (cross-reference `messaging/amqp-reliability`).

### Spring Integration

Three configuration styles coexist: annotation/Java-config, XML (`spring-integration-context.xml`), and the fluent Java DSL (`IntegrationFlows.from(...).filter(...).handle(...).get()` with `Pollers.fixedDelay`/`fixedRate`, `GenericSelector`, `MessageChannels.queue()`, `.bridge(...)`). Channel impls: `DirectChannel`, `QueueChannel`, `PriorityChannel`, `PublishSubscribeChannel`. The EIP pattern set is expressed via `route` + subFlowMapping, `routeToRecipients`, `discardFlow`, `publishSubscribeChannel`, and gateway-bounded subflows (`subflows/*`, one technique per class solving the same "classify n mod 3" problem). Gateways: `@MessagingGateway` + `@Gateway(requestChannel=...)` are the typed entry point.

Spring Integration adds two concerns Camel does not emphasize here:

- **Transactional pollers**: a `PollerMetadata` with `.advice(transactionInterceptor())` so each poll runs in a transaction; SpEL-driven transaction synchronization (`after-commit`/`after-rollback` rename a file to `.PASSED`/`.FAILED`) via `ExpressionEvaluatingTransactionSynchronizationProcessor` + `DefaultTransactionSynchronizationFactory`; embedded H2 + `DataSourceTransactionManager` (`tx/TxIntegrationConfig.java`).
- **Channel security**: `@SecuredChannel(interceptor=..., sendAccess={"ROLE_VIEWER","jane"})` + `ChannelSecurityInterceptor` wired with `AuthenticationManager` + `AccessDecisionManager`; method-level `@PreAuthorize("hasRole(...)")`; a custom `UsernameAccessDecisionVoter` combined with `RoleVoter` in an `AffirmativeBased` manager; `SecurityContextPropagationChannelInterceptor` (a `@GlobalChannelInterceptor`) keeps the `SecurityContext` on worker threads behind a pub/sub channel.

### Mule ESB (Mule 3)

The `muleesb` module is config-first XML: `<flow>` pipelines of message processors, with the central (now-obsolete) concept being the four **variable scopes** — flow vars / session vars / inbound + outbound properties. VM transport bridges flows in-memory; MEL drives expressions; custom `Transformer`/`Callable` Java extension points; MUnit (`mock:when`/`munit:assert-on-equals`) tests. An outbound property set in one flow becomes an inbound property only after crossing the VM endpoint into the next flow — a subtle, transport-dependent transition.

### Pitfalls

- `file://...?delete=true` is destructive; relative paths only resolve from the module root.
- `Thread.sleep(5000)` JVM-keep-alive is a fragile timing harness.
- Mule `InitializationTransformer` swallows exceptions + uses `System.out.println` — tutorial-grade.

### 2026 currency

- **Apache Camel 2.x → 4.x.** The entire Camel 3.x LTS line (3.20/3.21/3.22) is past its support window by 2026; current is the 4.x line (4.20.0, Apr 23, 2026; 4.18 LTS until Feb 17, 2027; 4.14 LTS until Aug 20, 2026; Java 17/21/25). Camel 3+ split `camel-core` into per-component artifacts and moved the test base to JUnit 5 (`org.apache.camel.test.junit5.CamelTestSupport` — the `junit4` base shown is obsolete). The route DSL + Simple language are conceptually stable; `ListJacksonDataFormat`/`JacksonDataFormat` still exist. [Apache Camel | endoflife.date](https://endoflife.date/apache-camel)
- **Spring Integration `IntegrationFlows` → `IntegrationFlow`.** SI 6 deprecated `IntegrationFlows` (the static factory methods moved onto `IntegrationFlow`), carried forward in the SI 7.x line (7.0 in the Nov 2025 Spring wave). `@EnableGlobalMethodSecurity`/`GlobalMethodSecurityConfiguration` → `@EnableMethodSecurity` (Spring Security 6). [Spring Integration AMQP reference](https://docs.spring.io/spring-integration/reference/amqp.html), [Spring Boot 4.1.0 M3 notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.1.0-M3-Release-Notes)
- **Mule 3.9 EOL → Mule 4.** Mule 4 (runtime 4.9.0, Feb 2025) replaced the four scopes with a unified `vars` + `payload`/`attributes` model; MEL is replaced by DataWeave 2.0. The `muleesb` module's core lesson (the scopes) is obsolete. [Intro to Mule 4: Mule Message](https://docs.mulesoft.com/mule-runtime/4.3/intro-mule-message), [Migrating MEL to DataWeave](https://docs.mulesoft.com/mule-runtime/4.3/migration-mel)
- **Spring Cloud Stream functional model** (`Supplier`/`Function`/`Consumer` beans auto-bound to broker destinations) is the standard binder programming model since 3.x; `@StreamListener`/`@EnableBinding` are deprecated/removed — the modern integration-glue layer over the brokers in this set. [Spring Cloud Stream — Programming Model](https://docs.spring.io/spring-cloud-stream/reference/kafka/kafka-streams-binder/programming-model.html)
- The EIP vocabulary itself — router, splitter, translator, multicast/recipient-list, dead-letter channel, service activator — is fully current; only the DSL syntax and framework versions moved.
