---
kb_id: reactive/rxjava
version: 1
tags:
  - reactive
  - rxjava
  - observables
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: rxjava-core"
  - "RxJava README / GitHub (github.com/ReactiveX/RxJava)"
related:
  - reactive/reactive-streams-foundations
  - reactive/project-reactor-core
  - reactive/vertx
status: active
---

## Summary

**Concept**: RxJava is the ReactiveX observable/operator library for the JVM — `Observable`/`Flowable`/`Single`/`Maybe`/`Completable` with a vast operator algebra, schedulers, subjects, and custom-operator hooks.
**Key APIs**: operators (`map`/`flatMap`/`switchMap`/`scan`/`groupBy`/`zipWith`/`reduce`); `BackpressureStrategy` on `Flowable`; error handling (`onErrorReturn`/`onErrorResumeNext`/`retryWhen`); `Subject`/RxRelay; `TestObserver`/`TestScheduler`; custom ops via `lift()`/`compose()`; `RxJavaPlugins`.
**Gotcha**: RxJava 1.x AND 2.x are BOTH EOL — current line is **3.x** (`io.reactivex.rxjava3.*`); `switchMap` cancels prior inner (vs `flatMap` keeps all); `onExceptionResumeNext` ignores `Error`.
**2026-currency**: RxJava 3.1.12 stable, 4.0.0-alpha incubating; all corpus code (Rx1/Rx2) is doubly obsolete; contrib libs all dead.
**Sources**: Baeldung `rxjava-core`/`rxjava-*` modules; RxJava GitHub.

## Quick Reference

**Reactive types**: `Observable` (no backpressure), `Flowable` (backpressure-aware), `Single` (1/error), `Maybe` (0/1), `Completable` (completion/error).

**Operators**: `from`/`just`/`range`, `map`, `flatMap`, `scan`, `groupBy`, `filter`, `zipWith`, `concatWith`, `reduce`, `collect`, `toList`/`toSortedList`/`toMap`/`toMultimap`, `count`, `defaultIfEmpty`, `takeWhile`.

**`flatMap` vs `switchMap`** (the canonical distinction):
- `flatMap` keeps ALL inner subscriptions — interleaves every inner result.
- `switchMap` cancels the previous inner when a new outer item arrives — only the latest survives. The type-ahead / search-cancellation pattern.

**Filtering matrix**: `filter`, `take`/`takeWhile`/`takeFirst`/`takeLast`, `first`/`firstOrDefault`, `last`/`lastOrDefault`, `elementAt`, `ofType`, skip + time-window operators.

**Error handling**:
- `onErrorReturn`/`onErrorReturnItem`, `onErrorResumeNext` (alt Observable or function).
- `onExceptionResumeNext` — resumes only on `Exception`, **NOT `Error`**.
- `doOnError` (a throwing handler yields a `CompositeException`).
- Retry: `retry(n)`, `retry((count,err)->bool)`, `retryUntil`, `retryWhen` (control-Observable-driven backoff via `zipWith` + `timer`).

**Subjects & Relays**:
- `PublishSubject` — Observer + Observable multicast; late subscribers miss prior emissions.
- JakeWharton **RxRelay** — a Subject that cannot terminate (no onComplete/onError → safe event bus): `PublishRelay`/`BehaviorRelay`/`ReplayRelay`, consume via `accept(value)`.

**Testing**: `TestSubscriber` (Rx1) / `TestObserver` + `.test()` (Rx2) with `assertValues`/`assertComplete`/`assertNoErrors`/`assertResult`; `TestScheduler.advanceTimeBy/advanceTimeTo` for deterministic virtual time on `interval`/`timer`/`delay`.

**Custom operators**: `Observable.Operator<R,T>` via `lift()`; `Observable.Transformer<T,R>` via `compose()` — guard each callback with `subscriber.isUnsubscribed()`.

**Schedulers**: `Schedulers.io()/computation()/newThread()/trampoline()/single()/from(executor)`; `subscribeOn` vs `observeOn`.

**Top gotchas**:
- Rx1 AND Rx2 are EOL — current is **RxJava 3.x** (`io.reactivex.rxjava3.*`).
- `retry(1)` runs the source twice (one original + one retry).
- Hot `PublishSubject` floods → `MissingBackpressureException`.
- `RxJavaPlugins` hooks are global/static — `RxJavaPlugins.reset()` in teardown is mandatory.

**Current (mid-2026)**: RxJava is at **3.1.12** stable (Sep 24, 2025; package `io.reactivex.rxjava3.*`), with **4.0.0-alpha** incubating. Treat all `rx.*` (Rx1) and `io.reactivex.*` (Rx2) corpus code as doubly obsolete. Contrib libs (`rxjava-jdbc`, `MathObservable`, `StringObservable`, RxRelay2) are all dead.

## Full content

