---
kb_id: testing/mockito
version: 1
tags:
  - testing
  - mockito
  - mocking
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: mockito, mockito-2, mockito-3, mocks (easymock/jmockit), powermock, easymock"
  - "Upgrading to Mockito 5 — davidvlijmincx.com (https://davidvlijmincx.com/posts/upgrade-to-mockito-5/)"
  - "Draft Mockito 5 release notes — GitHub wiki (https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes)"
related:
  - testing/junit5-jupiter
  - testing/spring-testcontext
  - testing/bdd-acceptance
  - testing/test-data-fixtures
status: active
---

## Summary

**Concept**: Mockito is the 2026 Java default mocking framework — create test doubles (mock/spy), stub returns, and verify interactions. Built-in `mockStatic`/`mockConstruction` retired PowerMock; the inline mock maker (default in Mockito 5) mocks finals/statics/enums.
**Key APIs**: `@Mock/@Spy/@Captor/@InjectMocks` + `MockitoAnnotations.openMocks` (or `@ExtendWith(MockitoExtension.class)`); `when(...).thenReturn/thenThrow`; `doReturn/doThrow/doNothing/doAnswer().when(mock)`; `verify` + `times/never/atLeast`; `ArgumentCaptor`, `ArgumentMatchers.*`, `InOrder`; `Mockito.mockStatic` (try-with-resources); `BDDMockito.given/willReturn`.
**Gotcha**: spies must stub via `doReturn(x).when(spy).method()` — `when(spy.method())` calls the *real* method; void methods can't use `when(...)` (won't compile).
**2026-currency**: Mockito 5.x makes the inline maker default (`mockito-inline` no longer needed; Java 11 baseline); `initMocks`→`openMocks`, `verifyZeroInteractions`→`verifyNoInteractions`, `org.mockito.Matchers`→`ArgumentMatchers`; PowerMock/JMockit abandoned.
**Sources**: Baeldung `mockito`/`mockito-2`/`mockito-3`/`mocks`/`powermock`/`easymock`; Mockito 5 upgrade + draft release notes.

## Quick Reference

**Setup**: `@Mock`/`@Spy`/`@Captor`/`@InjectMocks` activated by `MockitoAnnotations.openMocks(this)` (modern; `initMocks` deprecated), `@ExtendWith(MockitoExtension.class)` (JUnit 5), or `@RunWith(MockitoJUnitRunner.class)` (JUnit 4).

**Stubbing**: `when(mock.m()).thenReturn(x)` / `.thenThrow(...)`; consecutive returns; the `do*` family for spies and voids — `doReturn/doThrow/doNothing/doAnswer/doCallRealMethod().when(mock).m()`.

**Verification**: `verify(mock, times(n)/never()/atLeast(n)/atMost(n)).m(...)`; `verifyNoInteractions`/`verifyNoMoreInteractions`; `InOrder`; `ArgumentCaptor` + `getValue()`; `ArgumentMatchers.any/eq/argThat`.

**Java 8**: `Optional`/`Stream` methods default to *empty*, not null; lambda `Answer` and `argThat`.

**Strict stubbing**: `MockitoExtension`/`Strictness.STRICT_STUBS` throws `UnnecessaryStubbingException` for unused stubs — opt out per-stub with `lenient()`, not globally.

**Advanced**: deep stubs (`Answers.RETURNS_DEEP_STUBS`) for fluent builders; `AdditionalAnswers.returnsFirstArg`; `MockSettings` (`RETURNS_SMART_NULLS`, `extraInterfaces`, `useConstructor`); `BDDMockito.given(...).willReturn(...)` + `then(mock).should()`.

**Static/final mocking (no PowerMock)**:
```java
try (MockedStatic<Foo> m = Mockito.mockStatic(Foo.class)) {
    m.when(Foo::bar).thenReturn("x");   // thread-local, scoped
}
```
Pre-Mockito-5, enable inline maker via resource `mockito-extensions/org.mockito.plugins.MockMaker` = `mock-maker-inline`.

**Top gotchas**:
- **Spy trap**: `when(spy.method())` runs the real method — use `doReturn(x).when(spy).method()`.
- **Void stubbing**: `when(voidMethod())` won't compile — use `doThrow/doNothing/doAnswer`.
- **`MockedStatic` must be closed** (try-with-resources) or the static stub leaks into other tests.

