---
kb_id: java-stdlib/java-time
version: 1
tags:
  - java-stdlib
  - datetime
  - jsr-310
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-date-operations-{1,2}, core-java-datetime-{conversion,string}, core-java-time-measurements"
  - "JEP 320: Remove the Java EE and CORBA Modules (https://openjdk.org/jeps/320)"
related:
  - java-stdlib/math-and-numerics
  - java-stdlib/strings
status: active
---

## Summary

**Concept**: `java.time` (JSR-310) date/time — the modern immutable API, the legacy `Date`/`Calendar` stack taught as "before," and the `Instant`+`ZoneId` conversion pivot.
**Key APIs**: `LocalDate`/`LocalDateTime`/`ZonedDateTime`/`OffsetDateTime`/`Instant`/`Duration`/`Period`/`ZoneId`/`Clock`; `ChronoUnit.between`; `DateTimeFormatter`; `Year.isLeap`/`datesUntil`.
**Gotcha**: `Period.getDays()` is only the day *component* — use `ChronoUnit.DAYS.between` for total days; `Calendar.MONTH` is 0-based vs `LocalDate.getMonthValue()` 1-based; `LocalDate`/`LocalDateTime` carry no zone.
**2026-currency**: `java.time` is current; `javax.xml.datatype` (`XMLGregorianCalendar`) stays in module `java.xml` (JAXP) — JEP 320 removed JAXB (`javax.xml.bind`) in Java 11, not JAXP; inject a `Clock` for testable "now."
**Sources**: Baeldung `core-java-date-operations*`/`core-java-datetime-*`/`core-java-time-measurements`.

## Quick Reference

**Modern types (immutable, JSR-310):**

| Type | Represents |
|---|---|
| `LocalDate` / `LocalDateTime` | date / date-time, **no zone** |
| `ZonedDateTime` / `OffsetDateTime` | zoned / fixed-offset date-time |
| `Instant` | a point on the UTC timeline |
| `Duration` / `Period` | time-based / date-based amount |
| `ZoneId` / `Clock` / `Year` / `DayOfWeek` | zone, testable clock, calendar parts |

**The conversion pivot — always `Instant` + a `ZoneId`:**

```java
Instant i = date.toInstant();
ZonedDateTime z = i.atZone(ZoneId.systemDefault());
LocalDate ld = LocalDate.ofInstant(i, zone);          // JDK 9+
java.sql.Date.valueOf(localDate);  sqlDate.toLocalDate();
Timestamp.from(instant);  ts.toInstant();
```

**Canonical traps:**

- **`ChronoUnit.DAYS.between(a,b)`** for total days — NOT `Period.getDays()` (that is only the day component).
- `Calendar.MONTH` is 0-based (Jan=0) vs `LocalDate.getMonthValue()` 1-based; `Calendar.DAY_OF_WEEK` Sunday=1 vs `DayOfWeek.getValue()` Monday=1.
- `LocalDate`/`LocalDateTime` have no zone — conversion needs an explicit `ZoneId` (`systemDefault()` is machine-dependent; `java.sql.*.valueOf` silently uses the JVM default zone).
- `SimpleDateFormat`/`Calendar` are **not thread-safe**; `SimpleDateFormat` is lenient by default (`setLenient(false)` to validate).
- `Calendar.roll` doesn't carry; `add` does. Week number is locale-dependent.

**Validate a String as a date:** `DateTimeFormatter.parse` (pattern only) vs `LocalDate.parse` (also rejects impossible dates); `SimpleDateFormat` needs `setLenient(false)`; Apache `GenericValidator.isDate`.

**Testable "now":** inject a `Clock` (`Clock.fixed`/`offset`/`tick`); `System.nanoTime` is monotonic, intervals-only; `currentTimeMillis` is wall-clock.

