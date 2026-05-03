# ACID — Product Requirements Document

> **Status:** Draft v0.2
> **Target submission:** ETHGlobal Open Agents
> **Owner:** Romario Kavin
> **Last updated:** 2026-05-03

---

## 1. TL;DR

ACID is the **durable execution layer for AI agents that hold real money**. It brings the four classical database guarantees — **A**tomicity, **C**onsistency, **I**solation, **D**urability — to autonomous agent actions on-chain, packaged as a small composable npm library.

**Tagline:** *Postgres taught your backend ACID semantics. ACID teaches your agents.*

The library exposes four composable primitives:

```ts
import { saga, invariant, idempotent, receipted } from 'acid'

const action = receipted(           // D — signed durable receipts
  invariant({ pre, post },          // C — invariants enforced at boundaries
    idempotent(                     // I — concurrent + crash-safe
      saga(steps, compensations))))// A — atomic multi-step rollback
```

Four primitives. One nested call. ACID for agents.

---

## 2. Problem

### 2.1 The bug class

Agents that hold value silently lose money to a recurring class of failures that has no productized solution:

| Failure mode | What happens today | Cost |
|---|---|---|
| **Process crash mid-broadcast** | Agent re-broadcasts on restart → **duplicate transaction** | 2× gas + 2× slippage + over-rotated portfolio |
| **Concurrent retries** | Two parts of the agent race for the same action | Double execution |
| **LLM-loop replay** | Planner re-emits the same tool call after a timeout | Double execution, wasted tokens |
| **Multi-step partial failure** | Step 2 fails after step 1 mined; orphan state on chain | Standing approvals, half-rotated positions, phishing exposure |
| **Stale data drift** | Agent acts on 4-hour-old price data because it never refreshed | Bad trade |
| **Postcondition violations** | Action "succeeded" but left the wallet in an invalid state | Silent invariant breaks |

Every team running on-chain agents has hit at least three of these in production. They quietly fix it with bespoke code — Redis locks that don't survive restart, hash-of-args caches, "fingers crossed" exception handlers, hand-rolled retry-with-revoke logic. Nobody has shipped the obvious shared library.

### 2.2 Why the existing landscape doesn't solve it

| Tool | What it does | What it doesn't do |
|---|---|---|
| `p-retry`, `axios-retry` | Retry policies | Idempotency, durability, on-chain awareness |
| `bullmq`, `inngest` | Job queues with idempotency | Heavy infra, no chain semantics, no saga compensations |
| Stripe / Twilio idempotency keys | Service-side dedup | Useless when *you* are the service |
| Safe transaction service, Defender Sentinel | Chain-side reliability + monitoring | Doesn't help mid-agent-loop |
| Tenderly Virtual Testnets | Pre-execution simulation | Doesn't verify actual broadcast or recover from crashes |
| Temporal / Inngest | Backend workflow durability | Not adapted to agent semantics: LLM loops, on-chain finality, signed receipts |
| Langfuse / LangSmith | Flat observability traces | No causal model, no durability guarantees, no enforcement |

The gap is **agent-shaped durability semantics** — exactly-once execution + atomic multi-step + invariant enforcement + signed receipts — exposed as a small library, not a workflow engine.

### 2.3 Why now

- Account abstraction (EIP-7702 mainnet, May 2025) and CDP-style server wallets make agents-with-real-money commonplace.
- iNFT (ERC-7857) standards make agent state portable and valuable.
- The next 18 months will see a 10–100× increase in agents holding non-trivial value. The class of bugs above will go from "war story" to "headline incident."
- No competitor has claimed the "Stripe-style durability primitive for agents" mental real estate.

---

## 3. Solution

### 3.1 Vision

ACID is the boring, foundational, *category-defining* primitive every team will install on day one of any production agent build, the same way every backend installs Postgres or every web app installs React.

### 3.2 Mapping to ACID guarantees

| ACID property | Database mechanism | ACID library mechanism |
|---|---|---|
| **A**tomicity | Transaction log, 2PC, undo segments | `saga(steps, compensations)` — multi-step actions either fully commit or roll back via compensating txs |
| **C**onsistency | Schema constraints, triggers | `invariant(pre, post, fn)` — predicates enforced at action boundaries |
| **I**solation | Locking, MVCC | `idempotent(fn, key)` — in-flight tracking, dedup, no interleaving |
| **D**urability | WAL, fsync, replication | `receipted(fn)` — signed chained receipts, persisted in 0G Storage, crash-recoverable |

### 3.3 Honest limitations (called out up front)

