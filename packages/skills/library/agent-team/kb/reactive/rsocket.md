---
kb_id: reactive/rsocket
version: 1
tags:
  - reactive
  - rsocket
  - protocol
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: rsocket"
  - "rsocket-core javadoc 1.1.5 (javadoc.io/doc/io.rsocket/rsocket-core/latest/index.html)"
related:
  - reactive/spring-webflux
  - reactive/reactive-streams-foundations
status: active
---

## Summary

**Concept**: RSocket is a binary, bidirectional, message-driven application protocol with backpressure carried end-to-end over the wire (via Reactor), defining four interaction models over a single connection.
**Key APIs**: four models — Request/Response (`Mono<Payload>`), Fire-and-Forget (`Mono<Void>`), Request/Stream (`Flux<Payload>`), Channel (bidirectional `Flux<Payload>`); Spring `@MessageMapping` + `RSocketRequester`; modern `RSocketConnector`/`RSocketServer` (raw `RSocketFactory`/`AbstractRSocket` deprecated in 1.0, removed in 1.1.0).
**Gotcha**: `null` is forbidden in a reactive stream — `onErrorReturn(null)` would NPE/violate the spec; raw demo `Publisher`s are non-spec-compliant (single subscriber, ignore `request(n)`).
**2026-currency**: rsocket-java is at **1.1.5**; the pre-1.0 `RSocketFactory`/`AbstractRSocket` construction API is gone; the four-model taxonomy is conceptually current.
**Sources**: Baeldung `rsocket` module; rsocket-core javadoc.

## Quick Reference

**Four interaction models** (all over one connection, backpressure end-to-end):

| Model | Signature | Use |
|-------|-----------|-----|
| Request/Response | `Mono<Payload>` | classic RPC |
| Fire-and-Forget | `Mono<Void>` | no reply needed |
| Request/Stream | `Flux<Payload>` | one request, many responses |
| Channel | bidirectional `Flux<Payload>` in/out | full duplex stream |

**Two construction idioms in the corpus**:
1. **Raw `io.rsocket`** (dated, pre-1.0) — `RSocketFactory.receive()/connect()` + `AbstractRSocket` override of `requestResponse`/`fireAndForget`/`requestStream`/`requestChannel`; `DefaultPayload.create(...)`, `payload.getDataUtf8()`; TCP via `TcpServerTransport`/`TcpClientTransport`.
2. **Spring Boot** (current) — `spring-boot-starter-rsocket` + `@MessageMapping` + `@MessageExceptionHandler` controllers returning `Mono`/`Flux`/`Mono<Void>`; client `RSocketRequester.route(...).data(...).retrieveMono/retrieveFlux/send()`, TCP transport.

**Top gotchas**:
- `null` is forbidden in a reactive stream — `onErrorReturn(null)` violates the spec.
- The corpus's raw custom `Publisher`s are non-spec-compliant (single subscriber, ignore `request(n)`, emit from a raw `new Thread`) — demo only, unsafe to reuse.
- Time-based RSocket tests use `Thread.sleep(500)` as an async gate — flaky.

**Current (mid-2026)**: rsocket-java is at **1.1.5**. The pre-1.0 `RSocketFactory`/`AbstractRSocket` API was deprecated in 1.0 and removed in 1.1.0 → use `RSocketConnector.create()` / `RSocketServer.create()` + implement `RSocket` directly. Modern Spring usage is `spring-boot-starter-rsocket` + `@MessageMapping`; for a Spring client use `RSocketRequester.builder()` to connect, or `RSocketRequester.wrap(...)` to wrap an existing `RSocket` (both current, distinct purposes — neither is deprecated). The four-model taxonomy is conceptually current.

## Full content

RSocket is a binary application protocol over TCP/WebSocket/Aeron designed for reactive, message-driven communication. Its defining feature is that backpressure is carried end-to-end across the wire — because RSocket is built on Reactor, a slow remote consumer throttles the remote producer, unlike HTTP where backpressure stops at each hop. The Baeldung `rsocket` module demonstrates all four interaction models in raw form, and `spring-5-webflux` shows the Spring idiom.

### The four interaction models

A single RSocket connection multiplexes four interaction shapes: **Request/Response** (`Mono<Payload>`, classic RPC), **Fire-and-Forget** (`Mono<Void>`, no reply), **Request/Stream** (`Flux<Payload>`, one request yields a stream), and **Channel** (bidirectional `Flux<Payload>` in and out, full-duplex streaming). The model taxonomy is the conceptually durable part of RSocket — only the construction API changed across versions.

### Raw vs Spring construction

The **raw** idiom (`Server.java`, `ReqResClient.java`, etc.) uses `RSocketFactory.receive()/connect()` with `TcpServerTransport`/`TcpClientTransport`, overriding `requestResponse`/`fireAndForget`/`requestStream`/`requestChannel` on `AbstractRSocket`; payloads via `DefaultPayload.create(...)` and `payload.getDataUtf8()`. This whole API was deprecated in RSocket 1.0 and removed in 1.1.0. The **Spring** idiom (`MarketDataRSocketController.java`, `ClientConfiguration.java`) is the current path: `spring-boot-starter-rsocket` auto-configures the server, `@MessageMapping`/`@MessageExceptionHandler` controllers return reactive types, and a client uses `RSocketRequester.route(...).data(...).retrieveMono/retrieveFlux/send()`.

### Pitfalls

`null` is forbidden in any reactive stream — `onErrorReturn(null)` would NPE and violate the spec (a real bug in `ReqStreamClient`). The corpus's hand-rolled custom `Publisher`s are non-spec-compliant: they assume a single subscriber, ignore `request(n)`, and emit from a raw `new Thread` — fine as a teaching device, unsafe to reuse. RSocket tests also lean on `Thread.sleep(500)` as an async gate, which is flaky; prefer `StepVerifier`.

### 2026 currency

- **The pre-1.0 API is gone.** `RSocketFactory`/`AbstractRSocket` were deprecated in RSocket 1.0 and removed in 1.1.0; the current construction idiom is `RSocketConnector.create()` / `RSocketServer.create()`, implementing `RSocket` directly. rsocket-java is at **1.1.5** (1.1.x branch). [rsocket-core javadoc (1.1.5)](https://javadoc.io/doc/io.rsocket/rsocket-core/latest/index.html) · [RSocketConnector javadoc](https://javadoc.io/doc/io.rsocket/rsocket-core/1.1.1/io/rsocket/core/RSocketConnector.html)
- **Modern Spring usage is `spring-boot-starter-rsocket` + `@MessageMapping`.** A Spring client connects via `RSocketRequester.builder()`, while `RSocketRequester.wrap(...)` wraps an existing `RSocket` — both are current and serve distinct purposes; neither is deprecated (the deprecated members are the builder's `connect()`/`connectTcp()`/`connectWebSocket()`, replaced by `transport()`/`tcp()`/`websocket()` as of Spring 5.3). The corpus's `rsocket-java 0.11.13` (pre-1.0) raw code needs rewriting; the Spring path is forward-compatible. [rsocket-core javadoc (1.1.5)](https://javadoc.io/doc/io.rsocket/rsocket-core/latest/index.html)
- **The interaction-model taxonomy carries forward unchanged.** The four models (request/response, request/stream, channel, fire-and-forget) and their reactive signatures are conceptually current; only the construction API changed. [rsocket-core javadoc (1.1.5)](https://javadoc.io/doc/io.rsocket/rsocket-core/latest/index.html)