**Current (mid-2026):** `java.time` is the standard; `Year.isLeap`/`WeekFields` (Java 8) and `LocalDate.datesUntil` (JDK 9) and `OffsetDateTime`/`Clock.fixed` are current; `ScheduledExecutorService` over `Timer`/`TimerTask`.

## Full content

The modern date/time API is `java.time` (JSR-310), a fully immutable, fluent set of types: `LocalDate`/`LocalDateTime` (no zone), `ZonedDateTime`/`OffsetDateTime` (zoned / fixed-offset), `Instant` (a UTC-timeline point), `Duration` (time-based amount) and `Period` (date-based amount), plus `ZoneId`, `Clock`, `Year`, `DayOfWeek`, and the `ChronoUnit`/`ChronoField`/`WeekFields` enums. Formatting/parsing is `DateTimeFormatter` (predefined ISO/RFC formatters, pattern letters, locale + localized `FormatStyle`). Arithmetic is fluent (`plusDays`/`plusHours`/`withZoneSameInstant`); `LocalDate.datesUntil` (JDK 9) streams a date range.

The corpus teaches the legacy stack side-by-side as the "before": `java.util.Date`, `Calendar`/`GregorianCalendar` (`set`/`add`/`roll`, `isLeapYear`), `TimeZone`, `SimpleDateFormat`/`DateFormat`, and the `java.sql.{Date,Time,Timestamp}` bridges (Joda-Time and date4j are superseded). The single most important integration fact: every legacy↔modern conversion pivots on `Instant` plus a `ZoneId` — `Date.toInstant().atZone(z)`, `LocalDate.ofInstant` (JDK 9+), `java.sql.Date.valueOf`/`toLocalDate`, `Timestamp.from`/`toInstant`, or epoch-millis.

The traps are mostly about off-by-one calendar conventions and missing zones. `Period.getDays()` returns only the day *component* of a period, not the total day count (use `ChronoUnit.DAYS.between`). `Calendar.MONTH` is 0-based whereas `LocalDate.getMonthValue()` is 1-based; `Calendar.DAY_OF_WEEK` numbers Sunday=1 whereas `DayOfWeek.getValue()` numbers Monday=1. `LocalDate`/`LocalDateTime` carry no zone, so any conversion to an instant requires an explicit `ZoneId` — relying on `systemDefault()` (which `java.sql.*.valueOf` does silently) is machine-dependent. `SimpleDateFormat` and `Calendar` are not thread-safe, and `SimpleDateFormat` is lenient by default. For testable time, inject a `Clock` (`Clock.fixed`/`offset`/`tick`) rather than calling `now()` directly.

### 2026 currency

- **`java.time` (JSR-310) is current and unchanged** — `LocalDate`/`LocalDateTime`/`Duration`/`Period`/`Year.isLeap`/`WeekFields` (Java 8) and `LocalDate.datesUntil` (JDK 9)/`OffsetDateTime`/`Clock.fixed` were already shown and remain the standard.
- **`javax.xml.datatype.*` (`XMLGregorianCalendar`/`DatatypeFactory`) was NOT removed — it lives in module `java.xml` (JAXP) and remains in current JDKs (11/21/25).** What JEP 320 removed in Java 11 was JAXB (`javax.xml.bind.*`) and JAX-WS, which now need standalone `jakarta.xml.bind` / `jakarta.xml.ws` dependencies. [JEP 320: Remove the Java EE and CORBA Modules](https://openjdk.org/jeps/320)
- **`AgeCalculatorUnitTest` data-quality caveat** — the corpus uses the buggy `yyyy-mm-dd` pattern (lowercase `mm` = minutes, not months); don't seed it as exemplary.
- **`ScheduledExecutorService`** is the modern alternative to `Timer`/`TimerTask` for scheduling.
- **`Clock` dependency injection** is the durable, library-free testable-time recommendation; PowerMock/JMockit time-mocking approaches are abandoned/stagnant — static mocking is now Mockito `mockStatic`. [Mockito — mockStatic](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html#mockStatic-java.lang.Class-)
