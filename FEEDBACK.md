# FEEDBACK — Uniswap V4 + agent-style retry-safe execution

This is OpenACID's submission feedback for the Uniswap track of ETHGlobal Open Agents. It's the candid version: what worked, what didn't, what we wished existed when we wrapped V4 in saga compensations.

## What worked

- **V4 testnet coverage is solid.** PoolManager, PositionManager, Universal Router, StateView, and V4Quoter are all live on both Base Sepolia (84532) and Unichain Sepolia (1301). We hit `https://sepolia.base.org` directly in our tests; no rate-limiting issues on the public endpoint for read-only ops.
- **`viem` interop is excellent.** `createPublicClient` + `getBalance` / `readContract` / `writeContract` gave us everything we needed for the rebalancer's read path. The chain adapter wraps these cleanly.
- **Permit2 + Universal Router are conceptually well-suited for agents** — single-call execution with a `commands + inputs` payload makes saga step boundaries clear.

## What didn't (gaps we hit)

### 1. No first-class "agent retry" story in the V4 docs

V4 docs assume the developer is building a **frontend** that submits a swap once. There's no canonical answer for:

- "I broadcast a swap, my process died before I got a receipt. On restart, how do I tell whether the swap mined?"
- "My approve+swap failed at swap. What's the right pattern to revoke the orphan allowance?"
- "I want to dedupe a swap by intent (target ratio + deadline) so a duplicate trigger doesn't double-execute."

OpenACID's saga + idempotent + invariant solves this *outside* V4 — but V4 docs would benefit from a short page on "long-running automated agent" retry patterns. The current Quickstart implicitly assumes the user is sitting at a wallet.

### 2. Universal Router `commands + inputs` payload assembly is verbose

Building the V4 swap command for a basic single-pool swap requires:
- Encoding the swap path
- Computing `amountIn` / `amountOutMin`
- Packing into the V4_SWAP command byte
- Encoding settle + take pairs

For a hackathon-paced rebalancer, this was the single biggest scope-cut driver. Our `examples/multi-step-uniswap-agent` ships a dry-run mode that simulates the swap step rather than implementing the full command payload assembly; the live swap is a documented extension point.

**Wish:** a small TypeScript helper, ideally first-party from Uniswap, that takes `(poolKey, amountIn, amountOutMin, recipient, deadline)` and returns the encoded `commands + inputs` for the most common single-pool case. We could implement it in `@openacid/adapter-viem`, but a Uniswap-blessed version would carry more weight.

### 3. V4 hooks are powerful but the documentation under-emphasizes the "what gets reverted on failure" question

When a hook reverts, the parent V4 swap reverts. Good — our saga compensations don't fire because `swap` step never returned. But a hook that *partially* succeeds (e.g., updates external state then reverts) leaves orphan state in the hook's domain. There's no docs-level guidance on *idempotent hook design* — it's left to the hook author. Adding a "writing a saga-friendly hook" section to V4 docs would help.

### 4. `V4Quoter` returns simulated outputs but doesn't surface gas estimates

For our `gasUnderCap` invariant, we want a single call that quotes both the output amount AND the expected gas. Today we need two RPC calls (`quoteExactInputSingle` + `eth_estimateGas`). Combining them into a single RPC would cut latency for agents that quote on every poll.

### 5. Cross-chain receipt anchoring expectation

OpenACID anchors receipts on **0G Chain**, not Base. Our agent broadcasts swaps on Base Sepolia and writes receipts (with chain refs to the Base tx hashes) into a `ReceiptRegistry.sol` on 0G. There's no canonical Uniswap pattern for "the action is on Uniswap, the audit trail is elsewhere." We invented one — but a Uniswap-published reference for how partner protocols should reference V4 txs in their own audit storage would be welcome.

## What we wished existed

- A "retry-safe Uniswap agent" cookbook. Even a 1-page Markdown doc covering the common gotchas (replaced-by-fee, mempool drop, reverted hook with side effects) would unblock a lot of hackathon teams.
- A canonical TypeScript helper for V4 single-pool swaps via Universal Router — the equivalent of V3's `swapRouter.exactInputSingle({...})` ergonomics.
- An official testnet faucet pinned to a Uniswap-aware UI (e.g., "claim 0.05 Sepolia ETH + 100 testnet USDC for swapping"). Today, getting both sides funded means hitting two faucets and waiting twice.
- Consistent `chainId` documentation between the developer hub and the deployments page. Our Phase 0 verification turned up zero discrepancies on V4 addresses, but several other corners of the docs still had `--rpc-url <RPC>` placeholders without a recommended testnet RPC.

## What OpenACID adds that V4 doesn't

For the Uniswap ecosystem specifically, OpenACID brings:
1. `saga.compensations.approve = revoke()` — the canonical "revert orphan allowance" pattern, executed automatically on multi-step failure.
2. `idempotent` keyed by intent — the same `rebalance({ targetRatio, deadline })` cannot double-execute even if the agent's planner emits it twice.
3. `noOrphanAllowances` postcondition — invariant fires after the saga to confirm the wallet is clean. If a swap "succeeded" mechanically but left a non-zero allowance, the action is rejected and compensations re-run.
4. EIP-712 signed receipts — every Uniswap V4 interaction is recorded with a signed, verifiable receipt anchored on 0G Chain via `ReceiptRegistry.sol`. Auditors don't need our library to verify; `ecrecover` against the receipt struct hash works on any EVM.

## Closing

V4's primitives are the right shape for agents. The missing piece is durability semantics — and that's what OpenACID is building. We hope this feedback is useful; happy to PR docs improvements upstream if there's interest.

— Romario Kavin, OpenACID
