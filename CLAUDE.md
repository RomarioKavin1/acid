# ACID — Context Guide for Claude

This file is a context primer for Claude Code sessions working in this repo. Read it before doing any work here. **Source of truth for design decisions is `PRD.md`** — this file is the operating manual.

---

## 0. What This Is

**ACID** is a small, composable npm library that brings the four classical database guarantees — **A**tomicity, **C**onsistency, **I**solation, **D**urability — to AI agent actions, especially on-chain ones.

The pitch in one line: *Postgres taught your backend ACID semantics. ACID teaches your agents.*

The library is being built for submission to the **ETHGlobal Open Agents** event, but it is designed to outlive that as a real open-source project. Don't write code that only makes sense in a hackathon context.

The four primitives:

```ts
import { saga, invariant, idempotent, receipted } from '@openacid/acid'

const action = receipted(           // D — signed durable receipts
  invariant({ pre, post },          // C — invariants enforced at boundaries
    idempotent(                     // I — concurrent + crash-safe
      saga(steps, compensations))))// A — atomic multi-step rollback
```

> The unscoped `acid` npm name is occupied by an unrelated abandoned package; we publish under the `@openacid` scope. The brand stays `acid`. See PRD §14 q1.

For full design rationale, problem framing, and per-primitive semantics, see `PRD.md`.

---

## 1. Quick Start (when implemented)

> The repo is currently pre-implementation; commands below describe the planned developer experience.

```bash
pnpm install                  # Install workspace deps (pnpm, not npm/yarn)
pnpm build                    # Build all packages with tsup
pnpm test                     # Run vitest suite across packages
pnpm test:watch               # Vitest watch mode
pnpm typecheck                # tsc --noEmit across the workspace
pnpm lint                     # eslint
pnpm dev                      # Run the example agent against testnets
```

Required env (`.env.local`, see `.env.example`):

```
# 0G Storage SDK (@0gfoundation/0g-storage-ts-sdk)
ZEROG_STORAGE_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=
ZEROG_CHAIN_PRIVATE_KEY=

# 0G Chain — Galileo testnet, chainId 16602
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai

# 0G Compute (@0gfoundation/0g-compute-ts-sdk)
# Auth is on-chain account (signed requests) OR CLI-issued Bearer token:
#   0g-compute-cli inference get-secret --provider <PROVIDER_ADDRESS>
ZEROG_COMPUTE_PROVIDER_ADDRESS=
ZEROG_COMPUTE_BEARER=
LLM_MODEL=                    # resolved at runtime via broker.inference.getServiceMetadata()

# Local-dev LLM fallback (when 0G Compute creds aren't available)
ANTHROPIC_API_KEY=

# EVM testnet (Base Sepolia for Uniswap V4 swap)
BASE_SEPOLIA_RPC=https://sepolia.base.org
EVM_PRIVATE_KEY=

# ENS (Phase 6+) — `acid.eth` is taken; fallback parent name
ENS_PARENT_NAME=openacid.eth
ENS_REGISTRAR_PRIVATE_KEY=
```

---

## 2. Tech Stack

| Area | Choice | Notes |
|---|---|---|
| Package manager | **pnpm** with workspaces | Not npm. Not yarn. |
| Language | **TypeScript 5.x**, strict | No `any` without an `eslint-disable` comment justifying why |
| Build | **tsup** | ESM + CJS dual builds; sourcemaps on |
| Tests | **vitest 3** | jsdom not needed; node env |
| Lint | **eslint** flat config + **prettier** | |
| Chain (EVM) | **viem 2.x** | The chain adapter wraps viem |
| Crypto/signing | **viem** | EIP-712 typed data signing for receipts (`signTypedData` / `verifyTypedData`); domain separator uses 0G Chain chainId 16602 |
| Storage SDK (primary backend) | **`@0gfoundation/0g-storage-ts-sdk`** | KV (`Batcher` / `KvClient`) for in-flight markers, blob (`indexer.upload/download` via `ZgFile`) for receipts |
| LLM (example agent) | **`@0gfoundation/0g-compute-ts-sdk`** | Model catalog dynamic; resolve at runtime via `broker.inference.getServiceMetadata()`. Local-dev fallback: Anthropic Claude Sonnet 4.6 |
| Agent runtime (example) | **plain TS loop + viem** | OpenClaw evaluated and dropped in Phase 0 (channel-driven, wrong shape). ACID itself stays framework-agnostic |
| Smart contracts | **Solidity 0.8.x**, **Foundry** | Only `ReceiptRegistry.sol` for v0 |
| ENS | **viem ENS helpers** + custom subname registrar | Receipts published as text records |
| CI | GitHub Actions | typecheck + test + build on every commit |
| License | MIT (planned) | Final decision in Phase 7 |

