# @openacid/acid

> **Durable execution primitives for AI agents that hold real money.**
> Postgres taught your backend ACID semantics. OpenACID teaches your agents.

Four small higher-order functions — `saga`, `invariant`, `idempotent`, `receipted` — that bring the four classical database guarantees (**A**tomicity, **C**onsistency, **I**solation, **D**urability) to autonomous agent actions, especially on-chain ones.

```ts
import { saga, invariant, idempotent, receipted } from "@openacid/acid";

const action = receipted(
  // D — signed durable receipts
  invariant(
    { pre, post }, // C — invariants enforced at boundaries
    idempotent(
      // I — concurrent + crash-safe
      saga({ steps, compensations }),
    ),
  ),
); // A — atomic multi-step rollback

await action(args); // exactly-once, observable, recoverable
```

## Why

Agents that hold value silently lose money to a recurring class of failures with no productized solution: process crash mid-broadcast (→ duplicate tx), concurrent retries (→ double spend), LLM-loop replay (→ wasted gas), multi-step partial failure (→ orphan approvals), postcondition violations (→ silent invariant breaks).

`p-retry` is too thin. `bullmq`/`inngest` are too heavy and don't speak chain. Stripe-style idempotency keys assume _you're the client_ — useless when you _are_ the service. OpenACID is a small library, not a workflow engine.

## Install

```bash
npm i @openacid/acid
# adapters (pick what you need)
npm i @openacid/adapter-memory       # for tests
npm i @openacid/adapter-viem         # ChainAdapter + SignerAdapter on viem
npm i @openacid/adapter-0g-storage   # receipts on 0G blob storage
npm i @openacid/adapter-ens          # mirror receipts to ENS text records
```

## The four primitives

Each is a higher-order function: takes a function, returns a function with the guarantee added. Uniform signature:

```ts
type Wrapper<A, R> = (fn: (args: A) => Promise<R>) => (args: A) => Promise<R>;
```

| Primitive    | What it adds                                                  | DB analogue                   |
| ------------ | ------------------------------------------------------------- | ----------------------------- |
| `idempotent` | Exactly-once execution; in-flight dedup; crash-safe key cache | Locking / MVCC                |
| `saga`       | Multi-step transactions with compensation in reverse order    | Transaction log + 2PC         |
| `invariant`  | Pre/post predicate enforcement at action boundaries           | Schema constraints + triggers |
| `receipted`  | EIP-712 signed, hash-chained, durable execution receipts      | WAL + fsync + replication     |

## Composition order

The recommended order, outer to inner:

```
receipted ▸ invariant ▸ idempotent ▸ saga
```

- **`receipted` outermost** — every call gets a receipt, including ones that fail invariants. Receipts are an audit trail of _attempts_, not just successes.
- **`invariant` next** — predicates run before idempotency dedup; postconditions run after the wrapped saga commits.
- **`idempotent` next** — dedup once we know the call is admissible.
- **`saga` innermost** — the transactional unit.

The library validates composition at construction time and warns on inverted orders.

## 30-second example

```ts
import {
  saga,
  invariant,
  idempotent,
  receipted,
  noOrphanAllowances,
} from "@openacid/acid";
import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";

const storage = new MemoryStorageAdapter();
const signer = new MemorySigner();

const swap = saga<{ amount: bigint; deadline: number }>({
  steps: [
    {
      id: "approve",
      do: async () => ({ tx: "0xappr", token: "USDC", amount: 1000n }),
    },
    { id: "swap", do: async () => ({ tx: "0xswap", out: 950n }) },
  ],
  compensations: {
    approve: async (_ctx, prior) => {
      // revoke the allowance we just set
      console.log("revoking", prior);
    },
  },
  storage,
});

const guarded = invariant({
  pre: async (a) =>
    a.amount > 0n || { reason: "amount must be positive", severity: "high" },
  post: noOrphanAllowances({
    getAllowances: async () => [], // no leftover approvals
    allow: () => false,
  }),
})(swap);

const deduped = idempotent({
  key: (a) => `swap:${a.amount}:${a.deadline}`,
  storage,
  inFlight: "block",
})(guarded);

const action = receipted({
  storage,
  signer,
  chain: { chainId: 16602 },
  fnName: "swap",
})(deduped);

await action({ amount: 1000n, deadline: Date.now() + 60_000 });
```

