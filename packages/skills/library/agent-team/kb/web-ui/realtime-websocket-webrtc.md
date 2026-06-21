---
kb_id: web-ui/realtime-websocket-webrtc
version: 1
tags:
  - web-ui
  - websocket
  - webrtc
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: webrtc, play-framework (websockets)"
  - "RTCPeerConnection.createOffer (MDN, developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer)"
related:
  - web-ui/play-async-reactive
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Real-time browser transports on the JVM — WebSocket (a persistent bidirectional server channel) and WebRTC (browser-to-browser P2P media/data with the server only relaying signaling). The corpus pairs a Spring WebSocket signaling server with a browser `RTCPeerConnection` data-channel demo.
**Key APIs**: Spring `@EnableWebSocket` + `TextWebSocketHandler` + broadcast over `CopyOnWriteArrayList<WebSocketSession>`; browser `RTCPeerConnection`, `createDataChannel`, `createOffer`/`createAnswer`, SDP offer/answer + trickle ICE multiplexed over a `{event, data}` JSON envelope on one WebSocket.
**Gotcha**: `RTCPeerConnection(null)` with no STUN/TURN works only on localhost/LAN (real NAT traversal needs ICE servers); `new SocketHandler()` instantiated directly in config means the `@Component` is unused (two instances possible); `setAllowedOrigins("*")` + `ws://localhost:8080/socket` hardcoded.
**2026-currency**: WebRTC moved off callback-style `createOffer(success, error)` to Promise/`async-await` (MDN); the legacy callback form is deprecated and `null` RTC config was never viable beyond localhost.
**Sources**: Baeldung `webrtc`/`play-framework` websockets; MDN `createOffer`.

## Quick Reference

**WebSocket signaling server** (Spring):
- `@EnableWebSocket` + a `WebSocketConfiguration` registering a `TextWebSocketHandler`.
- Hold open sessions in a `CopyOnWriteArrayList<WebSocketSession>`; on a message, **broadcast to others** (relay).
- The server in a WebRTC topology only relays SDP/ICE — it never touches media/data.

**WebRTC browser flow** (P2P):
- `const pc = new RTCPeerConnection(config)`; `pc.createDataChannel("...")`.
- Caller: `pc.createOffer()` → `setLocalDescription` → send SDP via the signaling WebSocket.
- Callee: `setRemoteDescription` → `pc.createAnswer()` → send back.
- **Trickle ICE**: `onicecandidate` candidates are sent incrementally as they're gathered.
- All signaling multiplexed over one WebSocket as a `{event, data}` JSON envelope.

**Play WebSocket** (the actor-backed alternative — see the Play doc):
- `WebSocket.Json.acceptOrResult` + `ActorFlow.actorRef(...)` — one actor per connection; auth gate via `F.Either.Left(forbidden())`.

**Top gotchas**:
- **No STUN/TURN**: `RTCPeerConnection(null)` works only on the same host/LAN; real NAT traversal needs ICE (STUN/TURN) servers.
- **Unused `@Component`**: `new SocketHandler()` is instantiated directly in config, so the Spring-managed `@Component` is bypassed — two instances can exist.
- Hardcoded `ws://localhost:8080/socket` + `setAllowedOrigins("*")` (permissive CORS).
- The relay pattern broadcasts to *others*, not the sender — get the filter wrong and a peer signals itself.

**Current (mid-2026)**: The modern WebRTC API is **Promise-based** — `RTCPeerConnection.createOffer()` returns a Promise; the legacy `createOffer(success, error)` callback form is **deprecated** ([MDN createOffer](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer)). `null` RTC config (no STUN/TURN) was never viable beyond localhost. The Spring WebSocket signaling-relay *concept* carries forward; the corpus code is pre-Jakarta `javax.*`.

## Full content

The corpus's real-time slice has two transports: WebSocket (a persistent, bidirectional channel between browser and server) and WebRTC (peer-to-peer between browsers, with the server reduced to a signaling relay).

### WebSocket signaling server

The Spring example enables WebSocket with `@EnableWebSocket` and a `WebSocketConfiguration` that registers a `TextWebSocketHandler`. Open connections are tracked in a `CopyOnWriteArrayList<WebSocketSession>`; when a message arrives, the handler **broadcasts it to the other sessions** — the relay pattern. In a WebRTC topology this server's entire job is to ferry SDP offers/answers and ICE candidates between peers; it never sees media or data-channel payloads.

### WebRTC browser flow

WebRTC establishes a direct browser-to-browser channel. Each peer creates `new RTCPeerConnection(config)` and a data channel via `createDataChannel(...)`. The caller produces an SDP offer with `createOffer()`, applies it with `setLocalDescription`, and sends it through the signaling WebSocket; the callee applies it with `setRemoteDescription`, replies with `createAnswer()`, and sends the answer back. ICE candidates are exchanged incrementally (**trickle ICE**) via `onicecandidate`. All of this signaling is multiplexed over a single WebSocket as a `{event, data}` JSON envelope; once the connection is established, media/data flow peer-to-peer and the server is out of the loop.

### Known limitations in the demo

The teaching code is localhost-only by design and carries several traps: `RTCPeerConnection(null)` configures **no STUN/TURN** server, so it only works on the same host/LAN — real-world NAT traversal requires ICE servers. The Spring `@Component SocketHandler` is bypassed because the config does `new SocketHandler()` directly, so the managed bean is unused and two instances can coexist. The signaling URL `ws://localhost:8080/socket` is hardcoded and `setAllowedOrigins("*")` is fully permissive.

### Play WebSocket alternative

Play offers an actor-backed WebSocket model (`WebSocket.Json.acceptOrResult` + `ActorFlow.actorRef`, one actor per connection, auth via `F.Either.Left(forbidden())`) — covered in the Play async/reactive doc. It's the same transport with a different concurrency primitive (Akka/Pekko actors vs a Spring handler holding a session list).

### 2026 currency

- **WebRTC's JS API modernized to Promises.** `RTCPeerConnection.createOffer()` and `createAnswer()` return Promises; the legacy success/error-callback form `createOffer(success, error)` is **deprecated** per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer). Modern code uses `async`/`await`. The corpus's callback-style demo is legacy.
- **`null` RTC config (no STUN/TURN) was never viable beyond localhost** — production WebRTC needs real ICE servers; STUN/TURN setup and media tracks are absent from this corpus.
- The Spring signaling-server *concept* (relay-only SDP/ICE) carries forward, but the server code is pre-Jakarta `javax.*` (servlet/WebSocket) — see the migration doc. `setAllowedOrigins("*")` is a CORS hardening flag regardless of version.
