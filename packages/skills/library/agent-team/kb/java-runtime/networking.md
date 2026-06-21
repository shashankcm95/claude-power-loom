---
kb_id: java-runtime/networking
version: 1
tags:
  - java-runtime
  - networking
  - http
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-networking, core-java-networking-2, core-java-networking-3"
  - "JEP 321: HTTP Client (Standard) — JDK 11 (bugs.openjdk.org/browse/JDK-8209634)"
related:
  - java-runtime/nio-files-channels
  - java-runtime/java-crypto-security
status: active
---

## Summary

**Concept**: `java.net` — TCP/UDP sockets, URL/URI parsing, HTTP over the legacy `HttpURLConnection`, proxies, cookies, network interfaces, and JavaMail.
**Key APIs**: `ServerSocket`/`Socket`, `DatagramSocket`/`DatagramPacket`/`MulticastSocket`, `URL`/`URI`/`URLEncoder`, `HttpURLConnection`, `Proxy`, `CookieManager`, `NetworkInterface`.
**Gotcha**: `setSoTimeout` is read timeout only — bound connect with `socket.connect(addr, timeout)`; find a free port with `new ServerSocket(0)` (avoids TOCTOU); `setFollowRedirects` is a JVM-global static vs per-instance `setInstanceFollowRedirects`.
**2026-currency**: `java.net.http.HttpClient` (JEP 321, JDK 11) replaces `HttpURLConnection`; JavaMail moved `javax.mail` -> `jakarta.mail`; Unix domain sockets (JEP 380, JDK 16).
**Sources**: Baeldung `core-java-networking`/`-2`/`-3` modules; JEP 321.

## Quick Reference

