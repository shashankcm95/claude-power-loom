---
kb_id: bigdata-ml-cloud/reactive-cloud-integration
version: 1
tags:
  - bigdata-ml-cloud
  - reactive
  - aws
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: aws-reactive"
  - "Baeldung tutorials (eugenp/tutorials) module: aws-app-sync"
  - "S3 Transfer Manager GA (aws.amazon.com/about-aws/whats-new/2022/12/amazon-s3-transfer-manager-aws-sdk-java-2-x)"
related:
  - bigdata-ml-cloud/aws-sdk-java
  - bigdata-ml-cloud/apache-spark
  - bigdata-ml-cloud/saas-integrations
status: active
---

## Summary

**Concept**: The cross-cutting reactive integration idiom — bridging AWS SDK v2 `CompletableFuture`s and streaming bodies into Reactor `Mono`/`Flux`, the same pattern reused across `aws-reactive`, `aws-app-sync`, and `discord4j`.
**Key APIs**: `S3AsyncClient` (Netty NIO), `Mono.fromFuture(s3client.xxx(...))`, body as `Flux<ByteBuffer>`/`Flux<DataBuffer>`; reactive multipart (`createMultipartUpload`→`bufferUntil`≥5MB→`uploadPart`→`completeMultipartUpload`); custom `AsyncResponseTransformer`; `@ConfigurationProperties("aws.s3")`, `DefaultCredentialsProvider`.
**Gotcha**: `bufferUntil` accumulates in memory until the 5MB part threshold (peak memory ≈ part size × concurrency); `Mono.fromFuture` doesn't propagate Reactor cancellation to the `CompletableFuture` (a disconnect may not abort the transfer); it imports an *internal* SDK class — fragile across versions.
**2026-currency**: S3 Transfer Manager v2 (GA 2022) now covers multipart with far less hand-rolling; Java 21 virtual threads are a simpler alternative to `.block()`-everywhere bridging.
**Sources**: Baeldung `aws-reactive` + `aws-app-sync` modules; S3 Transfer Manager GA.

## Quick Reference

**The Future→Mono bridge** (the recurring pattern): wrap an SDK v2 async call as a Reactor type.
- `Mono.fromFuture(s3client.someOperation(req))`
- Stream a response body as `Flux<ByteBuffer>` / `Flux<DataBuffer>` — no temp files.

**End-to-end reactive S3** (`aws-reactive`, WebFlux + Reactor + Netty):
- `S3AsyncClient` over Netty NIO; tune `maxConcurrency`, `writeTimeout`
- Config via `@ConfigurationProperties("aws.s3")`; credentials fall back to `DefaultCredentialsProvider`

**Manual reactive multipart**:
1. `createMultipartUpload`
2. `bufferUntil` accumulates ≥5MB chunks
3. `uploadPart` per chunk, collecting `CompletedPart` etags
4. `completeMultipartUpload`, threading a mutable `UploadState` holder

**Streaming download**: a custom `AsyncResponseTransformer` → `Flux` body.

**Same idiom reused**: AppSync (`WebClient` POST to `/graphql`) and Discord4J both use the identical Reactor `Mono`/`Flux` bridging.

**Top gotchas**:
- `bufferUntil` accumulates in memory until the 5MB threshold → peak memory ≈ part size × concurrency.
- Upload requires `Content-Length` up front (chunked clients break); `checksumValidationEnabled(false)` is a deliberate streaming tradeoff.
- `Mono.fromFuture` doesn't propagate Reactor cancellation to the underlying `CompletableFuture` — a client disconnect may not abort the transfer.
- It imports an **internal** SDK class (`...core.internal.async.ByteArrayAsyncResponseTransformer`) — fragile across versions.
- `.block()` everywhere (AppSync, Discord, Slack `.join()`) defeats the async/reactive benefit.

**Current (mid-2026)**: **S3 Transfer Manager v2** (GA Dec 2022, CRT-based) now covers multipart/directory transfer with far less hand-rolling than the `bufferUntil`/`uploadPart` choreography. **Java 21 virtual threads** (JEP 444) are a simpler I/O-concurrency model than the reactive bridging for many cloud/SaaS clients.

## Full content

The `aws-reactive`, `aws-app-sync`, and `discord4j` modules share one cross-cutting idiom: integrate an external SDK's async surface into Project Reactor's `Mono`/`Flux` types, so the whole request path stays non-blocking. The corpus dedupes this as a recurring pattern rather than three separate techniques.

The richest example is **end-to-end reactive S3** (`aws-reactive`). It uses AWS SDK v2's `S3AsyncClient` over Netty NIO, bridges each operation's `CompletableFuture` to Reactor with `Mono.fromFuture(...)`, and streams bodies as `Flux<ByteBuffer>`/`Flux<DataBuffer>` with no temporary files. Configuration is externalized through `@ConfigurationProperties("aws.s3")`, with Netty tuning (`maxConcurrency`, `writeTimeout`) and a credential fallback to `DefaultCredentialsProvider`.

The module hand-rolls **reactive multipart upload**: `createMultipartUpload`, then `bufferUntil` accumulating ≥5MB chunks, then `uploadPart` per chunk collecting `CompletedPart` etags, then `completeMultipartUpload` — threading a mutable `UploadState` holder through the pipeline. Downloads stream via a custom `AsyncResponseTransformer` that emits a `Flux` body.

The same Reactor bridging recurs in the other modules: **AppSync** consumes managed GraphQL by POSTing `{query, variables, operationName}` to `/graphql` through a WebFlux `WebClient`, and **Discord4J** is fully reactive (covered in the saas-integrations sibling).

The reactive caveats are sharp and worth carrying: `bufferUntil` holds each part in memory until the 5MB threshold, so peak memory scales with part size times concurrency; uploads need `Content-Length` up front (breaking chunked clients); `checksumValidationEnabled(false)` is a deliberate streaming tradeoff; `Mono.fromFuture` does not propagate Reactor cancellation back to the `CompletableFuture`, so a client disconnect may not abort the in-flight transfer; and the code imports an *internal* SDK class, making it fragile across SDK versions. Finally, `.block()` sprinkled through AppSync, Discord, and Slack (`.join()`) quietly defeats the reactive benefit it set out to gain.

### 2026 currency

The biggest modernization is that the manual reactive-multipart choreography is largely obsolete: **S3 Transfer Manager v2** (GA Dec 19, 2022, CRT-based) now handles multipart, directory transfers, pause/resume, and progress with far less hand-rolling ([S3 Transfer Manager GA (AWS)](https://aws.amazon.com/about-aws/whats-new/2022/12/amazon-s3-transfer-manager-aws-sdk-java-2-x)). The AWS SDK v2 builder/async style and the reactive-multipart *approach* remain conceptually correct, but reach for the Transfer Manager before hand-rolling.

At the JVM level, **virtual threads (Project Loom)** are final in Java 21 (JEP 444) and refined in Java 25 — virtual threads that block in `synchronized` now release their carrier — which reshapes JVM concurrency for I/O-bound cloud/SaaS clients and offers a much simpler alternative to the corpus's `.block()`-everywhere reactive bridging ([Oracle Releases Java 25 (Oracle)](https://www.oracle.com/news/announcement/oracle-releases-java-25-2025-09-16/) · [Java Virtual Threads in JDK 25 (javapro.io)](https://javapro.io/2026/03/05/java-25-and-the-new-age-of-performance-virtual-threads-and-beyond/)).