If the swap step throws, the saga runs `approve`'s compensation in reverse. If two parallel callers fire with the same args, only one execution happens. If a postcondition reports `noOrphanAllowances` violated, the action is rejected. Every attempt — successful or not — produces a signed, hash-chained receipt persisted to your storage adapter.

## Adapters

The four primitives are chain-agnostic and storage-agnostic. Concrete implementations live behind three interfaces:

```ts
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  cas<T>(key: string, expected: T | null, next: T): Promise<boolean>;
}

interface ChainAdapter {
  chainId: number;
  getTxByHash(hash: string): Promise<TxStatus | null>;
  getTxByNonce(address: string, nonce: number): Promise<TxStatus | null>;
  waitForFinality(hash: string, confirmations: number): Promise<TxStatus>;
  getBlockNumber(): Promise<number>;
}

interface SignerAdapter {
  identity: string;
  sign(message: Uint8Array): Promise<string>;
  publicKey(): Promise<string>;
}
```

Available implementations:

- [`@openacid/adapter-memory`](https://www.npmjs.com/package/@openacid/adapter-memory) — in-memory KV + signer for tests
- [`@openacid/adapter-viem`](https://www.npmjs.com/package/@openacid/adapter-viem) — `ChainAdapter` + `SignerAdapter` on viem (any EVM)
- [`@openacid/adapter-0g-storage`](https://www.npmjs.com/package/@openacid/adapter-0g-storage) — `StorageAdapter` writing to 0G Storage (Galileo testnet)
- [`@openacid/adapter-ens`](https://www.npmjs.com/package/@openacid/adapter-ens) — mirrors receipts as ENS text records (`receipt.latest`, `receipt.head`)

Conformance tests for the `StorageAdapter` interface are exported as `storageConformanceCases` from this package — run them against your own adapter to make sure the four primitives will work on top of it.

## Reference deployment

A reference receipt-anchoring contract `ReceiptRegistry.sol` is deployed live on **0G Galileo (chainId 16602)** at:

```
0xd3E6277960025B4D0c161e20304a3a44231d0D1C
```

It anchors merkle roots over receipt batches and verifies receipts on-chain via `ecrecover` against the signer. The reference agent's signer publishes its latest receipt CID to **`openacid.eth`** on Sepolia ENS as a `text` record. Verifiable from any ENS resolver, no library install:

```bash
cast call 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5 \
  "text(bytes32,string)(string)" \
  $(cast namehash openacid.eth) "receipt.latest" \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

## Honest limitations

- **Atomicity** is bounded by saga scope, not global. Forget to wrap → no atomicity.
- **Consistency** invariants are user-defined predicates, not schema-derived. GIGO applies.
- **Isolation** is action-level, not multi-action. Serializable across many sagas needs a global lock manager.
- **Durability** assumes a finality model. v0 ships with 1-block finality on L2s; deeper reorg handling is future work.
- LLMs are non-deterministic. Replay is "approximate replay" unless model + seed are pinned.
- Receipts are **tamper-evident**, not tamper-proof. A signed receipt proves the signer attested to it; it does not prove the data is true.

## Links

- **Repo + docs:** [github.com/sairammr/acid](https://github.com/RomarioKavin1/acid)
- **Reference agent:** `examples/multi-step-uniswap-agent` — Base Sepolia portfolio rebalancer, V4 swap wrapped in `receipted(invariant(idempotent(saga())))`
- **Receipt registry tx:** [chainscan-galileo.0g.ai/tx/0x3dc372…87e1](https://chainscan-galileo.0g.ai/tx/0x3dc372a467edbee7507f3bd90061874a8625f0efaf05eb62cd190779128687e1)

## License

MIT
