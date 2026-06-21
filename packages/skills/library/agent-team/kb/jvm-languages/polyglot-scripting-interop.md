---
kb_id: jvm-languages/polyglot-scripting-interop
version: 1
tags:
  - jvm-languages
  - polyglot
  - scripting
  - interop
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: language-interop"
  - "openjdk/nashorn (https://github.com/openjdk/nashorn)"
  - "oracle/graalpython (https://github.com/oracle/graalpython)"
related:
  - jvm-languages/javalite-activerecord-web
  - jvm-languages/groovy-metaprogramming
status: active
---

## Summary

**Concept**: Calling other languages from the JVM — Java↔Python (ProcessBuilder, Commons Exec, JSR-223, in-process Jython) and Java↔JavaScript (Nashorn via JSR-223), plus the GraalVM successor story.
**Key APIs**: `ProcessBuilder` / Apache Commons Exec (`CommandLine`/`DefaultExecutor`/`PumpStreamHandler`); `ScriptEngineManager().getEngineByName("python")` (Jython); Jython `PythonInterpreter` (`exec`/`get`→`PyObject.asInt()`/`setOut`); Nashorn `Bindings`/`Invocable.invokeFunction`/`Java.type`/`Java.to`/`load`.
**Gotcha**: Nashorn is REMOVED from the JDK (deprecated JDK 11 / removed JDK 15) — `getEngineByName("nashorn")` returns null and NPEs; Jython is Python-2 only; `ProcessBuilder("python", ...)` assumes a Py2-era `python` binary (often `python3`-only now).
**2026-currency**: Nashorn → standalone `org.openjdk.nashorn:nashorn-core` 15.7 or GraalJS; Jython 2.7.4 (Py2-only) → GraalPy 25.0.3 (Python 3.12) as the modern polyglot substrate; `javax.script.*` (JSR-223) itself is unaffected by javax→jakarta.
**Sources**: `language-interop` module; openjdk/nashorn; oracle/graalpython.

## Quick Reference

**Java → Python — 4 mechanisms**:

```java
// 1. external process
new ProcessBuilder("python", scriptPath).start();
// 2. Apache Commons Exec
DefaultExecutor exec = new DefaultExecutor();
exec.execute(CommandLine.parse("python " + script));   // + PumpStreamHandler
// 3. JSR-223 (Jython-backed)
new ScriptEngineManager().getEngineByName("python").eval(...);
// 4. in-process Jython
PythonInterpreter pi = new PythonInterpreter();
pi.exec("x = 2 + 2");
int x = pi.get("x").asInt();   // PyObject; pi.setOut(writer); errors as PyException
```

**Java ↔ JavaScript via Nashorn** (JSR-223, JDK 8-14 only):

```java
ScriptEngine eng = new ScriptEngineManager().getEngineByName("nashorn");
eng.eval("1 + 2");                       // last expr returned
Bindings b = eng.createBindings();       // inject Java values
((Invocable) eng).invokeFunction("fn", args);
// JVM boundary inside JS: Java.type('java.util.HashMap'), Java.asJSONCompatible,
//   Java.to(arr, "int[]"); load / loadWithNewGlobal from classpath:
```

**Current (mid-2026)** — the corpus's two highest-value examples are broken or fragile:

- **Nashorn is GONE from the JDK** (deprecated JDK 11 / removed JDK 15). On any 2026 LTS (17/21/25) `getEngineByName("nashorn")` returns null. Use the fork `org.openjdk.nashorn:nashorn-core` 15.7 (JPMS, needs ASM) or **GraalJS / GraalVM Polyglot**.
- **Jython is still Python-2 only** (2.7.4); no production Jython-3 exists. Use **GraalPy 25.0.3** (Python 3.12-compliant, embeddable) or out-of-process Python 3 via `ProcessBuilder`.
- Plain `ProcessBuilder` / Commons Exec remain valid, modulo `python` vs `python3`.

## Full content