Published name is **`@openacid/acid`** (`acid` unscoped is occupied by an unrelated abandoned package). Repo and brand keep the `acid` identity.

---

## 3. Directory Map

```
acid/                                ← repo root, monorepo
├── packages/
│   ├── core/                        ← @openacid/acid
│   │   ├── src/
│   │   │   ├── idempotent.ts        ← ★ idempotency primitive
│   │   │   ├── saga.ts              ← ★ atomic multi-step primitive
│   │   │   ├── invariant.ts         ← ★ pre/post predicate primitive
│   │   │   ├── receipted.ts         ← ★ signed receipt primitive
│   │   │   ├── compose.ts           ← composition validator
│   │   │   ├── receipt.ts           ← Receipt type, hash, signing, verify
│   │   │   ├── invariants/          ← built-in invariant library
│   │   │   │   ├── noOrphanAllowances.ts
│   │   │   │   ├── balanceWithinBound.ts
│   │   │   │   ├── gasUnderCap.ts
│   │   │   │   └── slippageBelow.ts
│   │   │   ├── adapters/
│   │   │   │   ├── storage.ts       ← StorageAdapter interface
│   │   │   │   ├── chain.ts         ← ChainAdapter interface
│   │   │   │   └── signer.ts        ← SignerAdapter interface
│   │   │   ├── errors.ts            ← typed error classes
│   │   │   ├── types.ts             ← public type exports
│   │   │   └── index.ts             ← barrel
│   │   ├── tests/                   ← vitest, colocated where useful
│   │   └── package.json
│   │
│   ├── adapter-memory/              ← @openacid/adapter-memory  (used by all tests)
│   ├── adapter-0g-storage/          ← @openacid/adapter-0g-storage  (primary durability backend)
│   ├── adapter-viem/                ← @openacid/adapter-viem  (ChainAdapter on viem)
│   └── adapter-ens/                 ← @openacid/adapter-ens  (mirrors receipts to ENS text records)
│
├── examples/
│   └── multi-step-uniswap-agent/    ← ★ THE DEMO AGENT
│       ├── src/
│       │   ├── agent.ts             ← plain TS loop + viem
│       │   ├── tools/               ← approve, swap, stake
│       │   ├── invariants.ts        ← agent-specific invariants
│       │   └── main.ts
│       └── README.md
│
├── contracts/
│   ├── src/
│   │   └── ReceiptRegistry.sol      ← anchors receipt merkle roots on 0G Chain
│   ├── script/                      ← Foundry deploy scripts
│   └── foundry.toml
│
├── docs/                            ← longer-form design notes
│
├── PRD.md                           ← ★ source of truth for design
├── CLAUDE.md                        ← this file
├── README.md                        ← public-facing
├── FEEDBACK.md                      ← required by Uniswap submission
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .env.example
└── .github/workflows/ci.yml
```

**Naming conventions:**
- Packages: kebab-case (`adapter-0g-storage`)
- Files: kebab-case for utilities (`compose.ts`), camelCase for primitives matching their public name (`idempotent.ts`)
- Types: PascalCase
- Hooks-style helpers: `useXxx` not used; this is a library, not React
- Tests: `*.test.ts` colocated next to the file under test

---

## 4. Core Concepts

### 4.1 The four primitives

Each is a **higher-order function**: takes a function, returns a function with added behavior. The signature is uniform:

```ts
type Wrapper<A, R> = (fn: (args: A) => Promise<R>) => (args: A) => Promise<R>
```

| Primitive | What it adds | What it owns |
|---|---|---|
| `idempotent` | Exactly-once execution; in-flight dedup; crash-safe key cache | Idempotency keys, in-flight markers, completed-result cache |
| `saga` | Multi-step transactions with compensation; replay-from-last-step | Saga state, step results, compensation invocations |
| `invariant` | Pre/post predicate enforcement | Predicate evaluations, violation reports |
| `receipted` | Signed, chained, durable execution receipts | Receipt construction, signing, persistence, chain pointers |

### 4.2 ACID mapping

| Property | Mechanism in DB | Mechanism here |
|---|---|---|
| **A**tomicity | Transaction log + 2PC | `saga` with compensations |
| **C**onsistency | Schema constraints + triggers | `invariant` predicates at boundaries |
| **I**solation | Locking / MVCC | `idempotent` with in-flight tracking |
| **D**urability | WAL + fsync | `receipted` + storage adapter |

### 4.3 Composition rules

The recommended composition order (outer to inner):

```ts
receipted(
  invariant(
    idempotent(
      saga(...))))
```

Why this order:

- **`receipted` outermost** — every call gets a receipt, including ones that fail invariants. The receipt is the audit trail of *attempts*, not just successes.
- **`invariant` next** — predicates run before idempotency dedup (so a violating call is rejected even if it's a "duplicate"); postconditions run after the wrapped saga commits.
- **`idempotent` next** — dedup happens once we know the call is admissible.
- **`saga` innermost** — the actual transactional unit. Smallest scope.

The library validates composition at construction time. Inverted orders are not rejected (some advanced use cases want them), but the validator emits warnings explaining the semantic shift.

### 4.4 Adapter philosophy

The four primitives are **chain-agnostic and storage-agnostic**. Concrete implementations live behind three adapter interfaces:

- `StorageAdapter` — KV + blob, with atomic compare-and-swap. See `packages/core/src/adapters/storage.ts`.
- `ChainAdapter` — read tx status, wait for finality, look up tx by nonce. See `packages/core/src/adapters/chain.ts`.
- `SignerAdapter` — sign messages, expose public key + identity. See `packages/core/src/adapters/signer.ts`.

A user assembles a runtime by instantiating adapters and wiring them into the primitive options. This is the only public configuration surface.

---

## 5. Adapter Interfaces (Authoritative)

These are the contract surfaces all adapters implement. Changes to these signatures are **breaking changes** for the entire ecosystem and require a major version bump.

### 5.1 `StorageAdapter`

```ts
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  put<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  cas<T>(key: string, expected: T | null, next: T): Promise<boolean>
  stream?: (key: string, chunks: AsyncIterable<Buffer>) => Promise<string>
}
```

Implementations must satisfy:

- `cas` is atomic across concurrent callers
- `get` after `put` reads-your-writes consistency
- `ttl` honored to within ~1s (best effort)
- `stream` optional; if absent, large saga states fall back to chunked `put` calls

### 5.2 `ChainAdapter`

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

Implementations must satisfy:

- `getTxByHash('0x000...')` returns `null` (not throw) for missing tx
- `'replaced'` returned when a tx with the same nonce was mined with a different hash
- `waitForFinality` polls until the requested confirmation depth or rejects on timeout

### 5.3 `SignerAdapter`

```ts
interface SignerAdapter {
  identity: string
  sign(message: Uint8Array): Promise<string>
  publicKey(): Promise<string>
}
```

`identity` is a stable string (address, ENS name, or other). `sign` returns a hex signature. The exact signing scheme (EIP-191 personal_sign vs EIP-712 typed vs raw secp256k1) is decided in Phase 2 — see PRD §14 q8.

---

## 6. The Example Agent

`examples/multi-step-uniswap-agent/` is the showcase. It's also the integration test: if it works end-to-end on testnet, the library works.

### 6.1 What it does

- Maintains a target portfolio ratio (e.g., 60/40 ETH/USDC)
- Polls balances on Base or Unichain
- When drift > threshold, executes a multi-step swap saga: `approve → swap → (optional) stake`
- All actions wrapped in `receipted(invariant(idempotent(saga(...))))`
- Reasoning runs on 0G Compute
- Receipts persist to 0G Storage; `ReceiptRegistry.sol` anchors merkle roots on 0G Chain (Galileo testnet, chainId 16602)
- Latest receipt CID published to ENS subname text record

### 6.2 Why it's the right demo

- Multi-step → exercises `saga` and compensations naturally
- "No orphan allowance" postcondition → exercises `invariant`
- Long-running → exercises `idempotent` under retries
- On-chain → exercises `receipted` with chain refs
- Hits the Uniswap, 0G, and ENS submission tracks in one artifact

### 6.3 What you should NOT do in the example

- Don't add UI; the demo is CLI + on-chain state
- Don't add multi-agent comms (that's the AXL stretch goal)
- Don't add features the library doesn't need to demonstrate

