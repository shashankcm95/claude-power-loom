---
kb_id: spring-core/websocket-soap
version: 1
tags:
  - spring-core
  - websocket
  - soap
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-websockets / spring-soap / spring-remoting"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/spring-mvc-web-tier
status: active
---

## Summary

**Concept**: Spring's non-REST web protocols — STOMP-over-WebSocket messaging, contract-first SOAP (Spring-WS), and the now-removed Spring Remoting.
**Key APIs**: `@EnableWebSocketMessageBroker` + `@MessageMapping`/`@SendTo`/`@SendToUser`; Spring-WS `@Endpoint`/`@PayloadRoot` + `Jaxb2Marshaller`; Remoting `*ServiceExporter`/`*ProxyFactoryBean`.
**Gotcha**: `@SendToUser` needs a `Principal` from a custom `DefaultHandshakeHandler`, and the client subscribes `/user/...` even though the server names `/queue/...`.
**2026-currency**: WebSocket/STOMP and Spring-WS carry to Spring 6/7 (`javax → jakarta`); Spring Remoting was REMOVED in Spring 6 (serialization RCE).
**Sources**: Baeldung `spring-websockets`/`spring-soap`/`spring-remoting`; Spring Framework wiki.

## Quick Reference

**WebSockets (STOMP)**:
- `@EnableWebSocketMessageBroker` + a `WebSocketMessageBrokerConfigurer`.
- `enableSimpleBroker("/topic")` + `setApplicationDestinationPrefixes("/app")`; `addEndpoint("/ws").withSockJS()`.
- `@MessageMapping("/in")` + `@SendTo("/topic/out")` (broadcast) or `@SendToUser("/queue/reply")` (per-user, needs a `Principal`).
- `@MessageExceptionHandler` for message-handling errors.
- Server push: `SimpMessagingTemplate.convertAndSend(...)` driven by `@Scheduled` or a reactive `Flux.interval`.
- A per-user client subscribes `/user/queue/reply` even when the server `@SendToUser("/queue/reply")`.

**SOAP (Spring-WS, contract-first)**:
- XSD → JAXB classes at build time; `@EnableWs` + `MessageDispatcherServlet` + `DefaultWsdl11Definition` (auto-generates the WSDL).
- `@Endpoint` + `@PayloadRoot(namespace=, localPart=)` + `@RequestPayload`/`@ResponsePayload`.
- Client: `WebServiceGatewaySupport` / `WebServiceTemplate.marshalSendAndReceive` + `Jaxb2Marshaller`.

**Spring Remoting** (REMOVED in Spring 6 — serialization RCE; historical only): one shape across HTTP Invoker / Hessian / Burlap / JMS / RMI — a `*ServiceExporter` (server) + `*ProxyFactoryBean` (client) over a shared `Serializable` interface.

**Top gotchas**:
- `@SendToUser` requires a `Principal`, typically minted by a custom `DefaultHandshakeHandler`; the client `/user/...` prefix is added automatically.
- Contract-first SOAP is build-order-sensitive: the XSD must generate JAXB classes before compile.
- Never adopt Spring Remoting for new work — it was removed for Java-serialization RCE risk.

**Current (mid-2026)**: STOMP WebSocket config and Spring-WS contract-first annotations are durable core, migrated `javax.websocket`/`javax.xml.bind` → `jakarta.*` on Spring 6. **Spring Remoting (HTTP Invoker / Hessian / Burlap / JMS invoker / RMI) was removed in Spring 6.** JAX-WS / JAXB were removed from the JDK in Java 11 (now Jakarta artifacts); SOAP is a fading style.

## Quick aside — protocol choice

For new real-time work, STOMP-over-WebSocket (or SSE for one-way streaming, see the MVC async surface) is the live, recommended path. For new service-to-service work, REST/`RestClient` or gRPC supersede both SOAP and the removed Remoting.

## Full content

Beyond REST, the base corpus covers three Spring approaches to inter-process and bidirectional communication, with very different 2026 fates.

### STOMP WebSockets — alive and recommended

Spring's messaging-over-WebSocket support layers the STOMP sub-protocol over a WebSocket (with SockJS fallback). A simple in-memory broker routes `/topic/*` broadcasts and `/queue/*` per-user replies; `@MessageMapping` handlers behave like controllers for messages. The per-user pattern is the subtle one: `@SendToUser` needs an authenticated `Principal`, and Spring rewrites client subscriptions under a `/user/...` prefix, so the server and client destination strings deliberately differ.

### Contract-first SOAP — niche but valid

Spring-WS deliberately enforces contract-first design: you author the XSD, generate JAXB classes, and let `DefaultWsdl11Definition` synthesize the WSDL. `@Endpoint` + `@PayloadRoot` dispatch on the message's root element. It remains valid for SOAP integrations, though SOAP itself is fading.

### Spring Remoting — removed

Spring Remoting unified four transports behind a single exporter/proxy shape over a `Serializable` interface. The whole family was removed in Spring 6 because Java deserialization of remote payloads is an RCE vector — the same risk that flags XStream and old Kryo/protobuf elsewhere in the corpus.

### 2026 currency

- **STOMP WebSocket config and Spring-WS contract-first annotations** are in the base doc's durable core; they migrate `javax.websocket` / `javax.xml.bind` (JAXB) → `jakarta.*` on the Spring 6 baseline but transfer 1:1 conceptually. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Spring Remoting removed in Spring 6** — HTTP Invoker / Hessian / Burlap / JMS invoker / RMI; removal explicitly motivated by Java-serialization RCE risk. The whole `spring-remoting` family is historical. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **JAX-WS / JAXB / JAX-RPC** were removed from the JDK in Java 11 and are now Jakarta artifacts; SOAP is a fading style. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: Spring Framework 7.0.8 / Spring Boot 4.1.0; Java 17 floor. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework)
