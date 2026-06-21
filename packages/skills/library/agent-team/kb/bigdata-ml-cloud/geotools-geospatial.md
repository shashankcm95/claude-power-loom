---
kb_id: bigdata-ml-cloud/geotools-geospatial
version: 1
tags:
  - bigdata-ml-cloud
  - geotools
  - geospatial
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: geotools"
  - "GeoTools 34.0 Release (geotoolsnews.blogspot.com/2025/10/geotools-340-release.html)"
related:
  - bigdata-ml-cloud/saas-integrations
status: active
---

## Summary

**Concept**: GeoTools is the JVM GIS toolkit — define a feature schema, attach WGS84 geometry via JTS, and write features to an ESRI Shapefile inside a transaction.
**Key APIs**: `SimpleFeatureTypeBuilder` or `DataUtilities.createType("Location","location:Point:srid=4326,name:String")`; `DefaultGeographicCRS.WGS84` (EPSG:4326); JTS `GeometryFactory.createPoint(new Coordinate(...))`; `SimpleFeatureBuilder`, `DefaultFeatureCollection`, `ShapefileDataStore` + `DefaultTransaction`.
**Gotcha**: code stores (lat, lng) but WGS84/shapefile convention is (x=lng, y=lat) — coordinates look swapped; `getNewShapeFile()` concatenates path with no separator; `System.exit(0)` inside a library method is hostile to embedding.
**2026-currency**: GeoTools 34.0 (Oct 2025) requires Java 17 (33.x was Java 11); corpus's 15.2 is ~19 majors behind; the `com.vividsolutions.jts`→`org.locationtech.jts` package move is long done.
**Sources**: Baeldung `geotools` module; GeoTools 34.0 release.

## Quick Reference

**Define a feature type** (two ways):
- Programmatic: `SimpleFeatureTypeBuilder`
- DSL: `DataUtilities.createType("Location", "location:Point:srid=4326,name:String")`

**Coordinate reference system**: WGS84 = `DefaultGeographicCRS.WGS84` = EPSG:4326.

**Geometry (JTS)**: `GeometryFactory.createPoint(new Coordinate(x, y))`.

**Build + collect features**:
- `SimpleFeatureBuilder` adds attributes → builds a `SimpleFeature`
- Collect into a `DefaultFeatureCollection`

**Write a Shapefile (in a transaction)**:
- `ShapefileDataStore` + `DefaultTransaction`
- `commit` / `rollback` / `close`

**Top gotchas**:
- The code stores (lat, lng) but WGS84/shapefile convention is **(x=lng, y=lat)** — the coordinates look swapped.
- `getNewShapeFile()` concatenates the path without a separator (malformed-path bug).
- `System.exit(0)` inside a library method is hostile to embedding.

**Current (mid-2026)**: **GeoTools 34.0 (Oct 2025)** is the first series to require **Java 17** (33.x was Java 11). The corpus's 15.2 is ~19 majors behind, and the **`com.vividsolutions.jts`→`org.locationtech.jts`** JTS package move (~2017) is long done — corpus imports of the old package won't resolve.

## Full content

GeoTools is the open-source JVM GIS library; the Baeldung `geotools` module demonstrates the canonical "build features and write a shapefile" workflow.

It starts by defining a `SimpleFeatureType` — the schema for the geographic features — either programmatically with a `SimpleFeatureTypeBuilder` or through the compact DSL `DataUtilities.createType("Location", "location:Point:srid=4326,name:String")`. The coordinate reference system is WGS84 (`DefaultGeographicCRS.WGS84`, EPSG:4326), the standard lat/lng datum. Geometry comes from JTS: a `GeometryFactory.createPoint(new Coordinate(...))` builds the point geometry.

Features are assembled with a `SimpleFeatureBuilder` (adding the geometry and attributes), collected into a `DefaultFeatureCollection`, and then written to an ESRI Shapefile inside a transaction: a `ShapefileDataStore` paired with a `DefaultTransaction`, with explicit `commit`/`rollback`/`close`.

The module's most instructive gotcha is the **axis-order trap**: the code stores coordinates as (lat, lng), but the WGS84/shapefile convention is (x=lng, y=lat), so the coordinates here appear swapped — a classic GIS bug. Two further smells: `getNewShapeFile()` concatenates the file path without a separator (producing a malformed path), and a library method calls `System.exit(0)`, which is hostile to any caller trying to embed the code.

### 2026 currency

GeoTools is at **34.x**. **GeoTools 34.0 (Oct 2025)** is the first series to require **Java 17** (33.x required Java 11) ([GeoTools 34.0 Release (geotoolsnews.blogspot.com)](http://geotoolsnews.blogspot.com/2025/10/geotools-340-release.html) · [Java Install — GeoTools 35.x User Guide](https://docs.geotools.org/latest/userguide/build/install/jdk.html)). The corpus's 15.2 is roughly 19 majors behind. The long-completed **`com.vividsolutions.jts`→`org.locationtech.jts`** JTS package move (~2017) means corpus imports of the old `com.vividsolutions.jts.*` package no longer resolve — that rename plus the Java 17 floor are the two changes any migration must address first.
