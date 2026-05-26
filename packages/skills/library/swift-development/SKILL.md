---
name: swift-development
description: Specialist skill for the 06-ios-developer HETS persona. Swift / SwiftUI / iOS conventions, value-type-first design, observable patterns, async/await idioms, and platform-specific testing. Loaded on demand via the Skill tool.
---

# Swift Development

Specialist skill for the `06-ios-developer` HETS persona (and any other persona that needs Swift expertise). Loaded on demand via the `Skill` tool when the spawn prompt lists `swift-development` as required.

## When to use this skill

Trigger when:
- Reading or writing Swift source code (`.swift` files)
- Reviewing iOS / macOS / watchOS / tvOS / visionOS implementations
- Debugging crashes, memory issues, or build failures in an Apple platform target
- Discussing API design where Swift idioms matter (structured concurrency, value types, protocols)

**Skip** when the file is Objective-C (`.m`, `.h`), the discussion is platform-agnostic (e.g., generic algorithm design), or the task is iOS-platform-not-language (e.g., App Store metadata).

## Core competencies

### Language idioms

- **Value types first**: `struct`, `enum`, `Codable`. Use `class` only for identity / reference semantics / explicit lifecycle.
- **Optionals**: never force-unwrap (`!`) in production paths. Use `guard let`, `if let`, `??`, optional chaining (`?.`).
- **Error handling**: `throws` + `do-catch` is the default; `Result<T, E>` for explicit error values in async callbacks (legacy code).
- **Generics + protocols**: protocol extensions provide default implementations; protocol-oriented design over class inheritance.
- **Concurrency**: `async`/`await`, `Task`, `actor`, `@MainActor`. GCD (`DispatchQueue`) only for narrow cases (legacy interop, performance-critical timing).

See `kb:mobile-dev/swift-essentials` for the full reference.

### Project structure

- **SPM packages** for modular boundaries. Once a codebase exceeds ~10K LOC, split into packages with clear directional dependencies.
- **Xcode workspace** for multi-package + executable apps.
- **Schemes**: per-feature schemes for incremental development; release scheme with optimizations.

### Build + dependency management

- **Swift Package Manager** is the default. CocoaPods is legacy. Carthage is rare.
- `Package.swift` manifest is Swift code — readable + diff-able.
- Lock dependencies via `Package.resolved` (commit it).
- Binary frameworks via `.binaryTarget` for closed-source dependencies.

### Memory + performance

- **ARC**: every reference type is reference-counted automatically.
- **Retain cycles**: `[weak self]` in escaping closures; `weak var delegate` in delegate properties.
- **Memory Graph Debugger**: Xcode → Debug → Show Memory Graph. Visualizes object graph + flags strong cycles.
- **Instruments**: Time Profiler for CPU, Allocations for heap, Leaks for cycles, Network for HTTP.

### Testing

- **XCTest**: unit tests, UI tests. Run via `xcodebuild test` or in Xcode.
- **swift-testing** (Swift 6+): newer testing framework with better expressiveness; `@Test` macro.
- **Snapshot tests**: `swift-snapshot-testing` for visual regression on SwiftUI views.

### Common pitfalls to flag in code review

| Pattern | Why it's a problem |
|---------|---------------------|
| `let x = optional!` in production code | Crashes on `nil`. Use `guard let` or `??` |
| Closure captures `self` without `[weak self]` (escaping context) | Retain cycle |
| `DispatchQueue.main.async` inside `@MainActor` function | Redundant; hides intent |
| `force-try` (`try!`) outside test code | Crashes on throw |
| `String` dictionary keys | No compile-time safety; use `enum` |
| Mutable state on `class` accessed from multiple threads | Race condition; use `actor` |
| Implicitly-unwrapped optional (`Foo!` type) outside `@IBOutlet` | Pretends to be non-optional; crashes on use |

## Recommended invocation pattern

When spawned with `swift-development` as a required skill:

1. Invoke this skill first: `Skill swift-development`
2. Read the persona-mapped KB docs (e.g., `kb:mobile-dev/swift-essentials`, `kb:mobile-dev/ios-app-architecture`)
3. Begin the actual task
4. Cite this skill in the output's "Skills used" section so the verifier's `invokesRequiredSkills` check (planned for H.2.6) can confirm

## Out of scope for this skill

- SwiftUI specifics — covered by `swiftui` skill (planned for H.2)
- Xcode-specific debugging tooling — covered by `xcode-debugging` skill (planned for H.2)
- App Store submission, code-signing, provisioning profiles — covered by `app-store-deployment` skill (planned for H.2)
- Core Data schema design + migrations — covered by `core-data` skill (planned for H.2)

If your task needs any of the above and the skill isn't yet authored, surface it in your output's "Notes" section so the orchestrator can decide whether to bootstrap the skill (per `kb:hets/spawn-conventions` and the `skill-bootstrapping` pattern) or proceed without.

## Related skills

- `review` (general code-review framework)
- `security-audit` (relevant for apps handling auth, payments, or user data)
- `research-mode` (for verifying claims about Apple frameworks against Apple's docs)