RxJava is the JVM member of the ReactiveX family — observable sequences plus a large composable operator library. The Baeldung corpus covers it broadly (`rxjava-core`, `rxjava-libraries`, `rxjava-observables`, `rxjava-operators`) but on the now-EOL 1.x and 2.x lines, so the concepts are current while the package names and some idioms are not.

### Types and operators

RxJava 2 splits into `Observable` (no backpressure), `Flowable` (backpressure-aware Publisher), `Single`, `Maybe`, and `Completable`. The operator algebra is vast: transform (`map`/`flatMap`/`scan`/`groupBy`), combine (`zipWith`/`concatWith`/`merge`), aggregate (`reduce`/`collect`/`toList`/`toMap`/`count`), and a deep filtering matrix (`filter`/`take*`/`first`/`last`/`elementAt`/`ofType`/skip + time windows).

### flatMap vs switchMap

`flatMap` subscribes to every inner Observable and interleaves all their results — nothing is cancelled. `switchMap` cancels the previous inner subscription the moment a new outer item arrives, so only the latest inner survives. This is the canonical type-ahead/search pattern: each keystroke produces a new query, and `switchMap` discards in-flight results from stale keystrokes (`RxFlatmapAndSwitchmapUnitTest.java`, verified with `TestScheduler`).

### Error handling

`onErrorReturn`/`onErrorReturnItem` substitute a fallback value; `onErrorResumeNext` switches to an alternate Observable or a function of the error. `onExceptionResumeNext` is a trap — it resumes only on `Exception` and lets a raw `Error` propagate. A throwing `doOnError` yields a `CompositeException`/`OnErrorNotImplementedException`. The retry family — `retry(n)`, `retry((count,err)->bool)`, `retryUntil`, `retryWhen` — supports backoff by driving a control Observable (`retryWhen` + `zipWith(range)` + `timer` for exponential delay, `OnErrorRetryIntegrationTest.java`). Note `retry(1)` runs the source twice.

### Subjects, relays, backpressure

`PublishSubject` is a hot multicast Observer+Observable — late subscribers miss prior emissions, and as a hot source it has no backpressure, so flooding throws `MissingBackpressureException` (vs a cold `Observable.range` that honors reactive pull). JakeWharton's **RxRelay** wraps a Subject so it can never terminate (no onComplete/onError), making a safe event bus: `PublishRelay`/`BehaviorRelay`/`ReplayRelay` consumed via `accept(value)`. Backpressure on `Flowable` uses `BackpressureStrategy` (BUFFER/DROP/LATEST/ERROR/MISSING) via `Observable.toFlowable(strategy)` or `Flowable.create(onSubscribe, strategy)` — `FlowableIntegrationTest.java` shows BUFFER receiving all 100k, DROP/LATEST losing, MISSING/ERROR throwing.

### Custom operators, testing, hooks

Custom operators come in two shapes: `Observable.Operator<R,T>` applied via `lift()` (operates on the raw subscriber — must guard every callback with `subscriber.isUnsubscribed()`), and `Observable.Transformer<T,R>` applied via `compose()` (composes a whole sub-pipeline). Testing uses `TestObserver`/`.test()` (`assertValues`/`assertComplete`/`assertNoErrors`/`assertResult`) and `TestScheduler` for deterministic virtual time. `RxJavaPlugins` provides global assembly/subscribe/scheduler/error interception — its hooks are static, so `RxJavaPlugins.reset()` in teardown is mandatory. `Observable.using(factory, obsFactory, dispose)` provides deterministic resource cleanup.

### 2026 currency

- **RxJava advanced to 3.x stable, with 4.x incubating.** RxJava 1.x and 2.x are both EOL (2.x reached EOL Feb 28, 2021 at 2.2.21). The current stable line is **3.1.12** (Sep 24, 2025, package `io.reactivex.rxjava3.*`); **4.0.0-alpha** releases now exist (e.g. v4.0.0-alpha-13, Apr 2026). RxJava 3 removed Rx1 `toBlocking`/`Observable.from`/`TestSubscriber`-1.x idioms — treat all `rx.*` code as doubly obsolete. [RxJava README / GitHub](https://github.com/ReactiveX/RxJava) · [RxJava releases](https://github.com/ReactiveX/RxJava/releases)
- **RxJava contrib libs are all dead.** `rxjava-jdbc` (abandoned, Rx1-only → modern is **R2DBC / Spring Data R2DBC**), `MathObservable`, `StringObservable`, and RxRelay2/akarnokd-extensions (target Rx2). The idiomatic 2026 reactive-DB stack is R2DBC, absent from this corpus. [RxJava README / GitHub](https://github.com/ReactiveX/RxJava)
- **Virtual Threads are now a simpler alternative** for many I/O-bound services that previously reached for RxJava/Reactor (JEP 444, Java 21); reactive still wins for streaming/backpressure. [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
