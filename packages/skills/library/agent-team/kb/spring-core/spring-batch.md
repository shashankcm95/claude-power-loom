---
kb_id: spring-core/spring-batch
version: 1
tags:
  - spring-core
  - batch
  - etl
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-batch / spring-batch-2"
  - "Spring Batch 5.0 Migration Guide (official wiki, github.com/spring-projects/spring-batch/wiki/Spring-Batch-5.0-Migration-Guide)"
related:
  - spring-core/scheduling-async-retry
status: active
---

## Summary

**Concept**: Spring Batch runs robust bulk jobs as `Job` → `Step`s, with chunk-oriented read/process/write and tasklet steps, restartability, skip/retry, and partitioning.
**Key APIs**: `Job`/`Step`, `ItemReader`→`ItemProcessor`→`ItemWriter` with `.chunk(n)`; `FlatFileItemReader`/`JdbcBatchItemWriter`/`StaxEventItemWriter`; `JobBuilder`/`StepBuilder`; `RunIdIncrementer`; `@SpringBatchTest`.
**Gotcha**: an `ItemProcessor` returning `null` filters the item out of the write; re-runs need a `JobParameters` change (e.g. `RunIdIncrementer`).
**2026-currency**: Batch 5 removed `JobBuilderFactory`/`StepBuilderFactory` + the Map repository — use `new JobBuilder(name, jobRepository)`; `@EnableBatchProcessing` semantics changed.
**Sources**: Baeldung `spring-batch` ×2; Spring Batch 5.0 Migration Guide.

## Quick Reference

**Job model**: a `Job` is a sequence of `Step`s. A chunk step reads/processes/writes in batches of N; a tasklet step does a single unit of work.

**Chunk step**: `ItemReader` → `ItemProcessor` → `ItemWriter` with `.chunk(n)`. A processor returning `null` filters that item (it is not written).

**Readers/writers**:
- CSV: `FlatFileItemReader(Builder)` + `DelimitedLineTokenizer` + `BeanWrapperFieldSetMapper`
- XML: `StaxEventItemWriter` + `Jaxb2Marshaller`
- JDBC: `JdbcBatchItemWriter(Builder)` + `BeanPropertyItemSqlParameterSourceProvider`

**Robustness**:
- Restartable/re-runnable: `.incrementer(new RunIdIncrementer())` (varies `JobParameters` each run).
- Skip: `.faultTolerant().skipLimit(n).skip(SomeException.class)` or a custom `SkipPolicy`.
- Retry within a step; conditional flow via `.on("FAILED").to(stepB)` and `JobExecutionDecider`.
- Partitioning: `Partitioner` + `@StepScope` + `#{stepExecutionContext[...]}`.

**Scheduling launch**: `@Scheduled` triggering `JobLauncher.run(job, params)`, varying `JobParameters` each run (else the job is treated as already-complete).

**Testing**: `@SpringBatchTest` + `JobLauncherTestUtils` / `StepScopeTestUtils` / `AssertFile`.

**Top gotchas**:
- `ItemProcessor` returning `null` silently drops the item.
- Re-launching the same job with identical `JobParameters` is a no-op (a completed `JobInstance` is not re-run) — use an incrementer.
- The 2021 corpus uses `JobBuilderFactory`/`StepBuilderFactory` + `@EnableBatchProcessing`, all removed/changed in Batch 5.

**Current (mid-2026)**: Spring Batch 5 (Boot 3) removed `JobBuilderFactory`/`StepBuilderFactory` and the Map-based `JobRepository`. Use `new JobBuilder(name, jobRepository)` / `new StepBuilder(name, jobRepository)` (the `JobRepository` is passed explicitly). `@EnableBatchProcessing` no longer exposes a transaction-manager bean and configures a JDBC `JobRepository` requiring a `DataSource`. `JobExecutionListenerSupport` is deprecated.

## Full content

Spring Batch is the framework for reliable bulk processing: ETL, report generation, ledger rollups. Its core abstraction is the chunk step — read an item, optionally transform it, accumulate N items, then write them in one transaction. Restartability, skip/retry policies, conditional flow, and partitioning make it resilient to partial failure and large volumes.

### The builder migration

The most disruptive 2026 change is structural, not conceptual. The 2021 corpus builds jobs with `JobBuilderFactory`/`StepBuilderFactory` autowired beans and activates the engine with `@EnableBatchProcessing` exposing a transaction manager. Batch 5 removed those factories and changed `@EnableBatchProcessing` semantics: jobs and steps are now built with the constructor-based `JobBuilder`/`StepBuilder`, passing the `JobRepository` explicitly. The Map-based in-memory repository is gone, so even tests need a JDBC `JobRepository` + `DataSource`.

### Re-run semantics

A `JobInstance` is identified by its `JobParameters`; a completed instance is not re-run. Production jobs therefore use `RunIdIncrementer` (or pass a timestamp/run-id parameter) so each launch is a distinct instance.

### 2026 currency

Spring Batch is "version-stale but concepts transfer" with a significant API migration in the 2026 Update:

- **Spring Batch 5: `JobBuilderFactory` / `StepBuilderFactory` removed/deprecated-for-removal.** Use `new JobBuilder(name, jobRepository)` / `new StepBuilder(name, jobRepository)`. `@EnableBatchProcessing` no longer exposes a transaction-manager bean and configures a JDBC `JobRepository` requiring a `DataSource`; the Map-based repository was removed in v5. [Spring Batch 5.0 Migration Guide (official wiki)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-5.0-Migration-Guide)
- **`javax.batch → jakarta.batch`** and `javax.xml.bind` (JAXB) → Jakarta artifacts for the XML reader/writer path, on the Spring 6 baseline. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: runs on Spring Framework 7.0.8 / Spring Boot 4.1.0; Java 17 floor. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
