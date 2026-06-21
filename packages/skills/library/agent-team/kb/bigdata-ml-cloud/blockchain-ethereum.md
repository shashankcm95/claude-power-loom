---
kb_id: bigdata-ml-cloud/blockchain-ethereum
version: 1
tags:
  - bigdata-ml-cloud
  - blockchain
  - ethereum
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: java-blockchain"
  - "Baeldung tutorials (eugenp/tutorials) module: ethereum"
  - "Releases · LFDT-web3j/web3j (github.com/LFDT-web3j/web3j/releases)"
related:
  - bigdata-ml-cloud/jvm-machine-learning
status: active
---

## Summary

**Concept**: JVM blockchain — a from-scratch SHA-256 proof-of-work chain plus Ethereum integration via two routes: EthereumJ (embedded full node) and Web3j (lightweight JSON-RPC client + smart-contract wrappers).
**Key APIs**: `MessageDigest.getInstance("SHA-256")`, `mineBlock(prefix)` nonce loop; `EthereumFactory.createEthereum()`, `EthereumListenerAdapter`; `Web3j.build(new HttpService(provider))`, `ethBlockNumber`/`ethGetBalance`/`ethSendTransaction` via `sendAsync().get()`; web3j-codegen contract wrappers, `WalletUtils.loadCredentials`, `FunctionEncoder.encode`.
**Gotcha**: `Block.setData` doesn't recompute the hash (silently invalidates the chain); `calculateBlockHash` logs but doesn't rethrow → NPE; EthereumJ's Bintray repo is dead (broken build).
**2026-currency**: Ethereum moved to Proof-of-Stake (The Merge 2022) — mining/hash-rate obsolete for mainnet; EIP-1559 is the fee model; web3j is at v5.x under LFDT (`LFDT-web3j/web3j`); Solidity `^0.4.x` won't compile on 0.8.x.
**Sources**: Baeldung `java-blockchain` + `ethereum` modules; LFDT web3j releases.

## Quick Reference

**From-scratch blockchain** (`java-blockchain`):
- `Block{data, previousHash, timeStamp, nonce, hash}`
- Hash: SHA-256 over `previousHash + timeStamp + nonce + data` (`MessageDigest.getInstance("SHA-256")`, hex via `String.format("%02x", b)`)
- Proof-of-work: `mineBlock(prefix)` increments `nonce` until the hash has N leading-zero characters
- Validation: recompute hashes, check linkage + PoW prefix

**Ethereum — two routes**:
| Route | Shape |
|---|---|
| **EthereumJ** | embed a full Java node — `EthereumFactory.createEthereum()`, `EthereumListenerAdapter` (`onBlock`/`onSyncDone`), blockchain-facade queries |
| **Web3j** | lightweight JSON-RPC client — `Web3j.build(new HttpService(provider))`, `ethX(...).sendAsync().get()`, `DefaultBlockParameter.valueOf("latest")` |

**Smart contracts** (web3j): write Solidity → generate Java wrappers via web3j-codegen (extend `org.web3j.tx.Contract`, `RemoteCall`, `executeRemoteCallTransaction`) → deploy/load/call/transact. Wallets: `WalletUtils.generateNewWalletFile`/`loadCredentials` → `Credentials`. Manual ABI: `FunctionEncoder.encode`. Exposed via Spring MVC `@Async` returning `CompletableFuture`.

**Top gotchas**:
- `Block.setData` mutates data without recomputing the hash — silently invalidates the chain (a teaching blockchain should be immutable).
- `calculateBlockHash` logs but doesn't rethrow, leaving `bytes` null → NPE; web3j sample methods swallow exceptions.

**Current (mid-2026)**: Ethereum's **Proof-of-Stake** transition (The Merge, 2022) stands — mining/hash-rate concepts are obsolete for mainnet; **EIP-1559** is the fee model (web3j supports it since 4.8.x). web3j **left Hyperledger for LF Decentralized Trust** — the repo is now `LFDT-web3j/web3j`, current line **v5.x**. The corpus's 3.3.1 is two majors behind with a dead Bintray repo. Solidity `^0.4.x` won't compile on `solc` 0.8.x.

