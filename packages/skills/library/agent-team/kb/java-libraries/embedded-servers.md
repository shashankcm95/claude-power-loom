---
kb_id: java-libraries/embedded-servers
version: 1
tags:
  - java-libraries
  - embedded-server
  - netty
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: netty, libraries-server, libraries-server-2 (jetty http/2), libraries-http-2 (javalin)"
  - "Netty 2026 CVE cluster (SentinelOne CVE-2026-42579)"
related:
  - java-libraries/http-clients
  - java-libraries/resilience-concurrency
status: active
---

## Summary

**Concept**: programmatic/embedded Java servers + async networking — Netty (event-driven, the `ChannelPipeline` + `ByteBuf` model), embedded Jetty/Tomcat, NanoHTTPD, and lightweight frameworks (Javalin, Takes, Meecrowave).
**Key APIs**: Netty `ServerBootstrap`/`NioEventLoopGroup`/`ChannelInitializer`/`SimpleChannelInboundHandler`/`ByteBuf`; Jetty `Server`+`ServerConnector`+`ServletHandler`; Tomcat `org.apache.catalina.startup.Tomcat`; Javalin `Javalin.create().start(port)`.
**Gotcha**: Netty `ByteBuf` reference-counting is the canonical footgun (manual `alloc()`/`release()` exactly once; `SimpleChannelInboundHandler` auto-releases); `alpn-boot` is JDK-8-only (Jetty HTTP/2 broken on JDK 9+); embedded servlets use `javax.servlet` → `jakarta` migration target.
**2026-currency**: Netty 4.1.48 is many CVEs stale (codec-dns CVE-2026-42579 fixed in 4.2.13/4.1.133); HTTP/2 + ALPN concepts current via JDK SslProvider.
**Sources**: Baeldung `netty`/`libraries-server`/`libraries-server-2` modules.

## Quick Reference

**Netty (async event-driven) — the core model:**

```java
ServerBootstrap b = new ServerBootstrap()
    .group(bossGroup, workerGroup)          // two NioEventLoopGroups
    .channel(NioServerSocketChannel.class)
    .childHandler(new ChannelInitializer<>() {  // assembles the ChannelPipeline
        protected void initChannel(SocketChannel ch) {
            ch.pipeline().addLast(new MyDecoder(), new MyHandler());
        }
    });
```

- `ChannelPipeline` = ordered inbound/outbound `ChannelHandler`s.
- `SimpleChannelInboundHandler<T>` **auto-releases** ref-counted messages; manual handlers must `ctx.alloc().buffer(n)` + `release()` **exactly once** (direct-memory leak otherwise — the canonical footgun).
- Custom codecs `ReplayingDecoder`/`MessageToByteEncoder`; exception flow `exceptionCaught`/`fireExceptionCaught`.
- `EmbeddedChannel` for in-memory pipeline testing.
- HTTP/1.1: `HttpRequestDecoder`/`HttpResponseEncoder`, `DefaultFullHttpResponse`, `HttpUtil`.
- **HTTP/2 over TLS+ALPN**: `SslContextBuilder` + `SslProvider.JDK`, `ApplicationProtocolConfig`, `Http2FrameCodecBuilder`, `HttpToHttp2ConnectionHandlerBuilder`.

**Embedded Jetty / Tomcat / NanoHTTPD:**

```java
Server server = new Server(new QueuedThreadPool());   // Jetty programmatic
server.setHandler(servletHandler);  // ServerConnector + ServletHandler; WAR via WebAppContext
// Tomcat: org.apache.catalina.startup.Tomcat (add Context, servlets, FilterDef/FilterMap)
// NanoHTTPD: serve(IHTTPSession) or RouterNanoHTTPD + addRoute
```
Jetty async servlets: `startAsync` + `WriteListener`. Jetty HTTP/2 needs ALPN (`alpn-boot` is **JDK-8-only**).

**Lightweight frameworks:** **Javalin** (`Javalin.create().start(port)`, `app.get("/path", ctx -> ..)`); **Takes** (immutable/OO: `FtBasic` + `TkFork`/`FkRegex`); **Meecrowave** (JAX-RS + CDI + JSON microserver, TomEE-derived).

**Top gotchas:**

