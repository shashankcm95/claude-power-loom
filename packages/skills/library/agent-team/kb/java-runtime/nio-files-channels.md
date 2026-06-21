---
kb_id: java-runtime/nio-files-channels
version: 1
tags:
  - java-runtime
  - nio
  - filesystem
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-nio, core-java-nio-2"
  - "JEP 454: Foreign Function & Memory API (openjdk.org/jeps/454)"
related:
  - java-runtime/io-streams
  - java-runtime/networking
status: active
---

## Summary

**Concept**: NIO.2 (`java.nio.file`) — the modern file API: `Path`/`Files`, file attributes, `FileChannel` + memory mapping + locking, async channels, the `Selector` reactor, `WatchService`, and `walkFileTree`.
**Key APIs**: `Path`/`Paths`, `Files` (+ `StandardOpenOption`/`StandardCopyOption`), `BasicFileAttributes`, `FileChannel`/`MappedByteBuffer`, `AsynchronousFileChannel`, `Selector`/`SelectionKey`, `DatagramChannel`, `FileVisitor`/`Files.walkFileTree`, `WatchService`.
**Gotcha**: `FileChannel.tryLock()` returns null if unavailable (`OverlappingFileLockException` for same-JVM overlap); the `Selector` loop MUST `iter.remove()` each handled key; `File.delete()` returns false silently vs `Files.delete()` throws.
**2026-currency**: NIO.2 is the recommended modern file API; the FFM API (`Arena`+`MemorySegment.map`, JEP 454, JDK 22) is the deterministic successor to `MappedByteBuffer`.
**Sources**: Baeldung `core-java-nio`/`-nio-2` modules; JEP 454.

## Quick Reference

**`Path` API**: creation, decomposition (`getFileName`/`getName(i)`/`getNameCount`/`subpath`/`getParent`/`getRoot`), `normalize()` (collapses `.`/`..`), conversion (`toUri`/`toAbsolutePath`/`toRealPath`), `resolve` (join), `relativize`, comparison (`startsWith`/`endsWith`). `Path` <-> legacy `File` via `toPath`/`toFile`. `File.delete()` returns false silently; `Files.delete()` throws `NoSuchFileException`.

**`Files` API**: existence/permission checks; create/delete/copy/move with `StandardCopyOption` and `StandardOpenOption` (CREATE/CREATE_NEW/APPEND/WRITE/SPARSE/DELETE_ON_CLOSE/SYNC); checked-exception contract (`NoSuchFileException`, `DirectoryNotEmptyException`, `FileAlreadyExistsException`); directory emptiness via lazy `newDirectoryStream(...).iterator().hasNext()` (not `listFiles().length`); temp dirs; byte[] write.

**File attributes**: `BasicFileAttributes`/`BasicFileAttributeView`; per-attribute `Files.getAttribute(path, "creationTime")` -> `FileTime` (`toInstant()` bridges to `java.time`); POSIX `PosixFilePermissions`; symbolic links (`createSymbolicLink`/`readSymbolicLink`/`isSymbolicLink`, `LinkOption.NOFOLLOW_LINKS`).

**`FileChannel`**: random-access read/write via `ByteBuffer`; memory-map `channel.map(MapMode.READ_ONLY, off, len)` -> `MappedByteBuffer`; locking `tryLock`/`lock(pos,size,shared)`. Lock matrix: a `FileInputStream` channel is read-only (exclusive lock -> `NonWritableChannelException`), `FileOutputStream` write-only (shared lock -> `NonReadableChannelException`), `RandomAccessFile("rw")` both.

**Async / reactor / watch**:
- `AsynchronousFileChannel` / async socket channels — two idioms: `Future<Integer>` (poll `.get()`) or `CompletionHandler` (`completed`/`failed`).
- `Selector` (reactor): `configureBlocking(false)`, register `OP_ACCEPT`/`OP_READ`, `select()` -> iterate `selectedKeys()`, MUST `iter.remove()` each key or it re-fires.
- `DatagramChannel` for connectionless UDP; `flip()` before reading.
- `Files.walkFileTree` + `FileVisitor` (preVisitDirectory/visitFile/visitFileFailed/postVisitDirectory, returning `FileVisitResult`).
- `WatchService`: register `ENTRY_CREATE/DELETE/MODIFY`, blocking `take()`, drain `pollEvents()`, `key.reset()`.

**Current (mid-2026)**: NIO.2 is the recommended modern file API. The **FFM API** (`Arena` + `MemorySegment.map`, JEP 454, JDK 22) gives bounded, deterministically-freed mapping vs `MappedByteBuffer`'s GC-tied unmapping.

## Full content