---

## 7. Adding a New Adapter

This is the most common extension point. Steps:

1. Create `packages/adapter-<name>/`
2. Add it to `pnpm-workspace.yaml` (it's globbed, but verify)
3. Implement the relevant interface from `packages/core/src/adapters/`
4. **Run the conformance test suite** against your adapter — see `packages/core/tests/conformance/`. Every adapter MUST pass the suite for the corresponding interface.
5. Add a README in the adapter package explaining setup, env vars, and tradeoffs
6. Add usage docs to `docs/adapters.md`

The conformance suite is the contract. If your adapter passes it, the four primitives will work on top of you. If it doesn't, they may silently corrupt state.

---

## 8. Adding a New Primitive (rare)

Adding a fifth primitive is a major design decision and probably wrong. The four ACID guarantees are a complete set; adding "quintic" semantics dilutes the brand and confuses users. **Default answer: don't.**

Cases where it might be justified:

- A new database guarantee genuinely matters for agents (e.g., Snapshot Isolation as a separate primitive from `idempotent`)
- A platform-specific need that can't be expressed via composition

If you're considering it, write a design doc in `docs/proposals/` first. Reference the PRD's §3.2 mapping table and explain why composition + invariants can't cover the use case.

---

## 9. Gotchas & Non-Obvious Decisions

- **Composition order matters.** See §4.3. Don't reorder without understanding the semantic implications.
- **Idempotency keys MUST be deterministic.** The library has a strict-mode that rejects keys built from `Date.now()`, `Math.random()`, or `Math.random()`-derived UUIDs. Don't disable strict mode unless you really know what you're doing.
- **In-flight markers must outlive the process.** That's the whole point. The memory adapter is for *tests only*; never use it in production. The library does not enforce this — it's the user's responsibility — but the README should be loud about it.
- **`saga` compensations run in reverse order.** If step 1 = approve, step 2 = swap, step 3 = stake, and step 3 fails, compensations run in the order: comp(3, if any) → comp(2, if any) → comp(1). This matches saga literature; don't "fix" it.
- **`invariant` postconditions can themselves trigger compensations.** This is by design. A failing postcondition is treated as "the action succeeded mechanically but produced an invalid state" — the same outcome as a step failure. Wrapping `saga` inside `invariant` makes this work; wrapping `invariant` inside `saga` does not.
- **Receipts are tamper-evident, not tamper-proof.** A signed receipt proves the signer attested to it; it does not prove the receipt's data is true. Receipts are an audit trail, not a security primitive.
- **`receipted` does not retry; it observes.** If you want retry, wrap in `idempotent` (which dedupes on retry) or compose externally.
- **Chain reconciliation can return `'replaced'`.** When a user bumps gas, the original tx is dead. The library surfaces this; do not hide it. Silent re-broadcast on a "replaced" tx leads to double-spend.
- **0G Storage is content-addressed.** Receipt CIDs are derived from receipt content. If you mutate a receipt, the CID changes — i.e., you've created a new receipt, not modified one. There is no "update."
- **No auto-save / no auto-checkpoint.** The library is explicit. Users opt into wrapping; nothing magic happens behind the scenes.
- **The library is framework-agnostic.** The example agent is a plain TS loop + viem. The core `@openacid/acid` package must not import any agent framework (OpenClaw, LangChain, CrewAI, etc.); adapters and primitives stay decoupled from runtime style.
- **No `any` in core.** Adapter packages can use `any` for SDK glue with comments explaining; core must be fully typed.
- **Receipts may be large.** Saga state with multi-step inputs and outputs can exceed 1MB. Storage adapters should support `stream` for these cases or accept chunked `put`. Memory adapter is fine being naive.

---

## 10. Working Directory Map for Common Tasks

| Task | Start here |
|---|---|
| Add or change a primitive | `packages/core/src/<primitive>.ts` (+ test) |
| Change adapter interface | `packages/core/src/adapters/<iface>.ts` — **breaking change** |
| Add a new storage backend | `packages/adapter-<name>/`, implement `StorageAdapter`, run conformance suite |
| Add a built-in invariant | `packages/core/src/invariants/<name>.ts` |
| Tweak the example agent | `examples/multi-step-uniswap-agent/` |
| Change receipt schema | `packages/core/src/receipt.ts` — coordinate with all consumers |
| Modify on-chain anchoring | `contracts/src/ReceiptRegistry.sol` + adapter wiring |
| Add a chain | `packages/adapter-viem/src/<chain>.ts` (or new adapter package) |
| Update submission artifacts | `README.md`, `FEEDBACK.md`, `docs/`, demo video |
| Bump versions | Use changesets (planned); never manual `package.json` edits across the workspace |

---

## 11. Submission Requirements (Active Tracks)

These are the locked tracks. See PRD §10 for the full breakdown.

### 11.1 0G Framework

- Library deployed and runnable on 0G (0G Compute reasoning, 0G Storage receipts)
- `ReceiptRegistry.sol` deployed on 0G Chain — address listed in README
- README + setup instructions + arch diagram
- Demo video <3 min + live demo link
- ≥1 working example agent

### 11.2 Uniswap

- `FEEDBACK.md` REQUIRED at repo root — contents must be specific and actionable
- Example agent uses Uniswap V4 on Base or Unichain
- README explains saga compensation as the V4 multi-step safety pattern

### 11.3 ENS Creative

- ENS parent name (`openacid.eth` per PRD §14 q11) registered
- Subname registrar deployed; per-agent subnames assigned
- Receipts mirrored to ENS text records (`receipt.latest`, `receipt.head`, `agent.signer`)
- Demo: third-party ENS resolver returns receipt CID without library installed

### 11.4 Tracks intentionally NOT targeted

- KeeperHub (skipped per project decision)
- 0G Agents track (wrong lane — this is a framework, not an agent)
- ENS Identity track (overcrowded; Creative wins by differentiation)
- Gensyn AXL (stretch only; out of scope unless team capacity allows)

---

## 12. Current State

> Update this section as the project progresses.

**Tests:** 117 vitest passing (10 of which hit live 0G Galileo) + 8 Foundry tests passing. **Typecheck:** clean across 6 packages + the example.

- **Phase 0 — Pre-flight:** ✅ COMPLETE
  - ☑ `acid` npm name — **TAKEN**, published as `@openacid/acid` instead
  - ☑ `acid.eth` ENS name — **TAKEN**, registered `openacid.eth` on Sepolia (live)
  - ☑ `acid.ai` domain — **TAKEN**; deferred (brand survives via npm + GitHub + ENS)
  - ☑ 0G Galileo testnet (chainId **16602**) reachable; faucet drip claimed
  - ☑ Base Sepolia + Unichain Sepolia RPCs alive; full Uniswap V4 deployments verified
  - ☑ 0G Storage SDK smoke test — **live conformance suite passes** (10 tests, real on-chain ops)
  - ☑ Uniswap V4 entry points verified
  - ☑ OpenClaw evaluated and **dropped** (channel-driven runtime, wrong shape — PRD §14 q4)
  - ◔ 0G Compute SDK — adapter SDK reviewed but not wired into example agent (Anthropic fallback OK for v0; see PRD §14 q6)
- **Phase 1 — Foundation:** ✅ COMPLETE — pnpm workspace, tsup, vitest, eslint+prettier, CI, shared types/interfaces, memory adapter
- **Phase 2 — Core primitives:** ✅ COMPLETE — `idempotent`, `saga`, `invariant`, `receipted` all live; conformance suite reusable; 99 vitest tests
- **Phase 3 — Chain awareness:** ✅ COMPLETE — `ViemChainAdapter` + `ViemSigner` against live Base Sepolia; `chainAwareBroadcast` helper for kill-9 recovery
- **Phase 4 — 0G Storage adapter:** ✅ COMPLETE — `ZeroGStorageAdapter` write-through; live conformance passes 10/10 against Galileo
- **Phase 5 — Example agent:** ✅ COMPLETE — `examples/multi-step-uniswap-agent` reads real Base Sepolia balances, runs full `receipted(invariant(idempotent(saga())))`. Live V4 swap step is documented as the obvious extension; dry-run covers the rest of the pipeline.
- **Phase 6 — Identity & on-chain anchoring:** ✅ COMPLETE
  - ☑ `ReceiptRegistry.sol` — deployed on 0G Galileo at **`0xd3E6277960025B4D0c161e20304a3a44231d0D1C`** ([tx](https://chainscan-galileo.0g.ai/tx/0x3dc372a467edbee7507f3bd90061874a8625f0efaf05eb62cd190779128687e1))
  - ☑ `openacid.eth` registered on Sepolia ENS ([register tx](https://sepolia.etherscan.io/tx/0x6794e98cb61dd21bb8d858ab039277d1097eb0260e05ffe8fa400a713e8ce98f)); resolver set
  - ☑ `EnsReceiptMirror` writes `receipt.latest` / `receipt.head` / `agent.signer` text records on every receipt — live and verified via `cast call`
  - ◔ Per-agent **subname registrar** — using parent name directly for now; PRD §10.2.3 calls for one registrar contract; deferred (single name covers the demo narrative)
- **Phase 7 — Submission artifacts:** 🟡 PARTIAL
  - ☑ README with ACID table, install commands, deployed addresses, ENS verification one-liner
  - ☑ FEEDBACK.md (Uniswap track)
  - ☑ MIT LICENSE
  - ☑ PRD.md / CLAUDE.md
  - ☑ npm packages published — 5 packages × 4 versions (`0.1.0 → 0.1.1 → 0.1.2 → 0.2.0`)
  - ☐ Architecture diagram (single image)
  - ☐ Demo video (≤3 min, A/C/I/D scenes per PRD §10.3)
  - ☐ Live demo link
  - ☐ GitHub repo public + ETHGlobal submission form

When in doubt about scope, dependencies, or "should I cut this?" — open `PRD.md`. The cut list is in §11.x there.

---

## 13. Working with This Repo

A few conventions for agentic / Claude Code sessions:

- **Read `PRD.md` before significant design decisions.** It's the source of truth.
- **Update this file when you change project conventions.** Especially: directory structure, tech stack, adapter interfaces, build commands, naming conventions, gotchas.
- **Update the "Current State" section** as phases progress.
- **Never modify `PRD.md` §3 (Solution) or §7 (API spec) without explicit approval** — those are the contract.
- **Never weaken adapter interfaces.** Adding a method is fine (mark optional). Removing or narrowing is breaking.
- **Tests are non-negotiable for the four primitives.** Coverage target is ≥80%; the conformance suite for adapters is mandatory.
- **No comments explaining what the code does.** Names should do that. Comments are for *why* something non-obvious is true (a hidden constraint, a workaround, a subtle invariant).
- **No emojis in code or docs unless explicitly requested.**
- **Don't create speculative documentation files.** New `.md` files require justification.

---

*If this file has drifted from reality, fix it before doing other work.*
