---
kb_id: bigdata-ml-cloud/apache-spark
version: 1
tags:
  - bigdata-ml-cloud
  - apache-spark
  - distributed-processing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-spark"
  - "Spark Release 4.0.0 (spark.apache.org/releases/spark-release-4-0-0.html)"
related:
  - bigdata-ml-cloud/jvm-machine-learning
  - bigdata-ml-cloud/reactive-cloud-integration
status: active
---

## Summary

**Concept**: Apache Spark from the JVM — the RDD/DataFrame/Dataset trichotomy, lazy transformations vs eager actions, micro-batch streaming, and graph processing, all driven through `JavaSparkContext`/`SparkSession`.
**Key APIs**: `SparkConf().setAppName().setMaster("local[*]")`, `JavaSparkContext`, `textFile`→`flatMap`→`mapToPair`→`reduceByKey`→`collect`; `SparkSession.read().csv(...)`, `Dataset<Row>`, `df.as(Encoders.bean(T.class))`; `JavaStreamingContext`, `mapWithState`; `GraphFrame.pageRank()`.
**Gotcha**: transformations are lazy (nothing runs until an action); version skew (Spark 2.4/Scala 2.11 pom mixed with a Spark-3.0/Scala-2.12 GraphFrames artifact) is a binary-incompatibility hazard; `mapWithState` throws without `checkpoint(...)`.
**2026-currency**: Spark 4.0.1 — JDK 17 default, Scala 2.13, ANSI SQL default, Spark Connect matured; corpus's 2.4.8/Scala 2.11/JDK 8 assumptions are fully invalid.
**Sources**: Baeldung `apache-spark` module; Spark 4.0.0 release notes.

## Quick Reference

**Driver setup** (in every `main`):
- `SparkConf conf = new SparkConf().setAppName("app").setMaster("local"/"local[2]"/"local[*]")`
- `JavaSparkContext sc = new JavaSparkContext(conf)`
- Silence logs: `Logger.getLogger("org"/"akka").setLevel(Level.OFF)`

**RDD lazy/eager split**:
- *Transformations* (lazy, build the DAG): `map`, `filter`, `flatMap`, `mapToPair`, `reduceByKey`, `distinct`
- *Actions* (eager, trigger execution): `collect`, `count`, `reduce`, `foreach`, `saveAsTextFile`
- Classic word count: `textFile` → `flatMap`(split) → `mapToPair`(word,1) → `reduceByKey`(sum) → `collect`

**The three abstractions**:
| API | Typing | Read / op |
|---|---|---|
| `JavaRDD<T>` | untyped | functional ops, no schema |
| `DataFrame = Dataset<Row>` | schema-aware | `read().option("header","true").csv(...)`, `select(col(...))`, `groupBy().count()`, `agg(sum(...))` |
| `Dataset<T>` | typed | `df.as(Encoders.bean(T.class))`, typed `FilterFunction` lambdas, Catalyst optimization + compile-time safety |

**Streaming** (Kafka → Spark → Cassandra): `JavaStreamingContext` + `Durations.seconds(1)` micro-batches; `KafkaUtils.createDirectStream` (`LocationStrategies.PreferConsistent`, `ConsumerStrategies.Subscribe`); DataStax `javaFunctions(rdd).writerBuilder(...).saveToCassandra()`. Stateful: `streamingContext.checkpoint(...)` + `mapWithState(StateSpec.function(...))` → `JavaMapWithStateDStream`.

**Graph** (GraphFrames/GraphX): `GraphFrame` from vertex+edge `Dataset<Row>`s; `pageRank().maxIter(20).resetProbability(0.15).run()`, `connectedComponents()` (needs a checkpoint dir), `triangleCount()`, `degrees`/`inDegrees`/`outDegrees`.

**Top gotchas**:
- Transformations are lazy — forgetting an action means nothing executes.
- `mapWithState` throws if `checkpoint(...)` is not set.
- Hardcoded Windows-style data paths (`"data\\iris.data"`) are non-portable.
- Brittle hand-rolled CSV parsing in the examples.

**Current (mid-2026)**: Spark 4.0.0 (May 23, 2025); 4.0.1 (Sep 6, 2025). Drops JDK 8/11 (JDK 17 default, SPARK-45315), drops Scala 2.12 for 2.13 (SPARK-45314), ANSI SQL mode default (SPARK-44444). Prefer DataFrame `org.apache.spark.ml.*` Pipelines + Structured Streaming over the legacy DStream/MLlib-RDD APIs.

