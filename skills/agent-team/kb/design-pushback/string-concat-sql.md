---
kb_id: design-pushback/string-concat-sql
version: 1
tags: [design-pushback, security, backend, data, high-severity]
related:
  - security-dev/auth-patterns
  - architecture/discipline/error-handling-discipline
  - data-dev/data-modeling-basics
status: active+enforced
pattern: |
  Constructing SQL queries by concatenating or interpolating user input
  into a SQL string ("SELECT * FROM users WHERE id = " + userId, or
  `SELECT * FROM users WHERE name = '${name}'`). Includes "string
  builder" abstractions that defer the concatenation but don't
  parameterize at the driver level.
severity: HIGH
applies_when:
  intent: [build, plan, refactor]
  domain: [backend, web, mobile, data]
  feature_keywords:
    - SQL
    - query
    - database
    - "raw query"
    - "dynamic query"
    - "build query"
    - Postgres
    - MySQL
    - SQLite
    - "user input"
    - search
    - filter
applies_NOT_when:
  - "static SQL with no user-controlled values"
  - "admin-only context with cryptographically authenticated audit trail"
  - "code-gen tool generating queries from schema (not from user input)"
preferred_alternative:
  - "Parameterized queries via driver-native placeholder syntax: $1/$2 (Postgres), ? (MySQL/SQLite), :name (named)"
  - "Query builder library that parameterizes by default: Drizzle ORM, Kysely, Knex (with proper API usage)"
  - "ORM layer: Prisma, TypeORM, SQLAlchemy — automatic parameterization for all generated queries"
why_better: |
  - **SQL injection elimination**: parameterized queries send the SQL
    structure and the values as separate wire-format payloads. The
    database parses the SQL once with placeholders, then binds values
    that CANNOT be reinterpreted as SQL. String concat sends a single
    payload where the database has no way to tell "intended SQL" from
    "user-supplied data that happens to look like SQL".
  - **Query plan caching**: parameterized queries with the same SQL text
    (different bound values) share a query plan in most database engines.
    Concatenated queries are textually different per request — every
    invocation re-parses + re-plans.
  - **Type coercion at boundary**: drivers coerce JS Number → SQL integer,
    Date → timestamp, etc. at the bind step. String concat requires the
    caller to manually serialize types — a frequent source of bugs (date
    formats, decimal precision, NULL handling).
  - **Audit / observability**: pg_stat_statements (Postgres) groups
    queries by their parameterized signature for performance analysis.
    Concatenated queries appear as N different statements, defeating
    aggregation.
  - **Defense-in-depth holds under code mistakes**: a developer who
    misses input validation in one code path is still safe if the query
    is parameterized. With string concat, every code path that touches a
    query becomes a potential SQL injection surface.
override_requires: |
  There is essentially NO override path for user-input string-concat SQL
  in production code. If you're authoring it, you're authoring a CVE.

  Legitimate dynamic-SQL needs (table names, column names not parameter-
  izable in standard SQL) require explicit allow-list validation:
  - Match identifier against a fixed list of allowed values
  - Validate against a strict regex (e.g., /^[a-z_][a-z0-9_]*$/)
  - Use the database driver's quote-identifier function if available
  Override must explicitly state which of these is in use.