**Legacy alternatives (migrate off)**: EasyMock (record/replay/verify, void via `expectLastCall().andAnswer`); JMockit (`Expectations`/`Verifications` blocks — abandoned, `Deencapsulation` removed); PowerMock (`@PrepareForTest` mandatory bytecode rewrite — retired); Spock mocks (`Stub`/`Mock`/`Spy` with `1 * mock.m(arg)` cardinality).

**Current (mid-2026)**: Mockito 5.23.0 (2026-03) — inline MockMaker is the default, finals/statics/enums mockable out of the box; Java 11 baseline (8-10 stay on Mockito 4). Java 25 trap: old Mockito on class-file v69 needs Byte Buddy ≥ 1.17.5; Mockito 5.16+ bundles it.

## Full content

Mockito creates test doubles by subclassing (legacy maker) or bytecode instrumentation (inline maker). A **mock** is a fully synthetic object whose methods return defaults until stubbed; a **spy** wraps a real object and delegates to real methods unless overridden; `@InjectMocks` constructs the SUT and injects declared mocks/spies.

### Stubbing styles and the spy trap

The two stubbing dialects exist for a reason. `when(mock.m()).thenReturn(x)` is readable but *evaluates* `mock.m()` first — fine for a mock (returns a default), catastrophic for a spy (runs the real method, possibly with side effects). For spies and for void methods, the `do*` family (`doReturn/doThrow/doNothing/doAnswer().when(mock).m()`) avoids calling the method during stub setup. Forgetting this is the single most common Mockito bug.

### Verification and argument capture

`verify` asserts interactions happened with the given cardinality (`times`, `never`, `atLeast`). `ArgumentCaptor` captures the actual argument passed to a mock for further assertion; `ArgumentMatchers` (`any`, `eq`, `argThat`) match flexibly — but mixing raw values and matchers in one call is illegal (all-or-nothing). `InOrder` verifies ordering across mocks.

### Strict stubbing

`STRICT_STUBS` (the `MockitoExtension` default) surfaces dead stubs as `UnnecessaryStubbingException`, catching copy-paste rot. Relax a specific stub with `lenient()` rather than disabling strictness everywhere.

### Static mocking obsoletes PowerMock

Before Mockito 3.4, mocking `static`/`final`/constructor calls required **PowerMock** (`@RunWith(PowerMockRunner.class)` + mandatory `@PrepareForTest` bytecode rewrite — which silently no-ops if forgotten). Mockito's own `mockStatic` (returns a thread-local, scope-closed `MockedStatic` in try-with-resources) and `mockConstruction` made PowerMock obsolete. **EasyMock** (record/replay/verify; void via `expectLastCall().andAnswer(IAnswer)` reading `getCurrentArguments()`) and **JMockit** (`new Expectations(){{...}}` blocks) are alternative frameworks; both are legacy/abandoned.

### 2026 currency

- **Mockito 5 makes the inline MockMaker the default** — the standalone `mockito-inline` artifact is no longer needed; finals/statics/enums are mockable out of the box (the old subclass maker broke on JDK 17+ strong encapsulation). Baseline is Java 11 (8-10 stay on Mockito 4). Current is Mockito 5.23.0 (2026-03-11). The `initMocks`→`openMocks`, `verifyZeroInteractions`→`verifyNoInteractions`, `org.mockito.Matchers`→`ArgumentMatchers` deprecations still hold. [Upgrading to Mockito 5 (davidvlijmincx.com)](https://davidvlijmincx.com/posts/upgrade-to-mockito-5/) · [Draft Mockito 5 release notes (GitHub wiki)](https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes)
- **PowerMock is retired** in favor of `mockStatic`/`mockConstruction` (since 3.4) plus the inline-default maker. [Draft Mockito 5 release notes (GitHub wiki)](https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes)
- **JMockit is effectively abandoned** (latest 1.50, inactive) — migrate off it. [jmockit 1.50 javadoc](https://javadoc.io/doc/org.jmockit/jmockit/latest/index.html)
- **Mockito + Java 25 Byte Buddy trap** (silent break, not a CVE): old Mockito on Java 25 (class-file v69) fails unless Byte Buddy ≥ 1.17.5 is present (or `-Dnet.bytebuddy.experimental=true`); Mockito 5.16+ bundles a compatible Byte Buddy. [Mockito issue #3754 — Java 25](https://github.com/mockito/mockito/issues/3754)
- **Abandoned legacy libs receive no patches** (PowerMock, JMockit) and their bytecode/reflection machinery breaks under strong encapsulation on JDK 16+ — migrating off is a security action. [Draft Mockito 5 notes](https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes)
