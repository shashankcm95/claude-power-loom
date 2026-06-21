---
kb_id: security/sql-injection-prevention
version: 1
tags:
  - security
  - sql-injection
  - input-validation
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: software-security/sql-injection-samples"
  - "OWASP SQL Injection Prevention Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)"
related:
  - security/applied-cryptography
status: active
---

## Summary

**Concept**: Preventing SQL injection — parameterize values, allow-list identifiers, use the Criteria API. The corpus's strongest, most timeless, fully-tested security module.
**Key APIs**: `PreparedStatement` `?` + `setString`; JPA `:param` + `setParameter`; JPA Criteria (`CriteriaBuilder`/`CriteriaQuery`/`Root` + generated `Account_` metamodel); a fixed allow-list `Set`/`Map` for non-parameterizable identifiers.
**Gotcha**: Bind params protect *values, not identifiers* — ORDER BY columns and table names cannot be substituted by `?`/`:param` (`from ?` throws); they must be validated against an allow-list.
**2026-currency**: Timeless and forward-portable; the only update is `javax.persistence` -> `jakarta.persistence` under Boot 3 / Jakarta EE 9+.
**Sources**: Baeldung `software-security/sql-injection-samples`; OWASP cheat sheet.

## Quick Reference

**The vulnerability**: string-concatenated SQL/JPQL.

```java
// VULNERABLE — "C1' or '1'='1" leaks all rows
"... where customer_id = '" + customerId + "'"
```

**Safe for values** — three equivalent paths:

```java
// 1. JDBC PreparedStatement
PreparedStatement ps = c.prepareStatement("... where id = ?");
ps.setString(1, customerId);

// 2. JPA named parameter
em.createQuery("... where id = :id").setParameter("id", customerId);

// 3. JPA Criteria API (type-safe, no string at all)
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<Account> q = cb.createQuery(Account.class);
Root<Account> r = q.from(Account.class);
q.where(cb.equal(r.get(Account_.customerId), customerId));  // generated metamodel
```

**Safe for identifiers** (the part everyone forgets): bind params **cannot** substitute identifiers (ORDER BY column, table name) — `from ?` / `from :table` throws. Validate the identifier against a fixed allow-list, else throw:

```java
Set<String> ALLOWED = Set.of("name", "created_at", "balance");
if (!ALLOWED.contains(orderByColumn)) throw new IllegalArgumentException(...);
```

**Top gotchas**:

- Bind params protect values, not identifiers — the allow-list is mandatory for dynamic ORDER BY / table names.
- An exact-set allow-list (membership against a fixed `Set`), not a regex denylist — denylists are bypassable.

**Current (mid-2026)**: timeless; only the namespace moves (`javax.persistence` -> `jakarta.persistence` under Boot 3 / Jakarta EE 9+). The Criteria metamodel (`Account_`) and parameterization are unchanged.

## Full content

SQL-injection prevention is the corpus's strongest and most timeless security module — fully tested, with the vulnerability and its three preventions demonstrated against a real attack string. The vulnerability is string-concatenated SQL or JPQL: a `where customer_id = '" + customerId + "'"` query is exploited by `"C1' or '1'='1"`, which leaks every row. Prevention for values is parameterization — a JDBC `PreparedStatement` with `?` placeholders and `setString`, a JPA named parameter `:param` with `setParameter`, or the fully type-safe JPA Criteria API (`CriteriaBuilder`/`CriteriaQuery`/`Root` against a generated `Account_` metamodel, which removes the query string entirely). The load-bearing nuance is that **bind parameters protect values, not identifiers**: an ORDER BY column or a table name cannot be substituted by a placeholder (`from ?` throws), so any dynamic identifier must be validated against a fixed allow-list `Set`/`Map` and rejected if absent. Evidence: `software-security/sql-injection-samples/.../AccountDAO.java` + `SqlInjectionSamplesApplicationUnitTest.java`.

This module is the security view of the JDBC/JPA query layer — the same parameterization discipline that the data-persistence domain teaches for correctness is here framed as the primary injection defense. `JdbcUserDetailsManager` and any user-schema reads inherit the same rules.

### 2026 currency

- **Timeless and forward-portable.** Parameterizing values, allow-listing identifiers, and using the Criteria API are conceptually unchanged and remain the canonical defense. The OWASP SQL Injection Prevention Cheat Sheet still lists parameterized queries / prepared statements as the primary defense and input allow-listing for identifiers. [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- **Namespace migration only.** Under Spring Boot 3 / Jakarta EE 9+, `javax.persistence` -> `jakarta.persistence` (the `EntityManager`, `CriteriaBuilder`, and metamodel APIs move package but keep their shape). [Spring Boot System Requirements](https://docs.spring.io/spring-boot/system-requirements.html)
- **Exact-set allow-listing over denylists.** The allow-list must be membership against a fixed set, not a regex denylist (which is bypassable) — a principle that generalizes to any authorization or identifier post-condition. [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