**TCP sockets**: `ServerSocket`/`Socket` echo (single-client blocking `accept()`; thread-per-client for multi-server); length-prefixed reads via `DataInputStream`. Timeouts: connect via `Socket.connect(addr, timeout)`, read via `setSoTimeout`/`SO_TIMEOUT` (read only — does NOT bound connect). Free port: `new ServerSocket(0)` held open + `getLocalPort()` (avoids the TOCTOU race that Spring's now-removed `SocketUtils.findAvailableTcpPort()` had).

**UDP**: `DatagramSocket`/`DatagramPacket` echo; broadcast (`setBroadcast`, 255.255.255.255); multicast (`MulticastSocket.joinGroup`/`leaveGroup`).

**URL / URI**: `URL` parses components (protocol/host/port/path/query/ref) and is a locator with a protocol handler; `URI` is a syntactic identifier (may be a non-resolvable URN). `toURL`/`toURI` bridge. `URLEncoder`/`URLDecoder` do form encoding (`+`=space) vs path-segment `%20`.

**HTTP via `HttpURLConnection`**: full lifecycle — method, params, timeouts, response code, body (code <= 299) vs error stream (> 299), cookies, redirects. JSON POST via `setDoOutput(true)`; URL-exists via HEAD vs GET; basic auth via manual `Authorization: Basic <base64>` or `Authenticator`. File download (IO loop, `Files.copy`, `Channels`/`FileChannel.transferFrom`, `FileUtils.copyURLToFile`) + resumable via the HTTP `Range` header. **`setFollowRedirects` is JVM-global static** vs per-instance `setInstanceFollowRedirects`.

**Proxies / cookies / interfaces**: per-connection `Proxy` (DIRECT/HTTP/SOCKS via `url.openConnection(proxy)`) preferred over JVM-wide `http.proxyHost`/`Port`. `CookieManager`/`CookieStore`/`CookiePolicy`/`HttpCookie`. `NetworkInterface` (by name/IP/index, addresses, MTU, `getHardwareAddress` for MAC).

**Email (JavaMail)**: SMTP send with STARTTLS+auth (`MimeMessage`/`MimeMultipart`/`MimeBodyPart.attachFile`); POP3-over-SSL attachment download.

**Current (mid-2026)**: use `java.net.http.HttpClient` (JEP 321, JDK 11), not `HttpURLConnection`. JavaMail is now `jakarta.mail`. Unix domain sockets (`UnixDomainSocketAddress`, JEP 380, JDK 16) for IPC.

## Full content

The corpus's networking trio is entirely `java.net`-based and, notably, entirely `HttpURLConnection`-based (no `HttpClient`) — its single biggest staleness.

### Sockets

TCP is taught via `ServerSocket`/`Socket` echo servers: a single-client server blocks on `accept()`, a multi-client server spawns a thread per connection, and length-prefixed framing reads a count then the payload via `DataInputStream`. Two timeout concepts are distinct and easy to conflate: `socket.connect(addr, timeout)` bounds the connection attempt, while `setSoTimeout`/`SO_TIMEOUT` bounds an individual read only. To grab a free ephemeral port without a race, open `new ServerSocket(0)` and read `getLocalPort()` — the check-then-use approach of Spring's `SocketUtils.findAvailableTcpPort()` was TOCTOU-racy and is removed in Spring 6. Evidence: `core-java-networking-3/.../socket/FindFreePortUnitTest.java`. UDP uses `DatagramSocket`/`DatagramPacket`, with broadcast (`setBroadcast`) and multicast (`MulticastSocket.joinGroup`/`leaveGroup`).

### URL/URI and HTTP

`URL` parses a locator into protocol/host/port/path/query/ref and carries a protocol handler, while `URI` is a purely syntactic identifier that may name a non-resolvable URN; `toURL`/`toURI` bridge them. Form encoding (`URLEncoder`/`URLDecoder`, where `+` means space) differs from path-segment encoding (`%20`). HTTP is done through `HttpURLConnection` across the full lifecycle: set the method, params, and timeouts; read the body when the response code is <= 299 and the error stream when it is > 299; handle cookies and redirects. JSON POST requires `setDoOutput(true)`; a URL-exists check can use HEAD instead of GET; basic auth is either a manual `Authorization: Basic <base64>` header or an `Authenticator`. File download is shown many ways (a raw IO loop, `Files.copy`, `Channels`/`FileChannel.transferFrom`, `FileUtils.copyURLToFile`) and made resumable with a HEAD-for-length plus a `Range: bytes=...` request that appends. A redirect gotcha: `HttpURLConnection.setFollowRedirects` is a JVM-global static, distinct from the per-instance `setInstanceFollowRedirects`. Evidence: `core-java-networking-2/.../httprequest/{HttpRequestLiveTest,FullResponseBuilder}.java`, `core-java-networking-2/.../download/ResumableDownload.java:39-60`.

### Proxies, cookies, interfaces, email

Per-connection `Proxy` objects (DIRECT/HTTP/SOCKS) passed to `url.openConnection(proxy)` are preferred over JVM-wide system properties (`http.proxyHost`/`Port`). HTTP cookie handling uses `CookieManager`/`CookieStore`/`CookiePolicy`/`HttpCookie`. `NetworkInterface` enumerates interfaces by name/IP/index and exposes addresses, MTU, and `getHardwareAddress` (the MAC). JavaMail sends SMTP with STARTTLS and auth (`MimeMessage`/`MimeMultipart`/`MimeBodyPart.attachFile`) and downloads POP3-over-SSL attachments — though one corpus example hardcodes SMTP credentials and the attachment download does not sanitize `getFileName()` (a path-traversal risk, the email-download cousin of Zip-Slip).

### 2026 currency

- **`java.net.http.HttpClient` replaces `HttpURLConnection`** — standardized in **JDK 11 (JEP 321)** (incubated in 9-10). Idiom: `HttpClient.newHttpClient()` -> `HttpRequest.newBuilder(uri)...build()` -> `client.send(req, BodyHandlers.ofString())` (or `sendAsync`); built-in `BodyHandlers.{ofString, ofByteArray, ofFile, ofInputStream, ofLines}`; native HTTP/2; no third-party dependency. [JEP 321: HTTP Client (Standard)](https://bugs.openjdk.org/browse/JDK-8209634) · [HttpClient (Java SE 11 API)](https://docs.oracle.com/en/java/javase/11/docs/api/java.net.http/java/net/http/HttpClient.html)
- **`java.net.URL` string constructors deprecated in JDK 20** (JDK-8294241) — use `URI.create(...).toURL()` (parse/validate with `URI`, then `toURL()`); `URL.of(URI, URLStreamHandler)` replaces the stream-handler constructors. [JDK-8294241](https://bugs.openjdk.org/browse/JDK-8294241) · [Inside.java: Deprecate URL Public Constructors](https://inside.java/2023/02/15/quality-heads-up/)
- **Spring `SocketUtils` removed in Spring Framework 6.0** (deprecated 5.3.16); a test-only `TestSocketUtils` was added in 5.3.24, but the recommendation remains to bind an ephemeral `ServerSocket(0)` and query the port. [Spring GH #28210](https://github.com/spring-projects/spring-framework/issues/28210)
- **JavaMail moved `javax.mail.*` -> `jakarta.mail.*`** (Jakarta EE namespace break). POP3 against Gmail now needs OAuth2/app passwords (basic-password auth disabled).
- **Apache HttpClient 5.5.x/5.6.x** (groupId `org.apache.httpcomponents.client5`) is the current third-party client — RFC 9113 HTTP/2, Unix domain sockets, Java 21 virtual-thread support. [HC Project Status](https://hc.apache.org/status.html)
- **Unix domain sockets** (`java.net.UnixDomainSocketAddress`, JEP 380, JDK 16) are the JDK IPC successor where a TCP loopback socket was used.
