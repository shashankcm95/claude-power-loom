---
kb_id: build-devops/dev-tooling-docs
version: 1
tags:
  - build-devops
  - dev-tooling
  - docs-as-code
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jgit, intelliJ, jenkins, asciidoctor, structurizr, linux-bash"
  - "Nathan Berg — Supply Chain Security in CI: SBOMs, SLSA, Sigstore (https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/)"
related:
  - build-devops/supply-chain-security
status: active
---

## Summary

**Concept**: developer-tooling extension points and docs-as-code — programmatic Git, IDE/CI plugin authoring, architecture diagrams-as-code, AsciiDoc rendering, and Bash scripting that glues build pipelines together.
**Key APIs**: JGit (`Git.init()/.add()/.commit()/.tag()/.log()`, `FileRepositoryBuilder`, `RevWalk`); IntelliJ (`AnAction`/`actionPerformed`/`plugin.xml`/PSI); Jenkins (`BuildWrapper`/`@Extension`/`@DataBoundConstructor`/`FilePath`); Structurizr C4 model; Asciidoctor; Bash `jq`/`read`/loops/parameter-expansion.
**Gotcha**: Jenkins `BuildWrapper` is Freestyle-only (pre-Pipeline) and must use `FilePath` not `File` for remote agents; Bash `find | while read` runs the body in a subshell (variables don't survive); `${var%.*}` strips ONE extension (`.tar.gz` needs `%%`).
**2026-currency**: Jenkins `BuildWrapper` is dated (modern Jenkins uses Pipeline/`SimpleBuildStep`); Structurizr `structurizr-analysis` auto-discovery is dropped (use the DSL); GitHub Actions is the de facto CI replacing the legacy Jenkins-plugin model.
**Sources**: Baeldung `jgit`/`intelliJ`/`jenkins`/`asciidoctor`/`structurizr`/`linux-bash`; Nathan Berg CI supply-chain.

## Quick Reference

**Programmatic Git (JGit)**:
- Porcelain: `Git.init().setDirectory(dir).call()`, `git.add().addFilepattern(".").call()`, `git.commit().setMessage(...).setAll(true).call()` (stages tracked modifications only — new files need explicit `add`), `git.tag().setName(...).setAnnotated(true).setObjectId(commit)`, `git.log().add(id)/.all()/.addPath("README.md")`.
- Plumbing: `FileRepositoryBuilder().setGitDir(...).readEnvironment().findGitDir().build()`; `RevWalk.parseCommit(id)`. Try-with-resources on `Git`/`Repository` (both `AutoCloseable`).

**IDE/CI plugin authoring**:
- **IntelliJ**: `class X extends AnAction { void actionPerformed(AnActionEvent e){...} }`; `update(e)` gates visibility; read context via `e.getRequiredData(CommonDataKeys.EDITOR/PSI_FILE)`; register in `plugin.xml` `<actions>` `<add-to-group group-id="ToolsMenu" anchor="last"/>`. Gradle build via `id 'org.jetbrains.intellij'`.
- **Jenkins**: `ProjectStatsBuildWrapper extends BuildWrapper`; `setUp(...)` returns an `Environment` whose `tearDown(...)` runs post-build; `@Extension static class DescriptorImpl extends BuildWrapperDescriptor`; `@DataBoundConstructor`. Walk the workspace with agent-safe `hudson.FilePath` (never `java.io.File`). `<packaging>hpi</packaging>`.

**Docs-as-code**:
- **Asciidoctor** (`AsciidoctorJ` → HTML/PDF; `asciidoctor-maven-plugin` build-time PDF).
- **Structurizr** (C4 diagrams-as-code: model → views → styles → PlantUML export; Spring-stereotype component auto-discovery).

**Bash scripting** (`linux-bash`): `jq` (JSON filter — `select`/`map`/`del`/reshape); directory loops (`*/` vs `find | while read`); the `read` builtin (IFS, `-s`/`-p`/`-a`/`-N`/`-t`/`-u`, `select` menus); text append (`printf`/heredoc/`tee -a`) and parameter-expansion stripping (`%` shortest vs `%%` longest).

**Top gotchas**:
- Jenkins `BuildWrapper` over `AbstractBuild` is Freestyle-only; must use `FilePath` for remote agents; manual HTML template string-replace has no escaping (XSS).
- Bash `find | while read` / `ls | { ... }` run the body in a subshell — variables don't survive. `find -printf` is GNU-only; `echo -e` is non-portable (prefer `printf`); `${var%.*}` strips one extension.
- Structurizr `SourceCodeComponentFinderStrategy(new File("."), ...)` resolves relative to cwd.

**Current (mid-2026)**: modern Jenkins is Pipeline/`SimpleBuildStep` (the `BuildWrapper` model is dated); Structurizr `structurizr-analysis` auto-discovery is dropped → use the DSL; GitHub Actions is the de facto CI.

## Full content

This cluster collects the developer-tooling extension points and the docs-as-code + shell glue around a build. It is the thinnest-covered part of the domain (several modules are doc-only), but the durable concepts — programmatic Git, plugin extension points, C4 modeling, and Bash idioms — carry forward.

### Programmatic Git and plugin extension points

JGit exposes both a porcelain `Git` API (init/add/commit/tag/log) and lower-level plumbing (`FileRepositoryBuilder`, `RevWalk`, `Ref`/`ObjectId`), with try-with-resources on the `AutoCloseable` repo objects. IDE/CI plugins follow each host's extension model: IntelliJ's `AnAction` + `plugin.xml` + PSI/editor context, and Jenkins's `BuildWrapper` + `@Extension`/`DescriptorImpl`/`@DataBoundConstructor` with agent-safe `FilePath`. The Jenkins example is the legacy Freestyle model — the corpus has no Pipeline or Jenkinsfile.

### Docs-as-code and Bash

Asciidoctor renders AsciiDoc to HTML/PDF at build time; Structurizr models C4 architecture diagrams as code (model → views → styles → PlantUML). Bash is covered thoroughly — `jq` as a JSON filter language, directory loops, the `read` builtin (very deep), and text/parameter-expansion manipulation. The recurring Bash traps (subshell variable loss, GNU-only `find -printf`, non-portable `echo -e`, single-vs-double `%` extension stripping) are timeless.

### 2026 currency

- **Jenkins `BuildWrapper` is dated** — modern Jenkins uses Pipeline / `SimpleBuildStep` / Jenkinsfile; the corpus's Freestyle `BuildWrapper` plugin model is legacy, and **GitHub Actions is now the de facto OSS CI** (workflow YAML under `.github/workflows/`). [Nathan Berg — Supply Chain Security in CI](https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/)
- **Structurizr `structurizr-analysis`** (`ComponentFinder`/`SpringComponentFinderStrategy`/`SourceCodeComponentFinderStrategy`) was dropped in later releases; the auto-discovery demo won't compile → use the Structurizr DSL or a hand-written model. (Sourced from the base's freshness verdict; not independently re-verified at mid-2026.)
- **`javax.annotation.Nonnull`/`Resource` → `jakarta.*`** in the Jenkins and Structurizr modules under Jakarta EE 9+; old JGit (4.5) and client pins should be bumped. The C4 model and JGit/Bash concepts carry forward unchanged. [Nathan Berg — Supply Chain Security in CI](https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/)
