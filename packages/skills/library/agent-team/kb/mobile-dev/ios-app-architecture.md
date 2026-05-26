---
kb_id: mobile-dev/ios-app-architecture
version: 1
tags: [mobile, ios, architecture, mvvm, tca]
---

## Summary

iOS architecture choices for HETS mobile-dev personas: MVVM with SwiftUI is the modern default (clear separation of `View` / `ViewModel` / `Model`, `@StateObject` lifetime); The Composable Architecture (TCA) for complex apps with deep state; modular SPM packages for >10K-LOC codebases; coordinator pattern for navigation in UIKit-heavy apps; environment objects sparingly (global state surfaces as test friction).

## Full content

### Default architecture: MVVM + SwiftUI

The minimum viable iOS architecture for new apps:

- **Model**: pure data types (`struct` `Codable`), no UIKit/SwiftUI imports
- **ViewModel**: `@MainActor` `class` conforming to `ObservableObject`; holds `@Published` state; methods that mutate state. No `View` references.
- **View**: SwiftUI `View` struct; observes ViewModel via `@StateObject` (owned) or `@ObservedObject` (passed in)

Lifetime rules:
- `@StateObject` — view owns the ViewModel; lifetime tied to view's first appearance
- `@ObservedObject` — view doesn't own; ViewModel must outlive the view (parent owns)
- `@EnvironmentObject` — for app-global state; declarative dependency injection

Don't use `@StateObject` in a child view that's recreated on parent re-render; you'll lose state. Use `@ObservedObject` and have the parent own.

### When to use TCA (The Composable Architecture)

Reach for TCA when:
- App has ≥5 distinct features that share state (e.g., auth state, user prefs, sync status)
- Time-travel debugging matters (recordable / replayable user sessions)
- You need exhaustive testing of state transitions

TCA imposes structure (`Reducer`, `Action`, `State`, `Effect`) — overhead pays off at scale, hurts at small scale.

### Modular package boundaries (SPM)

Once codebase >10K LOC or build times >30s, split into Swift Package Manager packages:

```
App/
├── App.xcodeproj
└── Packages/
    ├── Networking/      (HTTP, GraphQL, WebSocket clients)
    ├── DesignSystem/    (colors, typography, reusable views)
    ├── Persistence/     (Core Data, Keychain, UserDefaults)
    ├── Features/
    │   ├── Auth/
    │   ├── Profile/
    │   └── Feed/
    └── Common/          (shared models, utilities)
```

Rule: **packages depend on more general packages** (Features → DesignSystem → Common; never the reverse). Circular deps fail to compile.

### Navigation patterns

**SwiftUI**: `NavigationStack` (iOS 16+) for stack-based; `TabView` for tabs; `.sheet` / `.fullScreenCover` for modals. Path-driven navigation via `@State var path: [Route]` enables deep-linking.

**UIKit**: Coordinator pattern for navigation. Each flow (e.g., onboarding, settings) gets a `Coordinator` class that owns the navigation controller and view controllers. Avoids the "massive view controller" antipattern.

**Hybrid**: SwiftUI views can be hosted in UIKit via `UIHostingController`; UIKit views can be wrapped in SwiftUI via `UIViewRepresentable` / `UIViewControllerRepresentable`.

### Persistence cascade

1. **`UserDefaults`** — small key-value pairs (settings, flags). Not for sensitive data.
2. **`Keychain`** — credentials, tokens, anything secret. Use a wrapper library.
3. **`Core Data`** — relational, queryable, cacheable. Default for offline-first apps.
4. **`SwiftData`** (iOS 17+) — Core Data with Swift macros, more ergonomic.
5. **`SQLite` directly (GRDB)** — when you need full SQL control.
6. **Cloud sync** — `CloudKit` for iCloud-only, third-party (Firebase, Supabase) for cross-platform.

### Testing layers

- **Unit tests**: ViewModels, business logic, data transformations. `XCTest` framework.
- **UI tests**: critical user flows. `XCUIApplication` driver. Slow + flaky; minimize count.
- **Snapshot tests**: SwiftUI views via `swift-snapshot-testing`. Catches unintended visual regressions.
- **Integration tests**: networking layer with stubbed responses (`URLProtocol` subclass).

### Common architecture mistakes (flag in review)

- ViewModel holding a reference to View (breaks SwiftUI's data flow; introduces retain cycles)
- Business logic in `View.body` (untestable; re-runs on every render)
- `@EnvironmentObject` for everything (hides dependencies; tests need full env setup)
- Singleton `class` with mutable state accessed from multiple threads (race condition)
- Using `Combine` and `async/await` interchangeably without a clear policy (cognitive overhead)
- Force-unwrapping Core Data fetch results (use `try` + handle empty)

### Related KB docs (planned)

- `kb:mobile-dev/swiftui-essentials`
- `kb:mobile-dev/core-data-patterns`
- `kb:mobile-dev/spm-package-design`
