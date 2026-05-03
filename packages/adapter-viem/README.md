# @openacid/adapter-viem

> **Chain-aware adapters for [@openacid/acid](https://www.npmjs.com/package/@openacid/acid), built on viem.**

Two adapters wired against viem's primitives, ready for any EVM chain (Base, Unichain, 0G Galileo, mainnet — anywhere `viem` connects):

- **`ViemChainAdapter`** — `ChainAdapter` over a `PublicClient`. Surfaces tx status (`pending` / `mined` / `finalized` / `replaced` / `failed`), waits for finality at a configurable confirmation depth, looks up txs by `(address, nonce)` for replacement detection.
- **`ViemSigner`** — `SignerAdapter` that signs raw 32-byte digests with secp256k1 via `viem/accounts`. Pair with `receipted()` to produce verifiable EIP-712 receipts.

## Install

```bash
npm i @openacid/adapter-viem @openacid/acid viem
```

## Usage

### Signer

```ts
import { ViemSigner } from '@openacid/adapter-viem'
import { receipted } from '@openacid/acid'

const signer = new ViemSigner({
  privateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
})

const action = receipted({
  storage,
  signer,
  chain: { chainId: 84532 },   // EIP-712 domain matches your target chain
  fnName: 'rebalance',
})(saga)
```

### Chain adapter

```ts
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { ViemChainAdapter } from '@openacid/adapter-viem'

const client = createPublicClient({ chain: baseSepolia, transport: http() })
const chain = new ViemChainAdapter({ client })

await chain.getBlockNumber()                              // → number
await chain.getTxByHash('0x...')                          // → 'mined' | 'finalized' | ...
await chain.getTxByNonce('0xabc...', 42)                  // → 'mined' | 'pending' | 'replaced' | null
await chain.waitForFinality('0x...', 1)                   // → 'finalized'
```

### Crash-safe broadcasting

Combine with `chainAwareBroadcast` from `@openacid/acid` to make a tx broadcast **survive a crash mid-broadcast** — on restart, the helper queries the chain for the prior tx and waits for it instead of re-broadcasting:

```ts
import { chainAwareBroadcast } from '@openacid/acid'

const out = await chainAwareBroadcast(
  { storage, chain, trackKey: `swap:${args.id}:tx`, confirmations: 1 },
  async () => walletClient.writeContract({ ... }),    // returns hash
)

if (out.reused) {
  // a previous run already broadcast; we just waited for finality.
}
```

## Tested against

- **Base Sepolia** (chainId 84532) — live integration tests in this repo's CI
- **0G Galileo** (chainId 16602) — receipts target this chain via the `receipted()` domain
- Any EVM viem supports — `mainnet`, `arbitrum`, `optimism`, etc.

## API

### `ViemChainAdapter`

```ts
new ViemChainAdapter({
  client: PublicClient,            // any viem PublicClient
  chainId?: number,                // override the client's chain id
  defaultPollIntervalMs?: number,  // for waitForFinality; default 2000
  defaultTimeoutMs?: number,       // for waitForFinality; default 120000
})
```

Replacement-tx detection: when a user bumps gas, the original tx is replaced — `getTxByHash(originalHash)` returns `'replaced'`, and `getTxByNonce(address, nonce)` will find the new one. Surface this and never re-broadcast on `'replaced'`.

### `ViemSigner`

```ts
new ViemSigner({
  privateKey: '0x...',             // 32-byte hex private key
})

signer.identity            // → 0x address derived from the key
await signer.publicKey()   // → same address
await signer.sign(digest)  // → 65-byte serialized signature
```

The signature recovers to `identity` via `verifyReceipt(receipt, signer.identity, domain)` from `@openacid/acid`, and on-chain via `ecrecover(digest, v, r, s)` in your own contracts.

## License

MIT — part of the [openacid](https://www.npmjs.com/package/@openacid/acid) library.
