---
kb_id: mobile-dev/swift-essentials
version: 1
tags: [mobile, ios, swift, language]
---

## Summary

Swift essentials for HETS mobile-dev personas: value types (`struct`, `enum`) over reference types (`class`); optionals + `guard let` / `if let` over force-unwrap; `Result<T, E>` and `throws` for fallible APIs; structured concurrency (`async`/`await`, `Task`, actors) over GCD/completion handlers; protocols + extensions over inheritance; `@MainActor` for UI work; `Codable` for JSON; ARC + `[weak self]` in escaping closures.

## Full content

### Value vs reference semantics

Default to `struct` for data. Use `class` only when you need:
- Identity (two instances are distinct entities, not just equal values)
- Reference semantics (mutating one variable affects all references)
- Inheritance (rare in modern Swift; prefer protocols)
- Deinit / explicit lifecycle

`enum` with associated values models exhaustive choice. `enum` with raw values models identifier sets.

### Optionals

Force-unwrap (`!`) is a runtime crash on `nil`. In production code, replace with:
- `guard let x = optional else { return ... }` for early-exit
- `if let x = optional { ... } else { ... }` for branch
- `optional ?? defaultValue` for fallback
- `optional?.method()` for chained no-op-on-nil

Implicitly-unwrapped optionals (`Foo!` type) are a code smell outside `@IBOutlet`.

### Error handling

Two flavors:
- `throws` + `try` / `do-catch` — synchronous, statically declared error
- `Result<Success, Failure>` — explicit value, useful for async callbacks (legacy) or when errors propagate through closures

Don't use `try!` (force-try) outside throwaway prototypes.

### Concurrency (Swift 5.5+)

`async`/`await`:
```swift
func fetchUser() async throws -> User {
    let data = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode(User.self, from: data.0)
}
```

`Task` for top-level concurrency:
```swift
Task {
    let user = try await fetchUser()
    await MainActor.run { self.label.text = user.name }
}
```

`actor` for shared mutable state:
```swift
actor Counter {
    private var value = 0
    func increment() { value += 1 }
    func get() -> Int { value }
}
```

`@MainActor` annotation marks UI-touching code. ViewModels exposed to SwiftUI views are usually `@MainActor`.

### Memory: ARC + retain cycles

Every closure that captures `self` is a retain-cycle suspect. Three patterns:
- `[weak self]` — `self` becomes optional inside the closure; use `guard let self else { return }`
- `[unowned self]` — `self` is non-optional; crashes if `self` is deallocated. Use only when lifetimes are guaranteed.
- No capture list — fine for non-escaping closures (`map`, `filter`, etc.)

Cycle detection: Xcode's Memory Graph Debugger (Debug menu → Show Memory Graph).

### Protocols + extensions

Protocols define capability; extensions add implementation. Composition pattern:
```swift
protocol Animatable { func animate() }
extension Animatable where Self: UIView { /* default impl */ }
```

Don't use class inheritance for code reuse — use protocol extensions or composition.

### Codable

JSON ↔ Swift via `Codable`. Custom keys via `CodingKeys`:
```swift
struct User: Codable {
    let id: UUID
    let displayName: String
    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}
```

For non-trivial decoding, implement `init(from decoder: Decoder)` directly.

### Common pitfalls (flag in code review)

- Force-unwrap in production paths (`let x = optional!`)
- Closure capturing `self` without `[weak self]` in escaping context (UIKit / Combine / Network)
- Sync work on `MainActor` that should be `async let` or `Task.detached`
- Strong references between view controllers and their delegates (use `weak var delegate`)
- `DispatchQueue.main.async` inside an `@MainActor` context (already on main; redundant + can hide bugs)
- `String` keys to dictionary instead of typed enum cases (loses compile-time safety)
- Mutable state on a `class` accessed from multiple threads without an actor or lock

### Related KB docs (planned)

- `kb:mobile-dev/swiftui-essentials` — SwiftUI specifics
- `kb:mobile-dev/ios-app-architecture` — MVVM, TCA, modular packages
- `kb:mobile-dev/xcode-build-system` — schemes, configurations, package management
