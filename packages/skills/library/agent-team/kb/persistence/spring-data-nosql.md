---
kb_id: persistence/spring-data-nosql
version: 1
tags:
  - persistence
  - nosql
  - spring-data
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-data-mongodb"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-data-cassandra"
  - "SDE 4.4→5.0 migration guide — docs.spring.io (https://docs.spring.io/spring-data/elasticsearch/reference/migration-guides/migration-guide-4.4-5.0.html)"
related:
  - persistence/spring-data-repositories
  - persistence/caching-data-grid
status: active
---

## Summary

**Concept**: The Spring Data repository model applied over NoSQL/grid/search stores — MongoDB, Cassandra, Couchbase, Elasticsearch, Redis, Neo4j — proving "same model, different store".
**Key APIs**: `MongoRepository`/`MongoTemplate`/`@Document`, `CassandraRepository`/`@PrimaryKeyColumn`/`@AllowFiltering`, `ElasticsearchRepository`/`@MultiField`, `RedisTemplate`/`@RedisHash`, `Neo4jRepository`/`@NodeEntity`/Cypher `@Query`.
**Gotcha**: `@DBRef` does not cascade saves; Mongo `autoIndexCreation()` is OFF by default; Mongo transactions need a replica set; Cassandra/Couchbase require query-first denormalized modeling.
**2026-currency**: drivers are nearly all retired generations — Mongo 3.x → 4.x, Cassandra `Cluster`/`Session` → `CqlSession`, Elasticsearch `RestHighLevelClient` → typed `ElasticsearchClient` (SDE 5.0 default), `spring.redis.*` → `spring.data.redis.*` (Boot 3).
**Sources**: Baeldung `spring-data-mongodb`/`-cassandra`/`-elasticsearch`/`-redis`/`-neo4j`; SDE 4.4→5.0 migration guide.

## Quick Reference

**MongoDB**: `MongoRepository`, `MongoTemplate` + `Query`/`Criteria`; `@Document`/`@Field`/`@DBRef`/`@Indexed`/`@CompoundIndex`; aggregation pipeline (`Aggregation.group/match/sort/project` + `Accumulators`); GridFS (`GridFsTemplate`) for large files; transactions via `MongoTransactionManager` (needs a replica set).
```java
@Query("{ 'age' : { $gt: ?0, $lt: ?1 } }")
List<User> findByAgeRange(int min, int max);
```

**Cassandra**: `CassandraRepository`/`ReactiveCassandraRepository`; `@Table`/`@PrimaryKeyColumn(PARTITIONED|CLUSTERED)`/`@PrimaryKey`; query-first modeling (PK shape = access pattern); `@AllowFiltering` for non-PK predicates; reactive `Mono`/`Flux` + `StepVerifier`.

**Couchbase**: derived repos vs `CouchbaseTemplate`; Views (`ViewQuery`) vs N1QL; `@Version` (CAS optimistic lock); scan consistency (`Stale.FALSE`).

**Elasticsearch**: `ElasticsearchRepository`; `@Document`/`@Field`/`@MultiField` (analyzed `Text` + `keyword` sub-field for exact match); `NativeSearchQueryBuilder` + `QueryBuilders`.

**Redis**: `RedisTemplate`/`ReactiveRedisTemplate`, `@RedisHash` repos, Jedis/Lettuce; pub/sub (`RedisMessageListenerContainer` + `MessageListenerAdapter` + `ChannelTopic`); serializers (`Jackson2JsonRedisSerializer`).

**Neo4j**: `Neo4jRepository`, Cypher `@Query`, `@NodeEntity`/`@RelationshipEntity`(`@StartNode`/`@EndNode`).

**Top gotchas**:
- `@DBRef` does NOT cascade — wire an `AbstractMongoEventListener` + `@CascadeSave` manually.
- Mongo `autoIndexCreation()` is OFF by default — annotated indexes silently uncreated.
- Mongo transactions require a replica set; ZonedDateTime loses its zone (stored as Date).
- Spring Data NoSQL uses `org.springframework.data.annotation.Id`, not `javax.persistence.Id`.
- Query-first NoSQL modeling: forgetting a denormalized table on insert desyncs read models; `@AllowFiltering` required for non-PK Cassandra predicates.