- Netty `ByteBuf` must be released exactly once (direct-memory leak).
- `alpn-boot` is JDK-8-only — Jetty/Tomcat HTTP/2 examples break on JDK 9+ (use JDK 9+ native ALPN).
- Embedded servlet code (`javax.servlet`, `@WebServlet`) is a `jakarta.servlet` migration target (Tomcat 10+/Jetty 11+).

**Current (mid-2026):** Netty 4.1.48.Final is many years/CVEs stale; the **codec-dns CVE-2026-42579** is fixed in **4.2.13.Final / 4.1.133.Final**. HTTP/2 + ALPN concepts remain valid via the JDK `SslProvider`.

## Full content

The corpus teaches embedded and async servers across a spectrum from raw event loops to one-line micro-frameworks. **Netty** is the heavyweight: a `ServerBootstrap` (or `Bootstrap` for clients) wires a boss `NioEventLoopGroup` (accepts connections) and a worker group (handles I/O), and a `ChannelInitializer` assembles the per-connection `ChannelPipeline` — an ordered chain of inbound and outbound `ChannelHandler`s. The single most important footgun is `ByteBuf` reference-counting: Netty's buffers are manually ref-counted, so a handler that allocates (`ctx.alloc().buffer(n)`) must release exactly once or leak direct memory; `SimpleChannelInboundHandler<T>` auto-releases the message it receives, which is why it's the safe default. Custom codecs subclass `ReplayingDecoder`/`MessageToByteEncoder`, exceptions propagate via `exceptionCaught`/`fireExceptionCaught`, and `EmbeddedChannel` enables in-memory pipeline testing without sockets. Netty's HTTP/1.1 support (`HttpRequestDecoder`/`HttpResponseEncoder`, `DefaultFullHttpResponse`, `HttpUtil`, keep-alive, 100-Continue) and HTTP/2-over-TLS+ALPN stack (`SslContextBuilder` with `SslProvider.JDK`, `ApplicationProtocolConfig`, `ApplicationProtocolNegotiationHandler`, `Http2FrameCodecBuilder`, `HttpToHttp2ConnectionHandlerBuilder`) are taught in depth.

The servlet-container side is shown programmatically: **embedded Jetty** builds a `Server` with a `QueuedThreadPool`, a `ServerConnector`, and a `ServletHandler` (or a `WebAppContext` for a WAR), supporting async servlets via `startAsync` + `WriteListener`; **embedded Tomcat** uses `org.apache.catalina.startup.Tomcat` to add a `Context`, servlets, and filter definitions. Both server-side HTTP/2 demos depend on ALPN, and the base's `alpn-boot` agent is JDK-8-only — obsolete on JDK 9+ which provides native ALPN. **NanoHTTPD** is the tiny option (`serve(IHTTPSession)` or `RouterNanoHTTPD` + `addRoute`). The lightweight frameworks — **Javalin** (`Javalin.create().start(port)` with `app.get(path, handler)` lambdas), **Takes** (an immutable/OO design with `FtBasic` + `TkFork`/`FkRegex`), and **Meecrowave** (a JAX-RS + CDI + JSON microserver derived from TomEE) — trade Netty's control for one-liner ergonomics.

### 2026 currency

- **Netty 4.1.48.Final** is many years and many CVEs stale; the **codec-dns CVE-2026-42579** is fixed in **4.2.13.Final / 4.1.133.Final**. Bump aggressively. [SentinelOne CVE-2026-42579](https://www.sentinelone.com/vulnerability-database/cve-2026-42579/)
- Embedded servlet code (`javax.servlet`, `@WebServlet`) in `libraries-server`/`libraries-server-2`/Spring-Yarg is a **`jakarta.servlet` migration target** under Tomcat 10+/Jetty 11+. [The state of HTTP clients in Spring (2025)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- `alpn-boot` is JDK-8-only — HTTP/2 examples break on JDK 9+; use the JDK's native ALPN (which Netty's `SslProvider.JDK` already targets). The HTTP/2 + ALPN *concepts* carry forward.
- The base's `libraries-server-2` HTTP/2 example has config + webapp but no test/client code (proven by `mvn jetty:run` + browser) — a coverage gap to be aware of.