This domain's polyglot coverage (`language-interop`) is useful as *concept* but mostly broken as 2026-runnable code, because its two highest-value examples (Nashorn, Jython) target removed or stagnant runtimes.

**Java → Python** has four mechanisms (`python/JavaPythonInteropUnitTest.java:44-117`): (1) an external process via `ProcessBuilder`; (2) an external process via Apache Commons Exec (`CommandLine`/`DefaultExecutor`/`PumpStreamHandler`); (3) JSR-223 via `ScriptEngineManager().getEngineByName("python")` (Jython-backed); and (4) the in-process Jython `PythonInterpreter` (`exec` to run code, `get(name)` returning a `PyObject` you read with `.asInt()`, `setOut(writer)` to redirect output, errors surfacing as `PyException`).

**Java ↔ JavaScript via Nashorn** (`javascript/NashornUnitTest.java:53-108`) uses JSR-223 (JDK 8-14): basic `eval` returns the last expression; `Bindings` inject Java values; `Invocable.invokeFunction` calls named JS functions; the JVM boundary is crossed inside JS with `Java.type('java.util.HashMap')`, `Java.asJSONCompatible`, and `Java.to(arr, "int[]")`; `load`/`loadWithNewGlobal` load scripts from `classpath:`. Nashorn extensions (`for each`, conditional-catch `catch (e if ...)`, `__noSuchProperty__`/`__noSuchMethod__`, `print`/`trimLeft`/`__FILE__`) are non-standard.

**Environment fragility** is pervasive even in 2021: `ProcessBuilder("python", ...)` assumes a Python-2-era `python` binary on PATH (often `python3`-only now); the error test asserts the exact Jython Py2 string `"ImportError: No module named syds"` (Py3 says `ModuleNotFoundError`); `resolvePythonScriptPath` only resolves from the module root; and the Nashorn `script.js`/`math_module.js` use non-standard Nashorn/Mozilla extensions.

### 2026 currency

- **Nashorn is gone from the JDK** — deprecated in JDK 11 (JEP 335), removed in JDK 15 (JEP 372). On any 2026 LTS (17/21/25) `getEngineByName("nashorn")` returns null and `NashornUnitTest` NPEs on the first eval. The standalone fork is `org.openjdk.nashorn:nashorn-core` 15.7 (a JPMS module needing ASM on the module path); GraalJS / GraalVM polyglot is the other JS-on-JVM path. [openjdk/nashorn](https://github.com/openjdk/nashorn)
- **Jython is still Python-2 only** — latest is 2.7.4 (`org.python:jython`), supported on Java 8 (min) and 11; the project warns Python 2.7 is not an alternative to porting to Python 3, and no production Jython-3 exists as of mid-2026. **GraalPy 25.0.3 (2026-05-21)** — Python 3.12-compliant, embeddable — is the modern in-process successor. [oracle/graalpython](https://github.com/oracle/graalpython)
- **GraalVM is the modern polyglot substrate** — the structural replacement for the Nashorn+Jython story: GraalPy (embeddable via `python-embedding`), GraalJS for JS, over the GraalVM Polyglot API, plus native-image (AOT). [GraalVM Embedding Languages](https://www.graalvm.org/latest/reference-manual/embed-languages/)
- **`javax.script.*` (JSR-223) is NOT affected by javax→jakarta** — it is the JDK `java.scripting` module, not Jakarta EE, so the package name stays current. The Nashorn *engine* (not the package) is the problem; the "python" engine still needs Jython on the classpath. [Why Spring matters to Jakarta EE (Eclipse)](https://newsroom.eclipse.org/eclipse-newsletter/2024/march/why-spring-matters-jakarta-ee-and-vice-versa)
- **Compact source files / instance `main()` (JEP 512, Java 25)** make single-file scriptable Java first-class, narrowing the scripting gap Jython/Nashorn once filled. [Java 25 features](https://keyholesoftware.com/java-25-whats-new/)