## Full content

The corpus covers blockchain at two altitudes: a pedagogical from-scratch chain and real Ethereum integration.

The **from-scratch blockchain** (`java-blockchain`) is pure JDK and timeless as a hashing/chaining teaching artifact. A `Block` holds `{data, previousHash, timeStamp, nonce, hash}`; the hash is SHA-256 over `previousHash + timeStamp + nonce + data` (using `MessageDigest.getInstance("SHA-256")` and hex formatting via `String.format("%02x", b)`). Proof-of-work mining increments the `nonce` until the resulting hash starts with N leading zeros (`mineBlock(prefix)`), and chain validation recomputes every hash and checks both linkage and the PoW prefix. Its teaching foot-gun is mutability: `Block.setData` changes the data without recomputing the hash, silently invalidating the chain — a teaching blockchain should be immutable.

**Ethereum integration** (`ethereum`) offers two routes. **EthereumJ** embeds a full Java node in-process (`EthereumFactory.createEthereum()`, an `EthereumListenerAdapter` with `onBlock`/`onSyncDone`, and blockchain-facade queries). **Web3j** is the lightweight alternative: a JSON-RPC client (`Web3j.build(new HttpService(provider))`) issuing async calls (`ethBlockNumber`, `ethGetBalance`, `ethSendTransaction` via `sendAsync().get()`, with `DefaultBlockParameter.valueOf("latest")`).

**Smart contracts** are handled the web3j way: write Solidity, generate Java wrappers with web3j-codegen (each wrapper extends `org.web3j.tx.Contract`, using `RemoteCall` and `executeRemoteCallTransaction`), then deploy/load/call/transact. Wallets come from `WalletUtils.generateNewWalletFile`/`loadCredentials` (yielding `Credentials`), and manual ABI encoding uses `FunctionEncoder.encode`. The whole thing is exposed through Spring MVC `@Async` REST endpoints returning `CompletableFuture`. Error handling is the recurring weakness — web3j sample methods swallow exceptions and return strings.

### 2026 currency

Ethereum's **Proof-of-Stake** transition (The Merge, 2022) stands: mining and net-hash-rate / difficulty concepts are obsolete for mainnet, and **EIP-1559** is the current fee model, supported in web3j since the 4.8.x line ([EIP-1559 Transaction (docs.web3j.io 4.14.0)](https://docs.web3j.io/4.14.0/transactions/EIP_transaction_types/eip1559_transaction/) · [Announcing Web3j support for EIP-1559 (Web3 Labs)](https://blog.web3labs.com/announcing-web3j-support-for-eip-1559/)).

web3j changed governance and majors: it **left Hyperledger for LF Decentralized Trust (LFDT)**, so the repo is now `LFDT-web3j/web3j` and the current line is the **web3j v5.x line** with Gradle 9 compatibility ([Web3j (lfdecentralizedtrust.org)](https://www.lfdecentralizedtrust.org/projects/web3j) · [Releases · LFDT-web3j/web3j](https://github.com/LFDT-web3j/web3j/releases)). The corpus's web3j 3.3.1 is two majors behind with a changed repo home. **EthereumJ is archived** (~2019) and its Bintray repo (`dl.bintray.com/ethereum/maven`) is dead (Bintray shut down 2021) — there is no drop-in JVM full-node successor; use web3j (light JSON-RPC) or Besu (Apache-2.0). On Solidity, `^0.4.x` (named-function constructors, missing visibility, `constant`) won't compile on `solc` 0.8.x — constructor visibility was removed across 0.7.0→0.8.0 (use `abstract`); 0.8.x is current ([Solidity v0.7.0 Breaking Changes (docs.soliditylang.org)](https://docs.soliditylang.org/en/latest/070-breaking-changes.html)).
