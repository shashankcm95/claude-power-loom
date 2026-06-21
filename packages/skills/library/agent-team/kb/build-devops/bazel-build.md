---
kb_id: build-devops/bazel-build
version: 1
tags:
  - build-devops
  - bazel
  - build-systems
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: bazel"
  - "Bazel — Bzlmod Migration Guide (https://bazel.build/external/migration)"
related:
  - build-devops/maven-build
  - build-devops/gradle-build
status: active
---

## Summary

**Concept**: Bazel — Google's hermetic, package-graph build system: a `WORKSPACE` root + per-package `BUILD` files declare targets via rules with explicit, label-addressed dependencies and visibility allow-listing.
**Key APIs**: `java_library` / `java_binary` (`main_class`), `glob()` source enumeration, cross-package labels (`//pkg:target`), `visibility`, external deps via `rules_jvm_external` `maven_install` → `@maven//:...` mangled labels, `http_jar`/`http_archive`.
**Gotcha**: external-artifact labels are underscore-mangled coordinates (`@maven//:org_apache_commons_commons_lang3`); the corpus project dual-builds under both Bazel and Maven.
**2026-currency**: WORKSPACE is DEAD — off-by-default in Bazel 8 (EOY 2024), removed in Bazel 9 (Jan 2026); `MODULE.bazel` (Bzlmod) is mandatory, `rules_jvm_external`'s `maven.install` now invoked from there.
**Sources**: Baeldung `bazel` module; Bazel Bzlmod Migration Guide.

## Quick Reference

**The model**:

- **`WORKSPACE`** (workspace root marker) — historically declared external dependencies.
- **`BUILD`** (one per package) — declares targets via rules.
- **Rules**: `java_library(name=..., srcs=glob([...]), visibility=["//bazelapp:__pkg__"])`, `java_binary(name=..., main_class="...", deps=[...])`.
- **Labels**: cross-package deps addressed as `//pkg:target`; external artifacts as `@maven//:...` (underscore-mangled coordinates).
- **Source enumeration**: `glob([...])` rather than wildcards.
- **Visibility**: explicit allow-listing — a target is private to its package unless `visibility` opens it.

```python
java_binary(
    name = "app",
    srcs = glob(["*.java"]),
    main_class = "com.baeldung.App",
    deps = ["//bazelgreeting:greeter", "@maven//:org_apache_commons_commons_lang3"],
)
java_library(name = "greeter", visibility = ["//bazelapp:__pkg__"])
```

**External deps (legacy `WORKSPACE`)**: `maven_install(artifacts=[...], repositories=[...])` from `rules_jvm_external`; plus `http_jar`/`http_archive`.

**Hermeticity**: dependencies are explicit and content-addressed → reproducible builds, fine-grained caching, and parallel execution. The dual-build demo shows the same project building under both Bazel and Maven.

**Current (mid-2026)**: `WORKSPACE` is removed. Declare external deps in **`MODULE.bazel`** via Bzlmod; `rules_jvm_external`'s `maven.install` is invoked there. Rules/labels/visibility concepts are unchanged.

## Full content

Bazel is the third build system in the corpus, contrasted against Maven and Gradle. Its defining property is hermeticity: every dependency is declared explicitly and addressed by label, which buys reproducible builds, fine-grained caching, and large-scale parallelism. The corpus demonstrates this with a project that builds under both Bazel and Maven (a dual-build demo).

### Workspace, packages, rules, labels

A Bazel tree is rooted by a `WORKSPACE` marker; each directory with a `BUILD` file is a package. Targets are declared with rules — `java_library` and `java_binary` (the latter taking `main_class`). Sources are enumerated with `glob()`. Dependencies are labels: `//pkg:target` for in-repo cross-package deps, `@maven//:...` for external artifacts (whose labels are underscore-mangled Maven coordinates). Visibility is allow-listed: targets are package-private unless `visibility` explicitly grants access.

### External dependencies

In the 2021 corpus, external deps came from `rules_jvm_external`'s `maven_install` declared in `WORKSPACE`, alongside `http_jar`/`http_archive` for raw artifacts. This external-dependency mechanism is the part that changed most.

### 2026 currency

- **Bazel WORKSPACE is dead; Bzlmod (`MODULE.bazel`) is mandatory.** WORKSPACE was off-by-default in **Bazel 8 (EOY 2024)** and removed in **Bazel 9 (Jan 2026)**. The base's `WORKSPACE`+`maven_install` external-deps model is stale; `rules_jvm_external`'s `maven.install` is now invoked from `MODULE.bazel`. The rules / labels / visibility concepts still hold. [Bazel — Bzlmod Migration Guide](https://bazel.build/external/migration) · [Bazel 8.0 LTS](https://blog.bazel.build/2024/12/09/bazel-8-release.html) · [Bazel 9.0.0 release (2026-01-20)](https://github.com/bazelbuild/bazel/releases/tag/9.0.0)
- **Carries forward unchanged** at the concept level: the rules/labels/visibility model is durable — what moved is the external-dependency *mechanism* (now `MODULE.bazel`), not the package-graph mental model. [Bazel — Bzlmod Migration Guide](https://bazel.build/external/migration)
