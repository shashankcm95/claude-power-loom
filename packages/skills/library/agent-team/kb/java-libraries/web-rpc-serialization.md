---
kb_id: java-libraries/web-rpc-serialization
version: 1
tags:
  - java-libraries
  - rpc
  - serialization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-cxf/{cxf-introduction,cxf-jaxrs-implementation,cxf-aegis,sse-jaxrs}, apache-thrift, apache-libraries (avro/beam), libraries-rpc (finagle)"
  - "Jakarta EE 9+ javax→jakarta migration (spring.io / Jakarta EE)"
related:
  - java-libraries/http-clients
  - java-libraries/messaging-coordination
status: active
---

## Summary

**Concept**: Java web-service + RPC + schema-serialization libraries — Apache CXF (JAX-WS/JAX-RS/Aegis/SSE on a common Bus), Apache Thrift (cross-language IDL RPC), Apache Avro (schema serialization), Apache Beam (batch/stream pipelines), Finagle (Twitter Scala-from-Java).
**Key APIs**: CXF `Endpoint.publish`/`@WebService`/`JAXRSServerFactoryBean`/`SseBroadcaster`; Thrift `.thrift` IDL → `.Iface`/`.Client`/`.Processor`, `TSimpleServer`/`TBinaryProtocol`; Avro `SchemaBuilder`/`SpecificDatumWriter`; Beam `Pipeline`/`PCollection`/`TextIO`.
**Gotcha**: ALL of CXF (JAX-WS/JAX-RS/SSE) uses `javax.ws.rs`/`javax.jws`/`javax.xml.*` — these are `jakarta.*` migration targets (Jakarta EE 9+); JAXB has no native `Map` binding (needs `@XmlJavaTypeAdapter`); Thrift `TSimpleServer` is single-threaded (use `TThreadPoolServer` in prod).
**2026-currency**: CXF 3.1.8 → 4.x (Jakarta); JAX-WS/JAXB removed from JDK 11; Avro/Beam concepts current.
**Sources**: Baeldung `apache-cxf`/`apache-thrift`/`apache-libraries`/`libraries-rpc` modules.

## Quick Reference

**Apache CXF (JAX-WS + JAX-RS on a common "Bus"):**

```java
// SOAP code-first: @WebService interface + impl
Endpoint.publish("http://localhost:8080/svc", new MyServiceImpl());  // embedded Jetty
// JAX-RS code-first: @Path/@GET/@PathParam + JAXRSServerFactoryBean + SingletonResourceProvider
```

- **Sub-resource locator** — a method returning a resource object with *no verb annotation* delegates sub-paths.
- **SSE (JAX-RS 2.1)** — `@Context Sse sse`, `sse.newBroadcaster()`, `@Produces(SERVER_SENT_EVENTS)`, `SseEventSink`/`SseBroadcaster.broadcast(event)`; `Last-Event-ID` resume; client `SseEventSource`.
- **JAXB type adapters** — `@XmlJavaTypeAdapter` + `XmlAdapter<V,B>` to marshal interfaces and `Map` (JAXB has no native `Map` binding).
- **Aegis** — a niche JAXB-alternative binding (`AegisContext`, StAX, `.aegis.xml`).

**Apache Thrift (cross-language IDL RPC):**

```thrift
// .thrift: namespace / struct (optional numbered fields) / service / exception
```
Compiled to `.Iface`/`.Client`/`.Processor`. Server `TSimpleServer` over `TServerSocket` (single-threaded — use `TThreadPoolServer` in prod); client `TSocket` + `TBinaryProtocol`. Field tags + `optional` give wire-version compatibility.

**Apache Avro:** schema via JSON `.avsc` *or* fluent `SchemaBuilder`; codegen (`avro-maven-plugin`/`SpecificCompiler`); `SpecificDatumWriter`/`Reader` + `EncoderFactory`/`DecoderFactory` (JSON vs binary encoding).

**Apache Beam:** unified batch/stream `Pipeline` of `PCollection` transforms (`TextIO.read` → `FlatMapElements` → `MapElements` → `Filter` → `Count` → `TextIO.write`); DirectRunner; lazy until `p.run().waitUntilFinish()`.