empirical_origin: |
  v2.8.2-run1 chaos audit (kai's HIGH findings) + v2.8.3-run1 audit
  (vlad's CRITICAL-2 on drizzle-orm@0.33.0 SQL injection CVE) both
  surfaced SQL injection adjacencies. Industry-wide: OWASP A03:2021
  Injection sits at #3 on the consolidated top-10 across multiple years.
---

## Quick Reference

**The anti-pattern**: Code like:

```js
// JavaScript / Node
const sql = `SELECT * FROM users WHERE email = '${req.body.email}'`;
db.query(sql);

// Python
cursor.execute("SELECT * FROM users WHERE id = " + str(user_id))

// Go
db.Query(fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name))
```

**Why it bites**: a user submits an `email` of `' OR 1=1 --` and the
query becomes `SELECT * FROM users WHERE email = '' OR 1=1 --'`. The
attacker dumps the user table. Variants exfiltrate data via UNION,
modify rows via piggy-backed UPDATE/INSERT, drop tables, etc.

**The fix**: every database driver has a parameterized API. Use it.

```js
// JavaScript / Node (pg)
const result = await db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);

// Python (psycopg2)
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

// Go (database/sql)
db.Query("SELECT * FROM users WHERE name = ?", name)
```

## Full content

### The "but I sanitize input" objection

Some defenses rely on input validation: "I only allow alphanumeric
emails, so there's no injection surface". This is a fragile defense:

1. **Defense regression**: the validation logic is a separate code path
   from the query. A future refactor that loosens validation (or skips it
   on one endpoint) re-opens injection.
2. **Encoding bypasses**: depending on driver + DB, Unicode normalization,
   character set conversion, or alternate quote characters can defeat
   validation that looked sufficient.
3. **Second-order injection**: data stored "clean" by one endpoint may
   later be used in a query by another endpoint that DOESN'T validate.
   Stored XSS is the analogous web-side problem.
4. **Logical equivalence**: parameterization is correctness-by-
   construction; validation is checking-after-the-fact. Choose the
   stronger guarantee.

### When dynamic identifiers ARE needed (and how to do them safely)

SQL standard doesn't allow parameterizing table names, column names, or
SQL keywords. If you NEED these to be dynamic (e.g., admin tool that
lets you select which column to filter on), use:

```js
// Allow-list approach
const ALLOWED_COLUMNS = new Set(['name', 'email', 'created_at']);
if (!ALLOWED_COLUMNS.has(req.query.sortBy)) {
  throw new Error('Invalid sort column');
}
// Safe to interpolate since value is validated against fixed list
const sql = `SELECT * FROM users ORDER BY ${req.query.sortBy} LIMIT $1`;
db.query(sql, [limit]);
```

The KEY property: the value being interpolated is matched against a
finite, code-controlled set BEFORE concatenation. The user-input value
is never written verbatim into SQL.

### ORM / Query Builder safety profile

| Tool | Default safety | Failure modes |
|------|----------------|---------------|
| Drizzle (toolkit-recommended) | All `db.<verb>` calls parameterize | `sql<>` template — safe by default but `sql.raw()` is the escape hatch |
| Kysely | Type-safe parameterization | Raw SQL access via `sql\`\`` is escape hatch |
| Prisma | All generated queries parameterize | `prisma.$queryRaw\`\`` parameterizes by default; `prisma.$queryRawUnsafe` is the unsafe path |
| TypeORM | Parameterized for `repository` API | `EntityManager.query()` raw mode requires explicit param array |
| Knex | Parameterized for builder API | `knex.raw()` requires explicit binding array |
| SQLAlchemy Core | `text()` with `:name` placeholders is safe | `text()` with f-string interpolation is unsafe |
| Raw `pg` / `mysql2` / `sqlite3` | API-level parameter-binding | Hand-written string concat re-introduces risk |

When using a query builder/ORM, the most common SQL injection vector is
ESCAPING the safe API via a `.raw()` or `Unsafe` method to get "dynamic"
queries. Treat any use of such methods as a security review point.

### CVE-style precedents

This pattern produces CVEs every year. A non-exhaustive recent list:

- **drizzle-orm < 0.33.1** (2024): unsafe table-name interpolation in some
  builder methods (v2.8.3-run1 found this in the bench-run project's deps)
- Multiple Wordpress plugins year-over-year
- Various Java enterprise frameworks where string-builder APIs felt safer
  than they were

The class of vulnerability persists not because SQL injection is hard to
prevent — parameterization eliminates it — but because the unsafe API
is sometimes more ergonomic for the developer in the moment.

### References

- OWASP Top 10 2021 — A03 Injection
- OWASP SQL Injection Prevention Cheat Sheet
- "Bobby Tables" XKCD #327 (the canonical illustrative example)
- PostgreSQL parameterized query docs: https://node-postgres.com/features/queries
