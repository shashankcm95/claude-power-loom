---
kb_id: web-ui/javafx-desktop-ui
version: 1
tags:
  - web-ui
  - javafx
  - desktop
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: javafx"
  - "OpenJFX highlights / JavaFX 25 (openjfx.io/highlights/25)"
related:
  - web-ui/forms-validation-binding
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: JavaFX desktop GUI — a declarative FXML view + a controller + an observable model, the JVM's rich-client UI toolkit. The corpus's only non-web UI module (a desktop counterpart to the server-side-UI frameworks), demonstrating property binding and off-thread background work.
**Key APIs**: `Application.start(Stage)`, `FXMLLoader`, `@FXML` fields + `initialize()`; observable model via `SimpleStringProperty` + `xxxProperty()`, `ObservableList` + `PropertyValueFactory("propName")`; off-UI-thread work via `javafx.concurrent.Task<T>` on a daemon `Thread` with UI updates only in `setOnSucceeded`.
**Gotcha**: `PropertyValueFactory("isEmployed")` must align with the JavaBean accessor (`getIsEmployed()`/`isEmployedProperty()`) or the column renders blank; UI may only be mutated on the JavaFX Application Thread — background work updates UI only via `setOnSucceeded`.
**2026-currency**: JavaFX has not been bundled with the JDK since JDK 11 (split out as OpenJFX); the empty-dependency pom only works on JDK 8-10; JDK 11+ needs explicit `org.openjfx:javafx-*` deps + `--module-path`.
**Sources**: Baeldung `javafx`; OpenJFX highlights.

## Quick Reference

**App skeleton**:
- `class Main extends Application { void start(Stage stage) { Parent root = FXMLLoader.load(...); stage.setScene(new Scene(root)); stage.show(); } }`.
- The FXML view declares the UI; the controller has `@FXML`-annotated fields wired by `fx:id` and an `initialize()` callback run after FXML load.

**Observable model**:
- Properties: `private final StringProperty name = new SimpleStringProperty(...)` + a `nameProperty()` accessor.
- Tables: an `ObservableList<Person>` as the items; each column's `setCellValueFactory(new PropertyValueFactory<>("propName"))`.

**Off-thread background work**:
- `Task<T> task = new Task<>() { protected T call() {...} };` run on a **daemon** `Thread`.
- Update the UI only in `task.setOnSucceeded(e -> ...)` (which runs back on the FX Application Thread) — never touch UI from `call()`.

**Top gotchas**:
- **PropertyValueFactory name match**: `PropertyValueFactory("isEmployed")` must align with the bean accessor (`getIsEmployed()`/`isEmployedProperty()`) or the column renders blank — a silent magic-by-name failure.
- **Thread affinity**: the scene graph may only be mutated on the JavaFX Application Thread; that's why `Task` updates UI via `setOnSucceeded`, not from `call()`.
- The module is a single searchable-table demo — no FXML-heavy multi-screen app, no charts/animation/media.

**Current (mid-2026)**: **JavaFX is no longer bundled with the JDK since JDK 11** — it ships separately as OpenJFX. This module's **empty-dependency pom only works on JDK 8-10**; on JDK 11+ it needs explicit `org.openjfx:javafx-controls` deps + `--module-path`. Current LTS lines are **JavaFX 21 and 25**, latest non-LTS [JavaFX 26 (Mar 2026)](https://openjfx.io/highlights/26/). The property/`Task` model itself carries forward unchanged.

## Full content

JavaFX is the JVM's rich-client desktop UI toolkit, and the corpus's only non-web UI module — a desktop counterpart that shares the "build the UI in Java" spirit of the server-side-UI frameworks (Vaadin/GWT) but renders to a native window rather than a browser.

### Application, FXML, controller

A JavaFX app subclasses `Application` and overrides `start(Stage)`, which loads an FXML view via `FXMLLoader`, wraps it in a `Scene`, and shows the `Stage`. The view is declarative FXML; its controller exposes `@FXML`-annotated fields (wired from `fx:id` in the FXML) and an `initialize()` method invoked after the FXML is loaded — the place to seed table data and wire listeners.

### Observable model and table binding

JavaFX data binding is built on observable properties: a model exposes `SimpleStringProperty`/`SimpleIntegerProperty` fields with `xxxProperty()` accessors so the UI can observe changes. Tables bind to an `ObservableList<T>` of model rows, and each `TableColumn`'s `setCellValueFactory(new PropertyValueFactory<>("propName"))` reflectively pulls the named property. The magic-by-name trap: `PropertyValueFactory("isEmployed")` must match the bean accessor (`getIsEmployed()` / `isEmployedProperty()`) exactly, or the column silently renders blank.

### Off-thread work with Task

The scene graph has strict thread affinity — only the JavaFX Application Thread may mutate UI. To do background work (e.g. a search), the corpus uses `javafx.concurrent.Task<T>` run on a *daemon* `Thread`; the long-running logic lives in `call()` (off the UI thread), and UI updates happen in `setOnSucceeded(...)`, which the framework dispatches back onto the Application Thread. Touching UI directly from `call()` is the classic JavaFX threading bug. This is a clean demonstration of the producer/consumer thread-handoff pattern; the module itself is a single searchable-table demo (no charts, animation, media, or multi-screen FXML).

### 2026 currency

- **JavaFX unbundled from the JDK since JDK 11.** It ships separately as **OpenJFX**; new use needs explicit `org.openjfx:javafx-*` dependencies plus a module path. The teaching module's **empty-dependency pom only works on JDK 8-10** — a strong freshness flag.
- **Current LTS lines are JavaFX 21 and 25**, with the latest non-LTS being [JavaFX 26 (Mar 2026)](https://openjfx.io/highlights/26/).
- The **property/observable + `Task` model carries forward unchanged** — the concepts are current; only the packaging and build setup changed. JavaFX is a desktop toolkit and does not use the `javax.*` servlet/CDI stack, so the `javax→jakarta` migration is largely orthogonal here (the broader caveat is the JDK-bundling/module-path change).