**Finagle (Twitter):** `Service<Req,Resp>` (request → `Future`), composable `Filter`/`SimpleFilter` via `andThen`; heavy Scala interop leaks (`Option.getOrElse`, `BoxedUnit.UNIT`).

**Current (mid-2026):** all of CXF's `javax.*` imports are `jakarta.*` migration targets; CXF 3.1.8 → 4.x (Jakarta baseline). JAX-WS/JAXB were removed from JDK 11.

## Full content

This atom covers the libraries that move structured data across a network boundary. **Apache CXF** is a unified web-services framework hosting both JAX-WS (SOAP) and JAX-RS (REST) on a shared "Bus." SOAP code-first means annotating a Service Endpoint Interface (`@WebService`) and publishing it via the one-liner `Endpoint.publish(addr, impl)` (embedded Jetty) or via Spring (`EndpointImpl`/`CXFServlet`). Because JAXB cannot bind interfaces or `Map` natively, CXF leans on `@XmlJavaTypeAdapter` + `XmlAdapter<V,B>` adapters. The JAX-RS side teaches `@Path`/`@GET`/`@PathParam`, status semantics via `Response` builders, the `JAXRSServerFactoryBean` + `SingletonResourceProvider` wiring, and — the notable concept — *sub-resource locators*, where a method returning a resource object with no verb annotation delegates its sub-paths to that object's own handlers. CXF also demonstrates Server-Sent Events (JAX-RS 2.1): injecting `@Context Sse`, building a `SseBroadcaster` for pub/sub or a per-request `SseEventSink`, emitting `text/event-stream`, and supporting `Last-Event-ID` resume on the client `SseEventSource`. **Aegis** is a niche JAXB-alternative binding.

**Apache Thrift** is cross-language RPC driven by an IDL: a `.thrift` file declares a namespace, structs with `optional` numbered fields, services, and exceptions, compiled to `.Iface`/`.Client`/`.Processor` stubs. The numbered field tags plus `optional` give forward/backward wire compatibility. The shown `TSimpleServer` over `TServerSocket` is single-threaded — `TThreadPoolServer` is the production choice; clients use `TSocket` with `TBinaryProtocol`. **Apache Avro** is schema-driven serialization: schemas come from JSON `.avsc` files or the fluent `SchemaBuilder`, codegen runs at build time (`avro-maven-plugin`/`SpecificCompiler`), and `SpecificDatumWriter`/`Reader` paired with `EncoderFactory`/`DecoderFactory` produce JSON or binary encodings.

**Apache Beam** is the unified batch/stream model: a `Pipeline` of `PCollection` transforms (the classic word-count chains `TextIO.read` → `FlatMapElements` → `MapElements` → `Filter` → `Count` → `TextIO.write`), executed lazily by a runner (DirectRunner locally) only when `p.run().waitUntilFinish()` is called. **Finagle** is Twitter's RPC system used from Java: everything is a `Service<Req,Resp>` returning a `Future`, with composable `Filter` middleware chained via `andThen`; the Scala origins leak through as `Option.getOrElse` and `BoxedUnit.UNIT`.

### 2026 currency

- **All of CXF** (JAX-WS/JAX-RS/SSE) and Meecrowave use `javax.ws.rs`/`javax.jws`/`javax.xml.ws`/`javax.xml.bind`/`javax.enterprise`/`javax.inject` — these are **`jakarta.*` migration targets** under Jakarta EE 9+ / Spring 6 / Boot 3. CXF 3.1.8 → 4.x adopts the Jakarta baseline. [The state of HTTP clients in Spring (2025)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- **JAX-WS / JAXB** (`javax.xml.ws`/`bind`, the `JAXB` convenience class) were **removed from JDK 11** — code depending on them needs the standalone artifacts. The base's CXF examples assume the bundled JDK APIs.
- Avro, Beam, and the schema-serialization concepts carry forward at concept level (bump pins; Thrift 0.10.0 → current). This domain overlaps the big-data/ML lane, which wraps the same heavyweight engines.
