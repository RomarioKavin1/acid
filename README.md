# OpenACID

> **Durable execution primitives for AI agents that hold real money.**
> Postgres taught your backend ACID semantics. ACID teaches your agents.

OpenACID is a small, composable npm library that brings the four classical database guarantees — **A**tomicity, **C**onsistency, **I**solation, **D**urability — to autonomous agent actions, especially on-chain ones.

```ts
import { saga, invariant, idempotent, receipted } from '@openacid/acid'

const action = receipted(           // D — signed durable receipts
  invariant({ pre, post },          // C — invariants enforced at boundaries
    idempotent(                     // I — concurrent + crash-safe
      saga(steps, compensations))))// A — atomic multi-step rollback
```

Four primitives. One nested call. ACID for agents.

## Why this exists

Agents that hold value silently lose money to a recurring class of failures that has no productized solution:

| Failure mode | What happens today | Cost |
|---|---|---|
| Process crash mid-broadcast | Agent re-broadcasts on restart → **duplicate transaction** | 2× gas + 2× slippage + over-rotated portfolio |
| Concurrent retries | Two parts of the agent race for the same action | Double execution |
| LLM-loop replay | Planner re-emits the same tool call after a timeout | Double execution, wasted tokens |
| Multi-step partial failure | Step 2 fails after step 1 mined; orphan state on chain | Standing approvals, half-rotated positions |
| Postcondition violations | Action "succeeded" but left the wallet in an invalid state | Silent invariant breaks |

`p-retry` is too thin. `bullmq`/`inngest` are too heavy and don't speak chain. Stripe-style idempotency keys assume *you're the client* — useless when you *are* the service. OpenACID fills the gap with **agent-shaped durability semantics** as a small library, not a workflow engine.

## The four primitives

| Primitive | What it adds | What it owns |
|---|---|---|
| `idempotent` | Exactly-once execution; in-flight dedup; crash-safe key cache | Idempotency keys, in-flight markers, completed-result cache |
| `saga` | Multi-step transactions with compensation; replay-from-last-step | Saga state, step results, compensation invocations |
| `invariant` | Pre/post predicate enforcement | Predicate evaluations, violation reports |
| `receipted` | Signed, chained, durable execution receipts | Receipt construction (EIP-712), signing, persistence, chain pointers |

| ACID property | Database mechanism | OpenACID mechanism |
|---|---|---|
| **A**tomicity | Transaction log + 2PC | `saga(steps, compensations)` |
| **C**onsistency | Schema constraints + triggers | `invariant({ pre, post }, fn)` |
| **I**solation | Locking / MVCC | `idempotent(fn, key)` with in-flight tracking |
| **D**urability | WAL + fsync + replication | `receipted(fn)` — signed chained receipts on 0G Storage |

## Install

```bash
npm i @openacid/acid                 # the four primitives
npm i @openacid/adapter-memory       # for tests
npm i @openacid/adapter-viem         # ChainAdapter + SignerAdapter on viem
npm i @openacid/adapter-0g-storage   # receipts on 0G blob storage
npm i @openacid/adapter-ens          # mirror receipts to ENS text records
```

## Quick start (this repo)

```bash
pnpm install
pnpm test               # 97 vitest + 8 forge tests
pnpm typecheck

# Run the example agent against Base Sepolia (no funds needed)
pnpm --filter @openacid/example-uniswap-agent dry-run
```

`.env.local` (see `.env.example`):

```
EVM_PRIVATE_KEY=0x...               # signer for the agent
BASE_SEPOLIA_RPC=https://sepolia.base.org

# 0G Galileo (chainId 16602) — receipts persist here
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=...
ZEROG_CHAIN_PRIVATE_KEY=0x...
```

## Architecture

```
USER CODE
  agent.swap = receipted(invariant(idempotent(saga(...))))
                  │
   ┌──────────────┴──────────────┐
   │   @openacid/acid (core)      │
   │   ┌────────┬────────┬─────┐  │
   │   │idempot.│ saga   │inv. │  │
   │   ├────────┴────────┼─────┤  │
   │   │     receipted   │     │  │
   │   └────────┬────────┴─────┘  │
   │            │                 │
   │   StorageAdapter / ChainAdapter / SignerAdapter
   └────────────┼─────────────────┘
                │
  ┌─────────────┼─────────────┬──────────────┐
  │             │             │              │
adapter-     adapter-     adapter-      adapter-ens
memory       0g-storage   viem          (Phase 6)
```

## Reference contract

`contracts/src/ReceiptRegistry.sol` is **deployed live on 0G Galileo (chainId 16602)** at:

> **`0xd3E6277960025B4D0c161e20304a3a44231d0D1C`**
>
> Deployment tx: [`0x3dc372a467edbee7507f3bd90061874a8625f0efaf05eb62cd190779128687e1`](https://chainscan-galileo.0g.ai/tx/0x3dc372a467edbee7507f3bd90061874a8625f0efaf05eb62cd190779128687e1)

It anchors merkle roots over receipt batches and verifies receipts on-chain via `ecrecover` against the signer's address. 8 Foundry tests cover the merkle + signature path.

```bash
cd contracts
forge test                          # local
forge script script/Deploy.s.sol \
  --rpc-url $ZEROG_CHAIN_RPC \
  --broadcast \
  --priority-gas-price 3000000000   # 0G chain min priority fee
```

## Honest limitations

- **Atomicity** is bounded by saga scope, not global. Forget to wrap → no atomicity.
- **Consistency** invariants are user-defined predicates, not schema-derived. GIGO applies.
- **Isolation** is action-level, not multi-action. Serializable across many sagas needs a global lock manager (v1 territory).
- **Durability** assumes a finality model. v0 ships with 1-block finality on L2s; deeper reorg handling is v1.
- LLMs are non-deterministic. Replay is "approximate replay" unless model + seed are pinned.
- Receipts are **tamper-evident**, not tamper-proof. A signed receipt proves the signer attested to it; it does not prove the receipt's data is true.

## Submission artifacts

- **0G Framework track** — agent runs on 0G Compute reasoning + 0G Storage receipts; `ReceiptRegistry.sol` deployed on 0G Chain
- **Uniswap track** — see [`FEEDBACK.md`](./FEEDBACK.md); example agent rebalances via Uniswap V4 on Base Sepolia (V4 deployment addresses verified Phase 0)
- **ENS Creative track** — receipts mirrored to per-agent ENS subname text records (`receipt.latest`, `receipt.head`); resolver-backed audit trail with no library install required

See [`PRD.md`](./PRD.md) for full design rationale and [`CLAUDE.md`](./CLAUDE.md) for the operating manual.

## License

MIT. See [`LICENSE`](./LICENSE).
