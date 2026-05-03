# @openacid/adapter-memory

> **In-memory adapters for [@openacid/acid](https://www.npmjs.com/package/@openacid/acid).**
> For tests and the dry-run agent path. Not for production.

Two adapters live here:

- **`MemoryStorageAdapter`** — `StorageAdapter` with truly atomic compare-and-swap (the cas critical section is fully synchronous). Passes all 12 cases of the standard `storageConformanceCases` test suite from `@openacid/acid`.
- **`MemorySigner`** — `SignerAdapter` that does **real secp256k1 signing** via viem's lower-level `sign()`. Not a mock — the receipts it produces verify against the address derived from the private key.

## Install

```bash
npm i @openacid/adapter-memory @openacid/acid
```

## Usage

```ts
import { MemoryStorageAdapter, MemorySigner } from '@openacid/adapter-memory'
import { saga, invariant, idempotent, receipted } from '@openacid/acid'

const storage = new MemoryStorageAdapter()
const signer = new MemorySigner(process.env.PRIVATE_KEY as `0x${string}`)

const action = receipted({ storage, signer, chain: { chainId: 16602 } })(
  invariant({ pre, post })(
    idempotent({ key: (a) => `op:${a.id}`, storage })(
      saga({ steps, compensations, storage }))))

await action(args)
```

## When to use

- ✅ **Unit tests, integration tests, CI**
- ✅ **The library's own demo scenes** — `pnpm demo:a/c/i/d` runs every primitive against this adapter in seconds, no chain calls
- ✅ **A dry-run mode** for an agent — exercise the saga, generate a real signed receipt, *don't* hit the network
- ❌ **Production** — state is gone the moment your process exits. Use `@openacid/adapter-0g-storage` for durable receipts.

## API

### `MemoryStorageAdapter`

Implements the full `StorageAdapter` interface. Supports TTL with second-resolution and structural-equality `cas`. The cas critical section is synchronous — concurrent `cas` calls with the same `expected` value are correctly serialized.

```ts
const store = new MemoryStorageAdapter({
  now: () => fakeClock,    // optional clock injection for deterministic TTL tests
})

await store.put('k', { v: 1 }, { ttl: 60 })
await store.get<{ v: number }>('k')                  // → { v: 1 }
await store.cas('k', { v: 1 }, { v: 2 })             // → true
await store.cas('k', { v: 1 }, { v: 3 })             // → false (current is now { v: 2 })
```

### `MemorySigner`

Signs raw 32-byte digests using real secp256k1. Use any 32-byte hex private key (Anvil's well-known keys work fine for tests).

```ts
const signer = new MemorySigner('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

signer.identity            // '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
await signer.publicKey()   // same address
await signer.sign(digest)  // → 0x... 65-byte signature; recovers to identity
```

Receipts produced via this signer verify with `verifyReceipt(receipt, signer.identity, domain)` from `@openacid/acid` — the signature is real, not a placeholder.

## Conformance

This package's own test suite imports `storageConformanceCases` from `@openacid/acid` and runs all 12 cases. If you're authoring a new `StorageAdapter`, do the same — the suite is the contract, and a conforming adapter will work under all four primitives.

## License

MIT — part of the [openacid](https://www.npmjs.com/package/@openacid/acid) library.
