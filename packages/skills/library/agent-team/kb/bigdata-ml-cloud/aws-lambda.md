---
kb_id: bigdata-ml-cloud/aws-lambda
version: 1
tags:
  - bigdata-ml-cloud
  - aws-lambda
  - serverless
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: aws-lambda"
  - "AWS Lambda runtimes (docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)"
related:
  - bigdata-ml-cloud/aws-sdk-java
status: active
---

## Summary

**Concept**: AWS Lambda from Java — three handler shapes, API Gateway proxy integration, SAM declarative infra, and the durable freeze/thaw operational patterns (Hibernate-in-Lambda, cold-start DI).
**Key APIs**: POJO method handler, `RequestHandler<I,O>`, `RequestStreamHandler`; API Gateway proxy event/response shape; `template.yaml` (`Transform: AWS::Serverless-2016-10-31`, `AWS::Serverless::Function`, `Events: Type: Api`); HikariCP `softEvictConnections()`.
**Gotcha**: without `softEvictConnections()` after each invocation, a frozen Lambda's HikariCP holds connections the DB already dropped → errors on thaw — the whole point of the shipping-tracker article.
**2026-currency**: `Runtime: java8` (Amazon Linux 1) is deprecated/EOL → java11/17/21 on Amazon Linux 2023; Spring Boot 3 AOT + GraalVM Native Image directly attacks cold-start.
**Sources**: Baeldung `aws-lambda` module; AWS Lambda runtimes page.

## Quick Reference

**Three handler shapes**:
| Shape | Signature | Use |
|---|---|---|
| POJO method | `String handleRequest(String, Context)` (no interface) | simplest |
| `RequestHandler<I,O>` | typed in/out | structured events |
| `RequestStreamHandler` | raw `InputStream`/`OutputStream` | full control |

`Context.getLogger()` for CloudWatch logging.

**API Gateway proxy integration**: parse the proxy event JSON (`body`, `pathParameters`, `queryStringParameters`); return the proxy response shape (`statusCode`/`headers`/`body`); route by `input.getResource()`.

**AWS SAM** (`template.yaml`):
- `Transform: AWS::Serverless-2016-10-31`
- `AWS::Serverless::Function` with `Handler`/`Runtime`/`MemorySize`/`Timeout`, `Environment.Variables`
- `Parameters`, `Globals`, `Events: Type: Api`

**The durable operational patterns** (the real lessons):
- **Hibernate-in-Lambda**: build `SessionFactory` once as a field (reused across warm invocations); tiny HikariCP pool (max 2); **`hikariDataSource.getHikariPoolMXBean().softEvictConnections()` in a `finally`** after each invocation.
- **Cold-start DI**: Guice `ExecutionContext` built once; Feign declarative HTTP clients (`@RequestLine`, `BasicAuthRequestInterceptor`, Gson codecs); env-var-interpolated YAML (`lightweight-config`, `${VAR:-default}`).

**Top gotcha**: a frozen execution environment leaves stale DB connections — without `softEvictConnections()` the pool hands out dead connections on thaw.

**Current (mid-2026)**: `Runtime: java8` (Amazon Linux 1) is deprecated/EOL — use **java11/17/21** (managed runtimes moving to Amazon Linux 2023; AL2 reaches EOL Jun 30 2026). The corpus's `Runtime: java8` in SAM templates must change. **Spring Boot 3 AOT + GraalVM Native Image** is the modern cold-start mitigation.

## Full content

The Baeldung `aws-lambda` module covers serverless Java end to end: handler programming models, API Gateway integration, infrastructure-as-code via SAM, and — most valuably — the operational patterns that distinguish a toy Lambda from a production one.

There are **three handler shapes**. The simplest is a plain POJO method (`String handleRequest(String, Context)`) with no interface. `RequestHandler<I,O>` gives typed input/output for structured events. `RequestStreamHandler` exposes the raw `InputStream`/`OutputStream` for full control. All receive a `Context`, whose `getLogger()` writes to CloudWatch.

**API Gateway proxy integration** is the common front door: the handler parses the proxy event JSON (extracting `body`, `pathParameters`, `queryStringParameters`) and returns the proxy response shape (`statusCode`/`headers`/`body`), routing on `input.getResource()`.

**AWS SAM** declares the infrastructure in `template.yaml`: a `Transform: AWS::Serverless-2016-10-31` header, `AWS::Serverless::Function` resources with `Handler`/`Runtime`/`MemorySize`/`Timeout` and `Environment.Variables`, plus `Parameters`, `Globals`, and `Events: Type: Api` to wire an HTTP trigger.

The durable lessons are the **freeze/thaw operational patterns**, because Lambda freezes the execution environment between invocations. The shipping-tracker article's whole point is Hibernate-in-Lambda: build the `SessionFactory` once as a field (so it survives warm invocations), keep a tiny HikariCP pool (max 2), and call `softEvictConnections()` in a `finally` after each invocation — otherwise the frozen environment holds connections the database has already dropped, and the next thaw fails. The todo-reminder article shows the cold-start DI pattern: a Guice `ExecutionContext` built once, Feign declarative HTTP clients (`@RequestLine`, `BasicAuthRequestInterceptor`, Gson codecs), and env-var-interpolated YAML config (`lightweight-config` with `${VAR:-default}`).

### 2026 currency

Lambda's Java runtimes have moved: **`java8` (Amazon Linux 1) is deprecated/EOL**, and the current managed runtimes are **java11/17/21**, moving to Amazon Linux 2023 (Amazon Linux 2 reaches end-of-life Jun 30, 2026) ([AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)). The corpus's `Runtime: java8` in its SAM templates must change. The freeze/thaw operational patterns (tiny pools + `softEvictConnections`, cold-start DI containers, Feign clients, SAM declarative infra) all carry forward unchanged conceptually.

The net-new cold-start mitigation is **GraalVM Native Image + Spring Boot 3 AOT**: Spring's AOT engine generates native config so Boot apps compile to native executables with much faster startup and smaller footprint — directly relevant to Lambda cold-start ([GraalVM Native Image Support (Spring Boot docs)](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html)). Java 21 **virtual threads** (JEP 444, final) are also a simpler I/O-concurrency model for cloud/SaaS clients than the corpus's reactive `.block()` bridging ([Oracle Releases Java 25 (Oracle)](https://www.oracle.com/news/announcement/oracle-releases-java-25-2025-09-16/)).
