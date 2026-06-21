---
kb_id: java-stdlib/math-and-numerics
version: 1
tags:
  - java-stdlib
  - math
  - numerics
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-lang-math{,-2,-3}, java-numbers{,-2,-3,-4}"
  - "JEP 306: Restore Always-Strict Floating-Point Semantics (https://openjdk.org/jeps/306)"
related:
  - java-stdlib/arrays
  - java-stdlib/strings
  - java-stdlib/string-algorithms
  - java-stdlib/java-time
status: active
---

## Summary

**Concept**: `java.lang.Math`, exact/overflow-aware arithmetic, `BigDecimal`/`BigInteger` precision, NaN/floating-point hazards, bit-twiddling, and numeric formatting.
**Key APIs**: `Math.addExact`/`multiplyExact`/`floorDiv`/`floorMod`; `BigDecimal.setScale` + `RoundingMode`; `Double.isNaN`; `DecimalFormat`/`NumberFormat`; `& 0xff`; `compareUnsigned`/`divideUnsigned`.
**Gotcha**: `new BigDecimal(double)` captures float imprecision (use the String-arg ctor / `valueOf`); `NaN == NaN` is false; integer overflow wraps silently (`MAX_VALUE+1 == MIN_VALUE`); `Math.sin(30)` treats 30 as radians.
**2026-currency**: `strictfp` is a no-op since JDK 17 (JEP 306); `Math.clamp` (JDK 21); `RandomGenerator`/`RandomGeneratorFactory` (JEP 356, JDK 17).
**Sources**: Baeldung `core-java-lang-math*` + `java-numbers*`.

## Quick Reference

**Exact (overflow-throwing) arithmetic — Java 8:**

```java
Math.addExact(a, b);  Math.multiplyExact(a, b);   // throw ArithmeticException on overflow
Math.floorDiv(a, b);  Math.floorMod(a, b);        // floor semantics differ from % for negatives
// silent: a + b wraps (MAX_VALUE + 1 == MIN_VALUE)
```

**Precise decimals — NEVER `new BigDecimal(double)`:**

```java
new BigDecimal(Double.toString(v));   // ✅ String-arg ctor
BigDecimal.valueOf(v);                // ✅
v.setScale(2, RoundingMode.HALF_UP);  // RoundingMode enum, not the deprecated BigDecimal.ROUND_* ints
// new BigDecimal(0.1) → 0.1000000000000000055511151231257827021181583404541015625  ⚠️
```

**Floating-point & overflow hazards:**

- `NaN == NaN` is **false** — detect with `Double.isNaN(x)` or `x != x`.
- Double addition is **non-associative** (`a+b+c != a+c+b`).
- Integer `/0` throws `ArithmeticException`; float `/0` → Infinity/NaN.
- Narrowing casts wrap modulo (`(int)Long.MAX_VALUE == -1`); `(int)` truncation silently overflows out-of-range doubles.
- `long` factorial overflows past ~20! → use `BigInteger`.
- `Math.sin(30)` treats 30 as **radians** — use `Math.toRadians`.

**Bit-twiddling & unsigned:** `& 0xff` undoes byte sign-extension when widening (`(byte)0xff == -1`; RGBA channel extraction); `compareUnsigned`/`divideUnsigned`/`parseUnsignedInt`/`toUnsignedString`; binary literals `0b101` + `Integer.toBinaryString`/`parseInt(s,2)`.

**Formatting:** `DecimalFormat`/`DecimalFormatSymbols`/`NumberFormat` (percent/currency/grouping, locale-aware).

**Math surface:** abs/max/min/signum/pow/sqrt/cbrt/exp/log/log10, trig + `toDegrees`/`toRadians`, ceil/floor/rint/round, hypot; custom log to any base = `log(n)/log(base)`.

**Current (mid-2026):** `strictfp` is a no-op (JEP 306, JDK 17 — FP is always strict); `Math.clamp(v,min,max)` (JDK 21) replaces `Math.max(min, Math.min(max, v))`; `RandomGenerator`/`RandomGeneratorFactory` (JEP 356, JDK 17) replace third-party PRNGs.

## Quick Reference (continued)

**Algorithm catalogue (corpus):** factorial (×7, `BigInteger` past 20!), combinations (n-choose-r), GCD (Euclid/Stein)/LCM, primes (Sieve, 6k±1, `BigInteger.isProbablePrime`, Apache `Primes.isPrime`), Fibonacci (recursive/iterative/Binet), power set (bitmask/Gray code), perfect-square, nth-root, geometry (distance/`hypot`/intersection/Mercator), matrix multiply, probability (Bernoulli + Apache `NormalDistribution`), random (`Random`/`ThreadLocalRandom`/`SplittableRandom`/`SecureRandom`), `BigInteger` two's-complement.

## Full content

