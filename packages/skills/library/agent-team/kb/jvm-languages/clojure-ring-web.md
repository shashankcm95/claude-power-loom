---
kb_id: jvm-languages/clojure-ring-web
version: 1
tags:
  - jvm-languages
  - clojure
  - ring
  - web
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: clojure/ring"
  - "clojure.org downloads (https://clojure.org/releases/downloads)"
related:
  - jvm-languages/kotlin-vs-java
  - jvm-languages/javalite-activerecord-web
status: active
---

## Summary

**Concept**: Clojure's Ring web abstraction — a handler is a plain function `request -> response-map`, with composable middleware and immutable session state.
**Key APIs**: handler fn returning `{:status :headers :body}`; middleware composed with thread-first `->` (`wrap-params`, `wrap-cookies`, `wrap-session`, `content-type`, `response`); `(run-jetty h {:port 3000})`; Leiningen `defproject` + `lein-ring` + `:ring {:handler ...}`.
**Gotcha**: a handler MUST return a complete response map (or use `ring.util.response/response`) — a raw string is not valid; middleware ORDER matters (`->` nests).
**2026-currency**: Clojure 1.10 (corpus) → 1.12.5 (2026-05-12); the handler-as-fn + middleware model remains idiomatic and stable.
**Sources**: `clojure/ring` module; clojure.org downloads.

## Quick Reference

**Handler as a plain function** — request and response are ordinary Clojure maps:

```clojure
(defn handler [request]
  {:status 200
   :headers {"Content-Type" "text/plain"}
   :body (str "from " (:remote-addr request))})

;; destructure request:
(defn h [{params :params}] ...)
```

**Middleware** — higher-order fns composed with thread-first `->` (ORDER matters, it nests):

```clojure
(-> handler
    (wrap-params {:encoding "UTF-8"})
    wrap-cookies
    (wrap-session {:cookie-attrs {:max-age 3600}}))
```

**Immutable stateful session** — read, `assoc` to update, re-attach:

```clojure
(let [count (:count session 0)
      session (assoc session :count (inc count))]
  (-> (response (str count))
      (assoc :session session)))   ;; per-session counter via immutable update
```

**Run** — `(run-jetty h {:port 3000})`; project config via Leiningen `defproject`, the `lein-ring` plugin, and `:ring {:handler your.ns/app}`.

**Current (mid-2026)**: Clojure 1.12.5 (2026-05-12); compiles to Java-8-compatible bytecode, Java 25 recommended, Java 8 minimum. The Ring handler-as-fn + middleware model taught here is unchanged and idiomatic.

## Full content

Ring is Clojure's foundational web abstraction, and the corpus covers it through a single small example (`clojure/ring/src/ring/core.clj`, 49 lines, REPL-driven, no tests).

**The handler** is the core idea: a Ring handler is just a plain function from a request to a response. Both request and response are ordinary Clojure maps. The response map is `{:status :headers :body}`; you read request fields directly (`(:remote-addr request)`) or via destructuring (`{params :params}`). Evidence: `ring/core.clj:11-14`.

**Middleware** are higher-order functions that wrap a handler, composed with the thread-first macro `->`. Because `->` nests the calls, the order is significant. Concrete middleware in the corpus: `wrap-params` (`{:encoding "UTF-8"}`), `wrap-cookies`, `wrap-session` (`{:cookie-attrs {:max-age 3600}}`), `content-type`, and `response`. Evidence: `ring/core.clj:25-43`.

**Immutable session state** follows Clojure's persistent-data idiom: read the current value with a default (`(:count session 0)`), produce a new session with `assoc`, and re-attach it to the response with `(assoc :session session)`. The result is a per-session counter implemented purely through immutable updates — no mutable state. Evidence: `ring/core.clj:36-40`.

**Running and project setup**: `(run-jetty handler {:port 3000})` starts an embedded Jetty; the Leiningen `defproject` plus the `lein-ring` plugin and `:ring {:handler ...}` key wire up the build.

The key trap: a handler must return a *complete response map* (or build one with `ring.util.response/response`) — returning a raw string is not valid. And because middleware composition nests via `->`, getting the order wrong changes behaviour.

Coverage caveat: this is the only Clojure content in the domain — there is nothing of broader Clojure (sequences, STM, macros, core.async, spec), and the module is pinned to 2018-era versions with no tests.

### 2026 currency

- **Clojure 1.10 (corpus, 2018) → 1.12.5 (2026-05-12).** Several majors newer, but the language compiles to Java-8-compatible bytecode; Java 25 is recommended, Java 8 is the minimum. [clojure.org downloads](https://clojure.org/releases/downloads)
- **The Ring handler-as-fn + middleware model remains idiomatic and stable** — the corpus's teaching value carries forward unchanged despite the version gap.
- **Virtual threads (Project Loom, GA in Java 21)** are a platform-level concurrency shift relevant to Clojure servers running on a modern LTS JDK — blocking handlers on virtual-thread executors scale differently than on the old platform-thread pools. [What's new in Java 25 (LTS)](https://keyholesoftware.com/java-25-whats-new/)