**Current (mid-2026)**: nearly every driver/integration in the corpus is a retired generation. Elasticsearch `RestHighLevelClient` is deprecated → typed `ElasticsearchClient` (SDE 5.0 default). Boot 3 renamed `spring.redis.*` → `spring.data.redis.*`. Cassandra DataStax driver `Cluster`/`Session` → `CqlSession` (driver 4). MongoDB driver 3.x (`DB`/`DBCollection`/`BasicDBObject`) removed in 4.x. Neo4j SDN 6 dropped OGM entirely.

## Full content

The corpus demonstrates Spring Data's "one model, many stores" thesis across a dozen NoSQL/grid/search backends. The programming model (repositories, derived queries, templates) is the same; only the store-specific annotations and engine differ.

### Document stores — MongoDB and Couchbase

MongoDB offers `MongoRepository` (derived/`@Query` JSON) and the imperative `MongoTemplate` (`Query`/`Criteria`), plus the aggregation pipeline. Notable traps: `@DBRef` does not cascade saves (you wire an `AbstractMongoEventListener` + `@CascadeSave`), `autoIndexCreation()` is off by default, transactions need a replica set, and `ZonedDateTime` loses its zone (stored as a `Date`). Couchbase adds CAS-based optimistic locking via `@Version` and Views vs N1QL querying.

### Wide-column — Cassandra

Cassandra is query-first: the partition/clustering key shape *is* the access pattern, so the same data is denormalized into multiple tables per query. `@AllowFiltering` is required for non-PK predicates (and is a performance smell). Reactive variants (`ReactiveCassandraRepository`, `Mono`/`Flux`, `StepVerifier`) are first-class.

### Search and key-value — Elasticsearch, Redis, Neo4j

Elasticsearch uses `@MultiField` to keep both an analyzed `Text` field and an exact-match `keyword` sub-field, queried via `NativeSearchQueryBuilder`. Redis offers `@RedisHash` repositories, pub/sub, and pluggable serializers (the JDK default needs `Serializable`). Neo4j (OGM era) maps `@NodeEntity`/`@RelationshipEntity` and queries with Cypher.

### Teaching caveats

A green build does NOT prove the NoSQL paths ran — a large fraction of these "tests" are `*LiveTest`/`*ManualTest` needing external infra (Mongo/Cassandra/Couchbase/ES/Redis), are `@Ignore`d, or assert-inside-catch. The driver-3 Cassandra repo also shows string-concatenated CQL (injection) as a deliberate contrast to the driver-4 prepared/bound-statement path.

### 2026 currency

- **Elasticsearch client swap.** `RestHighLevelClient` is deprecated; the successor is the typed `ElasticsearchClient` (over `RestClient`). Spring Data Elasticsearch 5.0 made `ElasticsearchClient` + `ElasticsearchOperations` the default — corpus ES code (`RestHighLevelClient`, `NativeSearchQueryBuilder`) needs rewriting. The earlier Jest client is dead. [SDE 4.4→5.0 migration guide — docs.spring.io](https://docs.spring.io/spring-data/elasticsearch/reference/migration-guides/migration-guide-4.4-5.0.html)
- **Retired driver generations.** MongoDB driver 3.x (`DB`/`DBCollection`/`BasicDBObject`) removed in 4.x + Morphia 1.x rewritten in 2.x; Couchbase SDK 2.x → 3.x + N1QL; Cassandra DataStax `Cluster`/`Session` → `CqlSession` (driver 4) + `cassandra-unit` → Testcontainers; HBase client 1.x → 2.x; Spring Data Neo4j 5 + Neo4j-OGM → SDN 6 (OGM dropped entirely).
- **Cloud/community store churn.** Azure `com.microsoft.azure:spring-data-cosmosdb` → `com.azure:azure-spring-data-cosmos` (`@Document`→`@Container`); community `spring-data-dynamodb` (last release v5.1.0, 2019-01-28; dead) → AWS SDK v2 DynamoDB Enhanced Client; Pivotal GemFire → Apache Geode; Spring Data Solr EOL; Eclipse JNoSQL 0.0.6 → Jakarta NoSQL / JNoSQL 1.x. [DynamoDB Enhanced Client — docs.aws.amazon.com](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/dynamodb-enhanced-client.html) · [derjust/spring-data-dynamodb v5.1.0 — github.com](https://github.com/derjust/spring-data-dynamodb/releases/tag/v5.1.0)
- **Boot 3 property rename:** `spring.redis.*` → `spring.data.redis.*`.
- **The Spring Data NoSQL programming model carries forward** — what moved is the underlying driver generation under nearly every store.
