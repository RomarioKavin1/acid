# @openacid/adapter-0g-storage

A `StorageAdapter` backed by 0G Storage. Designed for **receipt persistence**, not high-frequency in-flight markers.

## Tradeoffs

0G Storage commits every blob upload as an on-chain transaction (`flow.submit`). That makes it the right home for **receipts and saga state** — values you want durably anchored — and the wrong home for hot in-flight markers and the idempotency cache.

This adapter is a **write-through hybrid**:
- Reads serve from in-process state when possible.
- Writes persist a JSON-serialized snapshot to 0G blob storage and remember the `rootHash`.
- `cas` is single-process atomic; not safe across crashed restarts of *this* adapter (use a memory or Redis adapter for hot state).

## Recommended layout

```ts
import { ZeroGStorageAdapter } from "@openacid/adapter-0g-storage";
import { MemoryStorageAdapter } from "@openacid/adapter-memory";

const hot = new MemoryStorageAdapter();    // idempotent locks, saga state in flight
const cold = new ZeroGStorageAdapter({ ... }); // receipts, archived saga snapshots
```

## Required env

```
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=<indexer URL>
ZEROG_CHAIN_PRIVATE_KEY=<wallet with Galileo testnet 0G for storage flow fees>
```

Get testnet 0G from `https://faucet.0g.ai`.