NIO.2 is the recommended modern file API and the corpus covers it comprehensively across `core-java-nio` and `core-java-nio-2`: `Path` manipulation, the `Files` operation menu, file attributes, channels and memory mapping, async channels, the `Selector` reactor, directory walking, and filesystem watching.

### Path and Files

`Path` is the immutable, manipulable replacement for `File`'s path role: it decomposes (`getFileName`, `getName(i)`, `subpath`, `getParent`, `getRoot`), normalizes (`normalize()` collapses `.`/`..`), converts (`toUri`, `toAbsolutePath`, `toRealPath`), joins (`resolve`), and relativizes (`relativize`). You interconvert with the legacy `File` via `toPath`/`toFile`. The `Files` utility performs the actual operations with a much stronger error contract than `File`: where `File.delete()` returns false silently, `Files.delete()` throws `NoSuchFileException`, and copy/move throw `FileAlreadyExistsException`/`DirectoryNotEmptyException`. Behavior is controlled by `StandardCopyOption` and `StandardOpenOption` (CREATE, CREATE_NEW, APPEND, WRITE, SPARSE, DELETE_ON_CLOSE, SYNC). Checking directory emptiness lazily with `newDirectoryStream(...).iterator().hasNext()` is far cheaper than `listFiles().length`.

### File attributes

`BasicFileAttributes`/`BasicFileAttributeView` read whole attribute bundles; `Files.getAttribute(path, "creationTime")` reads one and returns a `FileTime` whose `toInstant()` bridges to `java.time`. Evidence: `core-java-nio/.../creationdate/CreationDateResolver.java`. POSIX permissions go through `PosixFilePermissions`; symbolic and hard links through `createSymbolicLink`/`createLink`/`readSymbolicLink`/`isSymbolicLink`, with `LinkOption.NOFOLLOW_LINKS` to avoid following.

### Channels and locking

`FileChannel` does random-access read/write through a `ByteBuffer`, memory-maps a region with `channel.map(MapMode.READ_ONLY, off, len)` returning a `MappedByteBuffer`, and locks ranges with `tryLock`/`lock(pos, size, shared)`. `tryLock` returns null if the lock is unavailable, and same-JVM overlap throws `OverlappingFileLockException`; file locks are OS-advisory. The lock matrix matters: a `FileInputStream` channel is read-only (an exclusive lock throws `NonWritableChannelException`), a `FileOutputStream` channel is write-only (a shared lock throws `NonReadableChannelException`), and only `RandomAccessFile("rw")` supports both. Evidence: `core-java-nio/.../filechannel/FileChannelUnitTest.java`, `core-java-nio-2/.../lock/FileLocks.java`.

### Async, reactor, walking, watching

Asynchronous channels (`AsynchronousFileChannel`, `AsynchronousServerSocketChannel`/`AsynchronousSocketChannel`) offer two completion idioms — a polled `Future<Integer>` or a `CompletionHandler` with `completed`/`failed` callbacks (async reads into a fixed buffer without a partial-read loop only work for tiny files). The `Selector` implements the single-threaded reactor pattern: set `configureBlocking(false)`, register interest ops (`OP_ACCEPT`/`OP_READ`), run an event loop `select()` -> iterate `selectedKeys()`, and crucially `iter.remove()` each handled key or it re-fires. Evidence: `core-java-nio-2/.../selector/EchoServer.java`. `DatagramChannel` handles connectionless UDP (receive returns the sender `SocketAddress`; `flip()` before reading). `Files.walkFileTree` drives a `FileVisitor`'s four callbacks (preVisitDirectory/visitFile/visitFileFailed/postVisitDirectory), each returning a `FileVisitResult` (CONTINUE/TERMINATE/SKIP_SUBTREE/SKIP_SIBLINGS). `WatchService` notifies on filesystem change: register a `Path` for `ENTRY_CREATE/DELETE/MODIFY`, block on `take()`, drain `key.pollEvents()`, and call `key.reset()` to keep watching (macOS historically polls with multi-second latency).

### 2026 currency

- **NIO.2 is the recommended modern file API** and the whole surface (Path, Files, channels, Selector, WatchService, async channels) carries forward unchanged in 2026.
- **FFM API as the `MappedByteBuffer` successor** for large/off-heap files — `Arena` + `MemorySegment.map(...)` give bounded, deterministically-freed memory mapping versus `MappedByteBuffer`'s GC-tied unmapping. [JEP 454: Foreign Function & Memory API](https://openjdk.org/jeps/454)
- Convenience successors the corpus predates: `Files.writeString`/`readString`, `InputStream.transferTo`. (Per JDK release history.)