## Full content

Apache Spark is a distributed processing engine; the Baeldung `apache-spark` module exercises it from Java across four sub-areas: the core RDD model, the DataFrame/Dataset structured APIs, micro-batch streaming, and graph processing.

The **RDD** (Resilient Distributed Dataset) is the original abstraction: an untyped, partitioned, distributed collection. Its defining property is laziness — *transformations* (`map`, `filter`, `flatMap`, `mapToPair`, `reduceByKey`, `distinct`) only build an execution DAG; nothing actually computes until an *action* (`collect`, `count`, `reduce`, `foreach`, `saveAsTextFile`) forces it. The canonical word-count threads `textFile`→`flatMap`→`mapToPair`→`reduceByKey`→`collect`. A driver wires this with `new SparkConf().setAppName(...).setMaster("local[*]")` and a `JavaSparkContext`.

The **structured** APIs layer schema awareness on top. A `DataFrame` is `Dataset<Row>` — read via `SparkSession.read().option("header","true").csv(...)`, manipulated with column expressions (`select(col(...))`, `filter`, `groupBy().count()`, `agg(sum(...))`). A `Dataset<T>` adds static typing via `df.as(Encoders.bean(T.class))`, enabling typed `FilterFunction` lambdas, compile-time safety, and Catalyst query optimization. The RDD→DataFrame→Dataset progression is the central teaching arc of the module.

**Streaming** uses the legacy DStream model: `JavaStreamingContext` cuts the stream into `Durations.seconds(1)` micro-batches, sourced from Kafka via the direct integration (`KafkaUtils.createDirectStream`, `LocationStrategies.PreferConsistent`, `ConsumerStrategies.Subscribe`) and sunk to Cassandra through the DataStax connector's `javaFunctions(rdd).writerBuilder(...).saveToCassandra()`. Stateful aggregation requires a checkpoint directory plus `mapWithState(StateSpec.function(...))`.

**Graph** processing uses GraphFrames over GraphX: build a `GraphFrame` from vertex and edge `Dataset<Row>`s, then run queries (`filterEdges`, `dropIsolatedVertices`, degree counts) and algorithms (`pageRank().maxIter(20).resetProbability(0.15).run()`, `connectedComponents()`, `triangleCount()`).

The corpus's biggest hazard is version skew: its pom mixes Spark 2.4.8/Scala 2.11 with a GraphFrames artifact built for Spark 3.0/Scala 2.12 — a real binary-incompatibility risk. The integration tests also assume live local infra (Kafka `localhost:9092`, Cassandra `127.0.0.1`), so they are not CI-runnable as-is.

### 2026 currency

Spark jumped two majors: **Spark 4.0.0 shipped May 23, 2025**, with the latest at **4.0.1 (Sep 6, 2025)** ([Spark Release 4.0.0](https://spark.apache.org/releases/spark-release-4-0-0.html)). Spark 4.0 **drops JDK 8/11 and makes JDK 17 the default** (SPARK-45315), **drops Scala 2.12 for Scala 2.13** (SPARK-45314), drops Python 3.8 (SPARK-47993), and **makes ANSI SQL mode the default** (SPARK-44444) — so the corpus's Spark 2.4.8 / Scala 2.11 / JDK 8 assumptions are fully invalid. Spark Connect matured (Java client API compatibility, `spark.api.mode` toggle, ML on Spark Connect).

On the API direction: the DataFrame-based `org.apache.spark.ml.*` Pipelines remain the guidance, and RDD-based MLlib has been maintenance-only since Spark 2.0 — but the Spark 4.0 release notes do **not** remove RDD-based MLlib or DStream, so "RDD MLlib removed" is NOT yet true (maintenance-only, not removed). Log4j 1.x (`org.apache.log4j`, used to silence Spark logs) is EOL/insecure → move to Log4j 2.17.1+ or SLF4J/Logback ([Log4Shell FAQ (Tenable)](https://www.tenable.com/blog/cve-2021-44228-cve-2021-45046-cve-2021-4104-frequently-asked-questions-about-log4shell)). The modern streaming-to-lakehouse path is Structured Streaming + Apache Iceberg/Delta Lake, which the corpus has no coverage of ([Data Streaming Meets Lakehouse: Iceberg (Kai Waehner, Nov 2025)](https://www.kai-waehner.de/blog/2025/11/19/data-streaming-meets-lakehouse-apache-iceberg-for-unified-real-time-and-batch-analytics/)).