`java.lang.Math` is the static numeric toolbox: absolute value, min/max/signum/copySign, power/root/exp/log families, full trigonometry with `toDegrees`/`toRadians`, rounding (ceil/floor/rint/round), `hypot`, and `IEEEremainder`. A log to an arbitrary base is `log(n)/log(base)`. Java 8 added exact arithmetic that *throws* on overflow (`addExact`/`subtractExact`/`multiplyExact`/`incrementExact`/`decrementExact`/`negateExact`) and floor-semantics division (`floorDiv`/`floorMod`, which differ from `%` for negative operands).

The precision hazards are the high-value lessons. Integer arithmetic wraps silently on overflow (`Integer.MAX_VALUE + 1 == Integer.MIN_VALUE`), so use `addExact`/`multiplyExact` or `BigInteger` when overflow is possible (`long` factorial overflows past ~20!). For exact decimal arithmetic, never use `new BigDecimal(double)` — it captures the binary float's imprecision — but instead the String-arg constructor (`new BigDecimal(Double.toString(v))`) or `BigDecimal.valueOf`, and round via `setScale(n, RoundingMode.HALF_UP)` using the `RoundingMode` enum (the `BigDecimal.ROUND_*` int constants are deprecated). Floating-point is non-associative (`a+b+c != a+c+b`), `NaN` compares unequal to itself (detect with `Double.isNaN` or `x != x`), integer division by zero throws while float division by zero yields Infinity/NaN, and narrowing casts wrap modulo. `Math.sin(30)` treats 30 as radians.

Bit-level work uses `& 0xff` to undo byte sign-extension when widening to int (a `byte` of `0xff` is `-1`; the mask recovers `255`, used for RGBA channel extraction), the unsigned operations (`compareUnsigned`/`divideUnsigned`/`parseUnsignedInt`/`toUnsignedString`), and binary literals (`0b101`) with `Integer.toBinaryString`/`parseInt(s,2)`. Locale-aware numeric formatting is `DecimalFormat`/`DecimalFormatSymbols`/`NumberFormat` (percent/currency/grouping). The corpus also carries a large hand-rolled algorithm catalogue (factorial, combinations, GCD/LCM, primes, Fibonacci, power set, geometry, matrix multiply, probability, random generators).

### 2026 currency

- **`strictfp` is now a no-op** — JEP 306 (delivered JDK 17) restored always-strict floating-point semantics, so all FP ops are strict by default and `javac` warns on a redundant `strictfp`. The corpus's `strictfp` example is redundant on JDK 17+. [JEP 306: Restore Always-Strict Floating-Point Semantics](https://openjdk.org/jeps/306) · [Oracle — Significant Changes in JDK 17](https://docs.oracle.com/en/java/javase/24/migrate/significant-changes-jdk-17.html)
- **`Math.clamp()` (JDK 21)** — `Math.clamp(value, min, max)` for `int`/`long`/`double`/`float` replaces the hand-rolled `Math.max(min, Math.min(max, v))` idiom. [Oracle — Math (Java SE 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Math.html)
- **`RandomGenerator`/`RandomGeneratorFactory` (JEP 356, JDK 17)** — the modern PRNG API and built-in successor to dsiutils `XoRoShiRo128PlusRandom`: a uniform interface, splittable/jumpable sub-interfaces, the LXM algorithm family, and `RandomGeneratorFactory.of("Xoroshiro128PlusPlus")`. `java.util.Random` now `implements RandomGenerator`; no third-party lib needed. [JEP 356: Enhanced Pseudo-Random Number Generators](https://openjdk.org/jeps/356)
- **Wrapper boxing constructors** (`new Integer`/`new Double`/`new Character`) are deprecated but **no longer removal-track** — JDK 25 reverted the `forRemoval` status (JDK-8354338). Keep using `valueOf`/`parseX`/autoboxing; the "scheduled for removal" framing is stale. [JDK-8354338](https://bugs.openjdk.org/browse/JDK-8354338)
- **Nashorn removed (JDK 15, JEP 372)** — the `core-java-lang-math-3` JSR-223 `getEngineByName("JavaScript")` math-expression examples fail on modern JDKs; use GraalJS instead. [JEP 372: Remove the Nashorn JavaScript Engine](https://openjdk.org/jeps/372) · [GraalVM — Nashorn migration guide](https://www.graalvm.org/latest/reference-manual/js/NashornMigrationGuide/)
- **Apache Commons Math3 is maintenance-only** — successors are commons-numbers / commons-statistics / commons-rng / Hipparchus. [Apache Commons RNG](https://commons.apache.org/proper/commons-rng/) · [Hipparchus](https://www.hipparchus.org/)
- The `java.math` arithmetic, `RoundingMode` enum, NaN/overflow semantics, and bit-masking idioms carry forward unchanged.
