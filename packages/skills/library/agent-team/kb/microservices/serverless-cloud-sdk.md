---
kb_id: microservices/serverless-cloud-sdk
version: 1
tags:
  - microservices
  - serverless
  - spring-cloud-function
  - aws
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-functions, spring-cloud-aws, spring-cloud-task, spring-cloud-open-service-broker"
  - "Announcing Spring Cloud AWS 3.0.0 + io.awspring.cloud 4.0.2 (spring.io/blog/2023/05/02)"
related:
  - microservices/event-driven-streaming
  - microservices/containers-orchestration
  - microservices/alternative-runtimes
status: active
---

## Summary

**Concept**: Run business logic as plain functions (HTTP or FaaS) and integrate cloud-provider services through Spring abstractions. Spring Cloud Function exposes `java.util.function.*` beans over HTTP + AWS Lambda; Spring Cloud AWS wraps S3/EC2/RDS/SQS/SNS; Spring Cloud Task records short-lived job metadata.
**Key APIs**: `@Bean Function<I,O>` auto-exposed at `/<beanName>`, `spring.cloud.function.scan.packages`, AWS `SpringBootRequestHandler<I,O>`; AWS S3 via `ResourceLoader.getResource("s3://...")`, `@SqsListener`, `NotificationMessagingTemplate`; `@EnableTask` + `TASK_EXECUTION`.
**Gotcha**: Spring Cloud Function's routing-expression header is an RCE vector — CVE-2022-22963 (SpEL RCE via a crafted routing header) was exploited in the wild; same function body runs web + Lambda with no code change, which makes the exposed surface easy to under-secure.
**2026-currency**: AWS SDK v1 is end-of-support (Dec 31 2025) -> Spring Cloud AWS re-homed to `io.awspring.cloud` on SDK v2 (4.0.2); Spring Cloud Function AWS `SpringBootRequestHandler` -> `FunctionInvoker`.
**Sources**: Baeldung `spring-cloud-functions`/`-aws`/`-task`; Spring Cloud AWS 3.0/4.0 releases.

## Quick Reference

**Spring Cloud Function**:
```java
@Bean Function<String,String> reverse() { return s -> new StringBuilder(s).reverse().toString(); }
// auto-exposed at POST /reverse by spring-cloud-starter-function-web
```
- `spring.cloud.function.scan.packages` discovers standalone `Function`/`Supplier`/`Consumer` classes.
- **AWS Lambda**: `extends SpringBootRequestHandler<I,O>` (exclude the web starter; shade/thin-layout packaging). Same function body -> web + Lambda, no code change.

**Spring Cloud AWS**:
- S3 as a Spring `Resource`: `ResourceLoader.getResource("s3://bucket/key")`, cast to `WritableResource`; wildcards via `PathMatchingSimpleStorageResourcePatternResolver`.
- EC2: `@EnableContextInstanceData` -> `@Value("${ami-id}")` + SpEL `@Value("#{instanceData['Name']}")`.
- RDS: `cloud.aws.rds.<db>.*` auto-creates a `DataSource`.
- SQS: `@SqsListener(queue)` + `QueueMessagingTemplate.convertAndSend`.
- SNS: `NotificationMessagingTemplate.sendNotification` + `@NotificationMessageMapping`.
- Instance-profile creds: `cloud.aws.credentials.instanceProfile=true`.

**Spring Cloud Task**: `@EnableTask` records `TASK_EXECUTION` metadata; `TaskExecutionListener` (onStartup/onEnd/onFailed); needs a relational DB for metadata. Task-from-stream: `@EnableTaskLauncher` sink + `TaskLauncher`.

**Open Service Broker / Heroku**: Open Service Broker API provider (catalog + provision/bind); Heroku connectors.

**Top gotchas**:
- The Function routing header is an RCE vector (CVE-2022-22963) — patch and lock down.
- Tomcat-pool datasource keys (`spring.datasource.maxActive/maxIdle`) are silent no-ops under Boot 2 HikariCP.
- `spring-data-dynamodb` (derjust fork) is abandoned.

**Current (mid-2026)**: AWS SDK Java v1 is end-of-support (Dec 31 2025). Spring Cloud AWS re-homed from `org.springframework.cloud:spring-cloud-aws` (SDK v1, `cloud.aws.*`) to **`io.awspring.cloud`** on AWS SDK v2 (`spring.cloud.aws.*`), now at 4.0.2 (Boot 4 / Spring Cloud 5). Spring Cloud Function AWS `SpringBootRequestHandler` -> `FunctionInvoker` + `spring.cloud.function.definition`.

## Full content

This cluster covers two adjacent concerns: writing logic as portable functions (serverless), and integrating managed cloud services through Spring abstractions. Spring Cloud Function lets the same `java.util.function.*` bean run as an HTTP endpoint or an AWS Lambda; Spring Cloud AWS wraps the major AWS services in Spring-idiomatic APIs; Spring Cloud Task brings lifecycle metadata to short-lived jobs.

### Function portability

The appeal of Spring Cloud Function is write-once: a `Function`/`Supplier`/`Consumer` bean is auto-exposed over HTTP by the web starter, and the identical body runs in Lambda by extending `SpringBootRequestHandler` (with the web starter excluded and thin/shaded packaging). The trade-off is that this routing layer has been a serious RCE surface (see currency).

### Cloud SDK idioms

Spring Cloud AWS maps AWS services onto familiar Spring types: S3 objects become `Resource`s addressable by an `s3://` URL; EC2 instance metadata becomes injectable `@Value`s; RDS auto-creates a `DataSource`; SQS/SNS get listener annotations and messaging templates; and instance-profile credentials avoid committing keys. Open Service Broker provides a standard provision/bind catalog for offering a service to a platform.

### 2026 currency

- **Spring Cloud AWS re-homed to `io.awspring.cloud` on SDK v2.** The old `org.springframework.cloud:spring-cloud-aws` (SDK v1, `cloud.aws.*`) is dead; `io.awspring.cloud` 3.x targets Boot 3.x and the line has advanced to 4.0.x (Boot 4 / Spring Cloud 5, AWS SDK v2 2.39.0+, `spring.cloud.aws.*`). **AWS SDK Java v1 reached end-of-support Dec 31 2025.** [Announcing Spring Cloud AWS 3.0.0 (spring.io)](https://spring.io/blog/2023/05/02/announcing-spring-cloud-aws-3-0-0/) · [awspring releases (4.0.2)](https://github.com/awspring/spring-cloud-aws/releases) · [AWS SDK Java v1 EoS](https://github.com/aws/aws-sdk-java/issues/3195)
- **Spring Cloud Function AWS handler change.** `SpringBootRequestHandler` -> `FunctionInvoker` + `spring.cloud.function.definition`. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **CVE-2022-22963 (CRITICAL, exploited in the wild).** Spring Cloud Function SpEL RCE via a crafted routing-expression header; affected <= 3.1.6 and 3.2.0-3.2.2; fixed in 3.1.7 and 3.2.3. [spring.io CVE-2022-22963](https://spring.io/security/cve-2022-22963/) · [CISA alert](https://www.cisa.gov/news-events/alerts/2022/04/01/spring-releases-security-updates-addressing-spring4shell-and-spring-cloud-function-vulnerabilities)
- **Serverless beyond Lambda is a gap.** The corpus covers only the AWS Lambda adapter — no Knative or other FaaS runtimes, and no function composition. [Spring Cloud Supported Versions](https://github.com/spring-cloud/spring-cloud-release/wiki/Supported-Versions)
- **`spring-data-dynamodb` is abandoned** (derjust fork) — do not seed it; use the AWS SDK v2 enhanced client.