- **Atomicity** is bounded by saga scope, not global. Forget to wrap → no atomicity.
- **Consistency** invariants are user-defined predicates, not schema-derived. Garbage-in-garbage-out applies.
- **Isolation** is action-level, not multi-action. Serializable isolation across many sagas requires a global lock manager — explicit v1 territory.
- **Durability** assumes a finality model. v0 ships with 1-block finality on L2s; deeper reorg handling is v1.
- LLMs are non-deterministic. Replay is "approximate replay" unless model + seed are pinned.

These caveats live prominently in the README's *Limitations* section. They earn trust.

---

## 4. Goals / Non-goals

### 4.1 Goals (v0)

- Ship four composable primitives as one npm package
- Reference storage adapter for **0G Storage** + in-memory adapter for tests
- Reference chain adapter for **viem** (EVM)
- One example agent built on **OpenClaw**, deployed on **0G Compute**, executing a multi-step Uniswap V4 swap saga
- ENS subname per agent; receipts published as ENS text records
- README + 4-scene demo video + working live demo
- ≥ 80% test coverage of pure logic; integration tests for crash recovery

### 4.2 Non-goals (v0)

- Cross-chain semantics
- Multi-agent coordination / distributed sagas
- Reorg handling beyond simple finality wait
- ML-driven retry policies
- Web UI dashboard (the README + ENS resolver IS the UI)
- Custom compensation DSLs
- Support for non-EVM chains
- Full Temporal-style workflow engine

### 4.3 Stretch (v1+)

- Distributed sagas across Gensyn AXL
- Reorg-aware durability
- Multi-chain receipt aggregation
- TEE-attested receipts via 0G Compute
- Adapters for ethers, Solana, etc.

---

## 5. Target users

### 5.1 Primary

**On-chain agent developers** building autonomous agents that hold value. Today they hand-roll fragile retry logic. They install ACID once and stop worrying.

Profile: TypeScript-fluent, comfortable with viem/ethers, building on OpenClaw / LangChain / CrewAI / custom frameworks. Likely already shipped a v1 agent that quietly double-spent at least once.

### 5.2 Secondary

- **Agent framework maintainers** (OpenClaw, ElizaOS) integrating durability as a first-class capability
- **Auditors and compliance teams** consuming the receipt chain as a tamper-evident log
- **Protocol teams** offering "ACID-compliant" execution as a feature

### 5.3 Not targeted (v0)

- Pure off-chain agents (e.g., research, customer support) — they have weaker durability needs
- Non-developer end users — ACID is a developer tool, not a product
- Centralized custodial platforms — they have their own internal idempotency

---

## 6. Architecture

### 6.1 Layered model

```
┌────────────────────────────────────────────────────────┐
│  USER CODE                                             │
│  agent.swap = receipted(invariant(idempotent(saga()))) │
└────────────────────────────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────┐
│  ACID CORE (npm: 'acid')                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │idempotent│  │   saga   │  │invariant │  │receipt │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│         │           │             │            │       │
│         └───────────┴─────────────┴────────────┘       │
│                          │                             │
│            ┌─────────────┴─────────────┐               │
│            │  Storage Adapter Iface    │               │
│            │  Chain Adapter Iface      │               │
│            │  Signer Iface             │               │
│            └─────────────┬─────────────┘               │
└──────────────────────────┼─────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
   ┌────────▼─────┐ ┌──────▼──────┐ ┌────▼──────┐
   │  Storage     │ │   Chain     │ │  Signer   │
   │  Adapters    │ │  Adapters   │ │  Adapters │
   ├──────────────┤ ├─────────────┤ ├───────────┤
   │ memory       │ │ viem (EVM)  │ │ viem      │
   │ 0g-storage   │ │ (v1: ethers)│ │ ens-name  │
   │ (v1: redis)  │ │             │ │           │
   └──────────────┘ └─────────────┘ └───────────┘
```

### 6.2 Package structure

```
acid/                              ← monorepo (pnpm workspaces)
├── packages/
│   ├── core/                      ← @acid/core (or just `acid`)
│   │   ├── src/
│   │   │   ├── idempotent.ts
│   │   │   ├── saga.ts
│   │   │   ├── invariant.ts
│   │   │   ├── receipted.ts
│   │   │   ├── adapters/
│   │   │   │   ├── storage.ts    ← interface
│   │   │   │   ├── chain.ts      ← interface
│   │   │   │   └── signer.ts     ← interface
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── adapter-memory/            ← @acid/adapter-memory
│   ├── adapter-0g-storage/        ← @acid/adapter-0g-storage
│   ├── adapter-viem/              ← @acid/adapter-viem
│   └── adapter-ens/               ← @acid/adapter-ens (receipt-as-ENS-text-record)
│
├── examples/
│   └── multi-step-uniswap-agent/  ← OpenClaw + 0G + Uniswap V4 demo agent
│
├── contracts/
│   └── ReceiptRegistry.sol        ← deployed on 0G Chain (anchors receipt roots)
│
├── docs/
├── PRD.md                         ← this file
├── CLAUDE.md                      ← context primer for AI sessions
├── README.md
└── FEEDBACK.md                    ← Uniswap submission requirement
```

