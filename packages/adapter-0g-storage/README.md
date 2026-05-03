# @openacid/adapter-0g-storage

> **Receipt durability for [@openacid/acid](https://www.npmjs.com/package/@openacid/acid), backed by 0G Storage.**

A `StorageAdapter` that persists receipts and saga state as content-addressed blobs on **0G Galileo** (chainId 16602). Live conformance suite (10/10) passes against real 0G testnet — verifiable on-chain.

## Install

```bash
npm i @openacid/adapter-0g-storage @openacid/acid
```

## Usage

```ts
import { ZeroGStorageAdapter } from '@openacid/adapter-0g-storage'
import { receipted } from '@openacid/acid'

const storage = new ZeroGStorageAdapter({
  evmRpc: process.env.ZEROG_CHAIN_RPC!,
  indexerRpc: process.env.ZEROG_STORAGE_INDEXER_RPC!,
  privateKey: process.env.ZEROG_CHAIN_PRIVATE_KEY!,
})

const action = receipted({
  storage,                       // receipts persist to 0G blobs
  signer,
  chain: { chainId: 16602 },     // EIP-712 domain pinned to Galileo
})(saga)
```

## Tradeoffs

0G Storage commits every blob upload as an on-chain transaction (`flow.submit`). That makes it the right home for **receipts and saga state** — values you want durably anchored — and the wrong home for hot in-flight markers and the idempotency cache.

This adapter is a **write-through hybrid**:

- Reads serve from in-process state when possible.
- Writes persist a JSON-serialized snapshot to 0G blob storage and remember the `rootHash`.
- `cas` is single-process atomic; not safe across crashed restarts of *this* adapter — use `@openacid/adapter-memory` (or future `adapter-redis`) for hot in-flight markers.

## Recommended layout

```ts
import { ZeroGStorageAdapter } from '@openacid/adapter-0g-storage'
import { MemoryStorageAdapter } from '@openacid/adapter-memory'

const hot  = new MemoryStorageAdapter()     // idempotent locks, in-flight saga state
const cold = new ZeroGStorageAdapter({...}) // signed receipts, archived saga snapshots

const action = receipted({ storage: cold, ... })(
  idempotent({ storage: hot, ... })(
    saga({ storage: hot, ... })))
```

## Configuration

```ts
new ZeroGStorageAdapter({
  evmRpc: 'https://evmrpc-testnet.0g.ai',           // 0G Galileo RPC
  indexerRpc: 'https://indexer-storage-testnet-...', // 0G Storage indexer
  privateKey: '0x...',                              // wallet with testnet 0G for flow fees
  expectedReplica: 1,                               // optional; default 1
  cacheTtlSec: 86_400,                              // optional; pointer TTL
})
```

## Required env (suggested names)

```
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_CHAIN_PRIVATE_KEY=0x<hex>
```

Get testnet 0G from [`faucet.0g.ai`](https://faucet.0g.ai) (0.1 0G/wallet/day; storage flow fees are tiny).

## Verifying it works

The package ships a live conformance suite that runs the standard `storageConformanceCases` from `@openacid/acid` against the real Galileo testnet. With env present:

```bash
ZEROG_CHAIN_RPC=... ZEROG_STORAGE_INDEXER_RPC=... ZEROG_CHAIN_PRIVATE_KEY=... \
  pnpm test packages/adapter-0g-storage
```

**10/10** test cases pass — round-trips, read-your-writes, delete, and `cas` (including concurrent races) all verified against the live network. Each `put` is a real on-chain `flow.submit`; receipts you persist with this adapter are reproducible from the chain.

## Reference deployment

A companion contract anchors merkle roots over receipt batches:

- **ReceiptRegistry** on 0G Galileo: `0xd3E6277960025B4D0c161e20304a3a44231d0D1C`
- **Verify on-chain:** `ReceiptRegistry.verifyReceipt(anchorId, digest, proof, sig)` runs `ecrecover(digest, v, r, s)` against the anchored signer.

## Honest limitations

- Not safe under multi-process concurrency. The `cas` semantics are in-process only.
- Every write is an on-chain tx, so this adapter pays gas. Don't use it for hot loops; pair with a memory adapter for those keys.
- Reorg handling on the storage layer is delegated to 0G's finality model (1-block on the storage flow).

## License

MIT — part of the [openacid](https://www.npmjs.com/package/@openacid/acid) library.