### 6.3 Composition rules

The four primitives are designed as **higher-order functions** that wrap other functions and return functions. This means they compose freely:

```ts
type Wrapper<A, R> = (fn: (args: A) => Promise<R>) => (args: A) => Promise<R>
```

Composition order matters semantically:

```ts
// Recommended outer-to-inner order:
receipted(           // outermost: every call gets a receipt
  invariant(         // then: invariants enforced
    idempotent(      // then: dedup + crash-safe
      saga(...))))   // innermost: the actual transactional unit
```

The library validates composition at construction time and warns on inverted orders that lose semantics (e.g., wrapping `idempotent` outside `saga` means saga state isn't deduplicated).

---

## 7. API specification

### 7.1 `idempotent`

```ts
function idempotent<A, R>(opts: IdempotentOpts<A, R>): Wrapper<A, R>

interface IdempotentOpts<A, R> {
  /** Deterministic key derivation. Required. */
  key: (args: A) => string

  /** Storage adapter for in-flight + completed state. Required. */
  storage: StorageAdapter

  /** What to do when a duplicate call arrives mid-execution. */
  inFlight?: 'block' | 'return-pending' | 'reject'  // default: 'block'

  /** Cache TTL for completed results. */
  ttl?: number  // seconds, default: 3600

  /** When the wrapped function emits an on-chain tx, reconcile via chain query. */
  onChainAware?: {
    chain: ChainAdapter
    waitForFinality: number              // block confirmations
    reconcileBy: 'txHash' | 'nonce'
  }

  /** Reject keys that look non-deterministic (Date.now, Math.random in scope). */
  strictKeys?: boolean  // default: true
}
```

**Semantics:**
- First call: executes, persists `inFlight` marker, then `completed` record with result.
- Duplicate during execution: blocks (default), returns pending handle, or rejects.
- Duplicate after completion (within TTL): returns cached result, **no re-execution**.
- Process crash mid-execution: on next call with same key, library queries chain (if `onChainAware`) for matching tx and reconciles.

### 7.2 `saga`

```ts
function saga<A, R>(opts: SagaOpts<A, R>): Wrapper<A, R>

interface SagaOpts<A, R> {
  steps: SagaStep[]
  compensations?: Record<string, CompensationFn>
  storage: StorageAdapter
  onPartialFailure?: 'compensate' | 'halt' | 'retry-forward'  // default: 'compensate'
}

interface SagaStep {
  id: string
  do: (ctx: SagaContext) => Promise<unknown>
  /** Override the saga-level compensation strategy for this specific step. */
  compensateOn?: 'failure' | 'never'
}

type CompensationFn = (ctx: SagaContext, stepResult: unknown) => Promise<void>
```

**Semantics:**
- Steps execute in declared order.
- On failure of step *N*, compensations for steps *N-1, N-2, ..., 1* run in reverse.
- Compensations are themselves idempotent under the hood (by `${sagaId}:compensate:${stepId}`).
- On crash mid-saga: restart picks up at the failed step and runs compensations from there.
- Saga state is content-addressed in storage; the saga itself is replayable.

### 7.3 `invariant`

```ts
function invariant<A, R>(opts: InvariantOpts<A, R>): Wrapper<A, R>

interface InvariantOpts<A, R> {
  pre?: (args: A, ctx: InvariantContext) => Promise<boolean | InvariantViolation>
  post?: (args: A, result: R, ctx: InvariantContext) => Promise<boolean | InvariantViolation>
  onViolation?: 'throw' | 'compensate' | 'log-only'  // default: 'throw'
}

interface InvariantViolation {
  reason: string
  severity: 'critical' | 'high' | 'medium'
  context?: Record<string, unknown>
}
```

**Semantics:**
- `pre` runs before the wrapped function. False → reject before execution.
- `post` runs after success. False → trigger compensations (if wrapped saga) or throw.
- Standard invariants library ships built-in: `noOrphanAllowances`, `balanceWithinBound`, `gasUnderCap`, `slippageBelow`.

### 7.4 `receipted`

```ts
function receipted<A, R>(opts: ReceiptedOpts): Wrapper<A, R>

interface ReceiptedOpts {
  storage: StorageAdapter        // where receipts live
  signer: SignerAdapter          // who signs
  chain?: { id: number; anchor?: ContractAnchor }  // optional on-chain anchoring
  prevReceiptKey?: string        // for chaining
}

interface Receipt {
  callId: string                 // content-addressed
  prevReceipt: string | null     // chain pointer
  fnName: string
  inputHash: string
  outputHash: string
  txRefs: string[]               // chain tx hashes if any
  startedAt: number
  endedAt: number
  retries: number
  signature: string              // by signer
  cid: string                    // 0G Storage CID
}
```

**Semantics:**
- Every wrapped call produces a `Receipt` written to storage and emitted via `onReceipt` callback.
- Receipts chain by `prevReceipt` field — caller may pass `prevReceiptKey` to determine the chain head.
- Optional on-chain anchoring: every N receipts, library posts the merkle root to `ReceiptRegistry` contract.
- Receipts are publicly verifiable: `verify(receipt, publicKey)` returns boolean.

### 7.5 Storage adapter interface

```ts
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  put<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  /** Atomic compare-and-swap, used for in-flight marker management. */
  cas<T>(key: string, expected: T | null, next: T): Promise<boolean>
  /** Optional: streaming write, used for large saga states. */
  stream?: (key: string, chunks: AsyncIterable<Buffer>) => Promise<string>
}
```

### 7.6 Chain adapter interface

```ts
interface ChainAdapter {
  chainId: number
  getTxByHash(hash: string): Promise<TxStatus | null>
  getTxByNonce(address: string, nonce: number): Promise<TxStatus | null>
  waitForFinality(hash: string, confirmations: number): Promise<TxStatus>
  getBlockNumber(): Promise<number>
}

type TxStatus = 'pending' | 'mined' | 'finalized' | 'replaced' | 'failed'
```

### 7.7 Signer adapter interface

```ts
interface SignerAdapter {
  identity: string                          // e.g., agent's address or ENS name
  sign(message: Uint8Array): Promise<string>
  publicKey(): Promise<string>
}
```

---

## 8. Storage adapter: 0G Storage (primary)

### 8.1 Why 0G Storage

- Cheap, content-addressed, decentralized — natural home for receipts and saga state
- Native CIDs map directly to receipt identifiers
- 0G Chain anchoring is one-hop (deploy `ReceiptRegistry` on 0G Chain)
- Required for the 0G Framework prize submission

### 8.2 Implementation notes

- Receipts: written as individual content-addressed blobs, CID returned, indexed by `callId`
- In-flight markers: written to 0G KV (low-latency requirement)
- Saga state: written incrementally per step; final saga state CID anchors the steps
- Idempotency cache: short-TTL KV store

### 8.3 Fallback adapters

- `@acid/adapter-memory` — in-process, ephemeral, for tests only
- `@acid/adapter-redis` — v1, for non-web3 deployments

---

## 9. Example agent: Multi-step Uniswap V4 swap

### 9.1 Story

A long-running rebalancing agent operates on Base or Unichain. Goal: maintain a 60/40 ETH/USDC allocation. When drift exceeds 5%, it executes a multi-step swap:

1. `approve(USDC, router, amount)`
2. `router.exactInput(USDC → ETH, ...)`
3. `vault.deposit(ETH)` — optional, only if vault available

Wrapped in ACID:

```ts
const rebalance = receipted({
  storage: zg, signer, chain: { id: 16601 }
}, invariant({
  pre:  (a) => walletBalanceOK(a),
  post: (a, r, ctx) => noOrphanAllowances(ctx),
}, idempotent({
  key: (a) => `rebalance:${a.targetRatio}:${a.deadline}`,
  storage: zg,
  onChainAware: { chain: viemBase, waitForFinality: 1, reconcileBy: 'txHash' },
}, saga({
  steps: [
    { id: 'approve', do: (ctx) => approve(USDC, router, ctx.amount) },
    { id: 'swap',    do: (ctx) => router.exactInput(ctx.swapArgs) },
    { id: 'stake',   do: (ctx) => vault.deposit(ctx.outAmount) },
  ],
  compensations: {
    approve: (ctx) => approve(USDC, router, 0n),
    swap:    () => null,
  },
  storage: zg,
}))))
```

### 9.2 Built on OpenClaw

The example agent is an OpenClaw module that imports ACID for its action layer. OpenClaw handles reasoning + tool selection; ACID handles durable execution.

### 9.3 Identity & receipts via ENS

- Agent has subname: `alice-bot.acid.eth` (or similar)
- Text records:
  - `receipt.latest` → CID of most recent receipt
  - `receipt.head` → CID of current chain head
  - `agent.signer` → public key
- Receipt chain is queryable via any ENS resolver, no library required

---

## 10. Submission plan

### 10.1 Tracks targeted (no KeeperHub)

| Track | Prize pool | Lock? |
|---|---|---|
| 0G Framework | $7,500 | ✅ lock |
| Uniswap | $5,000 | ✅ lock |
| ENS Creative | $2,500 | ✅ add |
| Gensyn AXL | $5,000 | ⚠️ team-size dependent stretch |
| 0G Agents track | $7,500 | ❌ skip (wrong lane — framework, not agent) |
| ENS Identity | $2,500 | ❌ skip (overcrowded; do Creative only) |

**Addressable (locked tracks): ~$15,000.** Realistic expected: $4–8k.

### 10.2 Per-track requirements

#### 10.2.1 0G Framework Track

- Deployed on 0G (0G Compute for inference, 0G Storage for receipts)
- Contract deployment address: `ReceiptRegistry.sol` on 0G Chain
- Public GitHub repo with README + setup
- Demo video <3 min + live demo link
- Architecture diagram showing OpenClaw + 0G Storage/Compute integration
- ≥1 working example agent: the multi-step Uniswap V4 rebalancer

#### 10.2.2 Uniswap Track

- `FEEDBACK.md` at repo root — REQUIRED for eligibility
- Demo agent uses Uniswap V4 (Base or Unichain)
- README explains saga compensation as the V4 multi-step safety pattern
- FEEDBACK.md content: what worked, what didn't, docs gaps, missing endpoints, what we wished existed re: V4 multicall + agent-style retry-safe execution

#### 10.2.3 ENS Creative Track

- Parent name: `acid.eth` (or similar; `npm`-style namespace)
- Subname registrar deployed
- Per-agent subname: `<agent>.acid.eth`
- Text records carry receipt CIDs (`receipt.latest`, `receipt.head`)
- Demo: live ENS resolver lookup → receipt CID → receipt content in 0G Storage
- "Verifiable activity log via DNS-style ENS resolution" is the creative angle

### 10.3 Demo script (4 scenes)

```
   A.   ATOMICITY
   ────────────────────────────────────────────────────────
   Multi-step Uniswap V4 saga: approve → swap → stake.
   Force step 3 to fail mid-execution.
   Library auto-runs compensations in reverse.
   Result: zero orphan allowances on chain.

   C.   CONSISTENCY
   ────────────────────────────────────────────────────────
   Same agent. Postcondition: "agent's allowance count
   equals starting count." A malicious tool leaves an
   allowance. Postcondition fires. Action refused.

   I.   ISOLATION
   ────────────────────────────────────────────────────────
   Two parallel calls, same idempotency key.
   Library blocks the second. First commits.
   Second receives cached result. Zero double-execution.

   D.   DURABILITY
   ────────────────────────────────────────────────────────
   kill -9 the agent mid-broadcast. Restart.
   Library reconciles via 0G Storage + chain query.
   Pending tx detected. No re-broadcast.
   Five txs, exactly five.
```

Closing slide: **A.C.I.D. — for AI agents.**

### 10.4 Submission checklist

- [ ] GitHub public, MIT license
- [ ] README with ACID table, four-primitive code block, install/quickstart, limitations
- [ ] PRD.md (this doc)
- [ ] CLAUDE.md (context primer)
- [ ] FEEDBACK.md (Uniswap)
- [ ] Architecture diagram (one image)
- [ ] Demo video (≤3 min)
- [ ] Live demo link
- [ ] Contract deployment addresses listed in README
- [ ] At least one working example agent in `/examples`
- [ ] ENS name registered + subname registrar deployed
- [ ] At least one minted iNFT or live-resolvable agent identity

---

## 11. Build plan

The work decomposes into **seven phases** ordered by dependency. Each phase produces a testable artifact, and phases gate the work that comes after them. Within a phase, items can usually proceed in parallel.

### Phase 0 — Pre-flight

Verifications that must happen before Phase 1 starts. Failures here change the plan.

- Confirm `acid` available on npm; if not, fall back to `@acid-lib/core` or `acidjs`
- Confirm `acid.eth` (or fallback parent name) available on ENS
- Confirm `acid.ai` domain available
- Verify 0G Storage SDK quickstart works (write a blob, read it back)
- Verify 0G Compute quickstart works (single inference call against `qwen3.6-plus` or `GLM-5-FP8`)
- Verify 0G Chain testnet RPC + faucet
- Verify Base / Unichain testnet RPC + faucet
- Verify OpenClaw "hello world" agent runs end-to-end
- Verify Uniswap V4 testnet swap succeeds via viem (known-good script)

**Gate:** all items green or contingency identified before Phase 1.

### Phase 1 — Foundation

Repo scaffolding and shared types. Output: empty but buildable monorepo.

- Initialize monorepo with pnpm workspaces
- Configure tsup for library builds, tsc for type-check, vitest for tests
- Configure ESLint + Prettier
- Author `packages/core/src/types.ts`: shared types (`Wrapper`, `StorageAdapter` iface, `ChainAdapter` iface, `SignerAdapter` iface, `Receipt`, `SagaStep`, etc.)
- Author `packages/core/src/adapters/{storage,chain,signer}.ts`: bare interfaces only
- Author `packages/adapter-memory/`: in-memory `StorageAdapter` implementation
- Wire up CI: typecheck + test + build on every commit
- Place test harness skeleton with a smoke test that imports types from core

**Deliverable:** `pnpm install && pnpm test` passes a trivial test.
**Gate:** core types reviewed; interface signatures locked.

### Phase 2 — Core primitives (in-memory only)

Implement the four primitives against the memory adapter, no chain logic yet. This is the bulk of the conceptual work.

**`idempotent` (single-machine, in-memory):**
- Key derivation + strict-key validation
- In-flight marker via `cas` on storage
- Result cache with TTL
- `inFlight: 'block' | 'return-pending' | 'reject'` modes
- Tests: dedup, in-flight blocking, TTL expiry, key non-determinism rejection

**`saga`:**
- Step ordering, compensation registry
- Forward execution, rollback on failure
- Saga state persistence (each step records before/after)
- Crash-recovery path: detect partial saga on construction, resume or compensate
- Tests: success, failure-at-step-N, mid-saga crash + restart, compensation idempotency

**`invariant`:**
- Pre/post predicate execution
- Violation reporting structure
- `onViolation: 'throw' | 'compensate' | 'log-only'` modes
- Built-in invariant library: `noOrphanAllowances`, `balanceWithinBound`, `gasUnderCap`, `slippageBelow`
- Tests: pre-failure, post-failure, compensate-on-violation path

**`receipted`:**
- Receipt construction (input/output hashing, signing)
- Receipt chaining (`prevReceipt` link)
- Receipt persistence to storage
- `verify(receipt, publicKey)` standalone function
- Tests: receipts chain correctly, signatures verify, verify rejects tampered receipts

**Composition tests:**
- All four wrapped together, integration test with simulated failures
- Composition-order validator emits warnings for backwards orders

**Deliverable:** `acid` core works end-to-end against memory adapter; `pnpm test` covers all four primitives.
**Gate:** ≥80% coverage on core; integration tests pass.

### Phase 3 — Chain awareness

Implement the chain adapter and chain-aware idempotency. This is where on-chain reconciliation becomes real.

- `packages/adapter-viem/`: `ChainAdapter` impl on top of viem
- Tx status resolution by hash and by `(address, nonce)`
- Finality wait helper (poll until confirmation depth)
- Chain-aware idempotency: when an `onChainAware` config is provided, the in-flight marker stores the broadcast tx hash; reconciliation queries the chain on restart
- Replacement-tx detection (if user bumps gas, the original is replaced — surface this)
- Tests against an Anvil fork: kill-during-broadcast scenarios, replacement, missing tx

**Deliverable:** `idempotent` works in `onChainAware` mode against a forked Base testnet.
**Gate:** crash-during-broadcast test passes deterministically against the fork.

### Phase 4 — 0G Storage adapter

Promote the library from "memory only" to "production durability backend."

- `packages/adapter-0g-storage/`: `StorageAdapter` impl
- KV ops for in-flight markers and idempotency cache
- Blob ops for receipts and saga state
- Streaming uploads for large saga states (optional)
- Cross-adapter conformance tests (run the same primitive test suite against memory + 0G; both must pass)

**Deliverable:** all primitives work against 0G Storage exactly as they do in memory.
**Gate:** conformance suite green.

### Phase 5 — Example agent

A real, deployable agent that uses every primitive. This becomes the demo target and the README's centerpiece.

- `examples/multi-step-uniswap-agent/`: OpenClaw agent skeleton
- Tools wired: `approve`, `swap` (Uniswap V4 router on Base or Unichain), optional `stake`
- Wrap rebalance action with all four primitives composed
- Deploy reasoning to 0G Compute (`qwen3.6-plus` or `GLM-5-FP8`)
- Storage wired to 0G Storage adapter
- Configurable target ratio, drift threshold, slippage cap
- End-to-end test on testnet: agent observes drift, executes saga, generates receipts, recovers from kill

**Deliverable:** agent runs autonomously and survives a `kill -9` during a swap.
**Gate:** end-to-end test passes on testnet.

### Phase 6 — Identity & on-chain anchoring

The web3-native pieces that complete the submission story.

- `contracts/ReceiptRegistry.sol`: minimal contract that anchors merkle roots of receipt batches; deploys on 0G Chain
- `packages/adapter-ens/`: `StorageAdapter` companion that mirrors latest receipt CIDs into ENS text records (`receipt.latest`, `receipt.head`)
- ENS parent name claimed; subname registrar deployed
- Example agent gets a subname; receipts publish into its text records
- Live ENS resolver demo: `dig`/`ens-resolve` returns the latest receipt CID, which fetches from 0G Storage

**Deliverable:** any third party can ENS-resolve `<agent>.acid.eth`, fetch the latest receipt, and verify the signature.
**Gate:** live demo from a clean machine works without library installed.

### Phase 7 — Submission artifacts

The polish layer. Mostly non-code, but submission-critical.

- README.md finalization: ACID table at top, four-primitive code block, install/quickstart, limitations section, architecture diagram embed
- FEEDBACK.md (Uniswap-specific): honest write-up of friction wrapping V4 in saga compensations, docs gaps, what was missing
- Architecture diagram (Excalidraw or similar): one image showing OpenClaw + 0G + ENS integration
- 4-scene demo video (A / C / I / D)
- Live demo deployment (hosted or runnable from fresh clone)
- Triple-check each track's submission requirements before submitting
- Submit to all locked tracks

**Deliverable:** clean submissions to 0G Framework, Uniswap, ENS Creative tracks.
**Gate:** all checklist items in §10.4 satisfied.

### 11.x Cut list (priority order if scope must shrink)

If forced to cut, drop in this order — items at the top hurt the submission least:

1. ENS adapter (drop ENS Creative track entirely)
2. `invariant` postcondition compensation path (keep pre-only; postcondition just throws)
3. Built-in invariant library beyond `noOrphanAllowances`
4. Stake step in example saga (just approve → swap; saga still demonstrates compensation)
5. On-chain `ReceiptRegistry` anchoring (CIDs only, no on-chain merkle root)
6. Conformance test suite for adapters (manual smoke test instead)
7. AXL distributed sagas (was already off the lock list)

Do **not** cut: the four core primitives, the memory adapter, the example agent, the kill-9 demo path. Those are non-negotiable for the submission to land.

---

## 12. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 0G Storage SDK has unexpected friction | Medium | High | Phase 0 integration test gates Phase 4; fallback to memory adapter for demo if 0G fails |
| OpenClaw integration sharp edges | Medium | Medium | Phase 0 includes hello-world OpenClaw run; have plain Node-script fallback agent if OpenClaw is unworkable |
| Uniswap V4 multicall has surprises on testnet | Medium | Medium | V3 pathway as fallback; FEEDBACK.md is *strengthened* by hitting friction |
| ENS testnet flakiness | Low | Medium | Deploy early in Phase 6; fall back to mainnet read-only resolution if testnet broken |
| Demo recording fails on stage | Low | High | Pre-record golden-path video in Phase 7; live demo only as bonus |
| Naming conflict on `acid` package | High | Low | Phase 0 verifies; fall back to `@acid-lib/core`; tagline carries the brand regardless |
| Scope creep from "let's add X" temptation | High | High | Cut list (§11.x) is explicit; review at every phase gate |
| Compensation logic is buggy in unusual failure modes | Medium | High | Property-based tests in Phase 2; document only the supported modes; mark edge cases as v1 |
| Reorg during demo invalidates "successful" tx | Low | High | Use 1+ confirmation finality on stable testnet; pre-recorded golden path |
| 0G Compute model availability/quotas | Medium | Medium | Pin model in Phase 0; have a local Llama or hosted Anthropic fallback for the example agent reasoning |
| Receipt signature verification incompatible across clients | Low | Medium | Use canonical signing (EIP-191 personal_sign); test verify path on Phase 2 |

---

## 13. Success metrics

### 13.1 Submission outcomes (primary)

- [ ] Ranked top-3 in 0G Framework track (≥$1,500)
- [ ] Ranked top-3 in Uniswap track (≥$1,000)
- [ ] Ranked top-3 in ENS Creative track (≥$500)
- [ ] Demo video published, ≥500 views in first 30 days
- [ ] Repo public, ≥100 stars in first 30 days

### 13.2 Library health (post-launch)

- [ ] ≥10 weekly npm downloads sustained
- [ ] ≥3 external contributors
- [ ] ≥1 framework integrating ACID natively (OpenClaw, ElizaOS, etc.)
- [ ] ≥80% test coverage maintained
- [ ] Zero "lost transaction" issues filed against the library

### 13.3 Long-term

- [ ] Recognized category-defining primitive ("the agent-idempotency thing")
- [ ] Cited in protocol design conversations / EIP discussions
- [ ] One canonical blog post: *"Why agent retries are different from API retries"*

---

## 14. Open questions

| # | Question | Resolve before | Status |
|---|---|---|---|
| 1 | npm package name: `acid` vs `@acid-lib/core` vs other? | Phase 1 | **Resolved: `acid`** |
| 2 | Domain: `acid.ai` — available? | Phase 7 | Non-blocking |
| 3 | Target chain for example: Base, Unichain, or 0G Chain only? | Phase 5 | **Resolved: 0G Chain is the primary chain (ReceiptRegistry, receipts, storage, compute). Base is the swap chain for the Uniswap V4 example (Uniswap V4 is not deployed on 0G Chain).** |
| 4 | OpenClaw native or build a thin compat shim? | Phase 5 | Non-blocking |
| 5 | iNFT minting in v0 or defer to v1? | Phase 6 | Non-blocking |
| 6 | Pin which LLM (qwen3.6-plus / GLM-5-FP8) for the demo agent? | Phase 5 | Non-blocking |
| 7 | Logo / wordmark — DIY or use a generator? | Phase 7 | Non-blocking |
| 8 | Receipt signing scheme: EIP-191 personal_sign, EIP-712 typed, or raw secp256k1? | Phase 2 | **Resolved: EIP-712 typed data signing. Reasons: (1) `ReceiptRegistry.sol` can call `ecrecover(structHash, v, r, s)` natively; (2) domain separator includes `chainId` (0G Chain = 16600) preventing cross-chain replay; (3) Receipt struct fields are human-readable in the signature — auditors see what was signed. viem `signTypedData` / `verifyTypedData` cover the full impl.** |
| 9 | Saga state size limits — what's the upper bound for a single saga in 0G Storage? | Phase 4 | Non-blocking |
| 10 | License — MIT, Apache-2.0, or AGPL? | Phase 7 | Non-blocking |

---

## 15. Appendix

### 15.1 Glossary

- **Saga** — a multi-step transaction with compensation logic for partial failure
- **Idempotency key** — deterministic identifier ensuring exactly-once execution
- **In-flight marker** — persistent state indicating a call is currently executing
- **Receipt** — signed, content-addressed record of a wrapped function call
- **Compensation** — the inverse action that undoes a previously executed saga step
- **Invariant** — a predicate the system guarantees true at action boundaries
- **Reconciliation** — querying chain state on restart to determine if an in-flight tx committed
- **Wrapper** — a higher-order function that takes a function and returns a function with added behavior; the four primitives are all wrappers

### 15.2 Reference reading

- Garcia-Molina & Salem, *Sagas* (ACM 1987) — distributed-saga foundational paper
- Stripe API docs, *Idempotent Requests* — clearest exposition of idempotency-key contract
- Temporal docs, *Workflow Determinism* — durable-execution patterns
- 0G Builder Hub — https://build.0g.ai
- Uniswap V4 docs — https://developers.uniswap.org/
- ENS docs — https://docs.ens.domains/
- OpenClaw docs — (TBD: link from 0G Builder Hub)

### 15.3 Out-of-scope ideas (parking lot)

- Distributed sagas across AXL nodes
- TEE-attested receipts via 0G Compute sealed inference
- ML-driven retry policies (learn what actions need approval)
- Reorg-aware durability with confirmation depth heuristics
- Cross-chain receipt aggregation
- Visual saga designer / no-code UI
- ACID-as-a-service (hosted, multi-tenant)
- Behavioral fingerprinting of agent receipts (anomaly detection)
- Receipt-to-iNFT minting (each receipt becomes a transferable NFT)
- Cross-agent receipt verification protocol over AXL

---

*End of PRD v0.2.*
