# multi-step-uniswap-agent

The reference agent for the **OpenACID** library. A long-running portfolio rebalancer that targets a 60/40 ETH/USDC split on **Base Sepolia** and routes the rebalance through Uniswap V4. The rebalance action is wrapped in `receipted(invariant(idempotent(saga(...))))`. Receipts are persisted to **0G Galileo** and mirrored to **`openacid.eth`** on Sepolia ENS.

## Demo scenes (recommended for recording)

Each scene is a self-contained script with banner output that's easy to read on a screen recording. They run in-memory only — no funded wallets needed.

```bash
pnpm --filter @openacid/example-uniswap-agent demo:a     # Atomicity (in-memory)
pnpm --filter @openacid/example-uniswap-agent demo:c     # Consistency (in-memory)
pnpm --filter @openacid/example-uniswap-agent demo:i     # Isolation (in-memory)
pnpm --filter @openacid/example-uniswap-agent demo:d     # Durability (in-memory)
pnpm --filter @openacid/example-uniswap-agent demo:all   # all four in order
pnpm --filter @openacid/example-uniswap-agent demo:live  # ★ live tick: Base Sepolia + 0G + ENS readback
```

Or use the orchestrator with narration pauses (PAUSE=N seconds between scenes):

```bash
./scripts/demo.sh             # default 2s pause between scenes
PAUSE=5 ./scripts/demo.sh     # longer pauses for narration
./scripts/demo.sh --fast      # no pauses (CI smoke)
```

### What each scene proves

| Scene | What it demonstrates | Where the proof comes from |
|---|---|---|
| **A — Atomicity** | A 3-step saga where step 3 throws after 1+2 succeed. Compensations run in reverse; the orphan ERC20 allowance is reverted to zero. | `saga` + `compensations: { approve }` |
| **C — Consistency** | A saga "succeeds" mechanically but leaves a 5 USDC orphan allowance. The `noOrphanAllowances` postcondition rejects the action with severity `critical`. | `invariant` + `noOrphanAllowances` |
| **I — Isolation** | Two parallel `action()` calls with identical args. The second blocks on the in-flight marker; the underlying saga runs once; both calls receive the same result. | `idempotent` |
| **D — Durability** | Saga runs in "process A", receipt is persisted, "process A is killed", "process B" restarts with the same args. No re-broadcast. The persisted receipt's EIP-712 signature still recovers to the signer's address. | `receipted` + `verifyReceipt` |
| **LIVE** | One tick of the rebalancer against **real Base Sepolia** balances, a **real Uniswap V4 swap broadcast** (Universal Router `V4_SWAP` against the ETH/USDC pool), **real 0G Galileo** receipt blob upload, and **real Sepolia ENS** text record write. Reads `openacid.eth/receipt.latest` before and after; polls until the resolver reflects the new callId. Caps the live swap size via `LIVE_AMOUNT_IN_WEI_CAP` (default 0.001 ETH) so a single tick doesn't drain the wallet on thin testnet liquidity. | `RebalancingAgent.tick` + V4 Universal Router + `EnsReceiptMirror` + viem ENS resolver |

## Running the live agent

After the demo scenes, you can run the actual rebalancer:

```bash
# Dry run — no creds, no chain writes; saga executes with simulated tx hashes.
pnpm --filter @openacid/example-uniswap-agent dry-run

# Live — funded Base Sepolia signer, real receipts to 0G + ENS when configured.
pnpm --filter @openacid/example-uniswap-agent dev
```

Required env (in repo-root `.env`):

```
EVM_PRIVATE_KEY=0x...                              # wallet on Base Sepolia (0.05+ ETH)
BASE_SEPOLIA_RPC=https://sepolia.base.org

# Optional — receipts go to 0G when set, otherwise stay in memory
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_CHAIN_PRIVATE_KEY=0x...

# Optional — receipts mirror to ENS text records when set
ENS_PARENT_NAME=openacid.eth
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
ENS_PRIVATE_KEY=0x...                              # owner of openacid.eth
ENS_PUBLIC_RESOLVER=0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5

# Tuning
DRIFT_THRESHOLD_BPS=500       # 5%
TARGET_ETH_RATIO_BPS=6000     # 60%
SLIPPAGE_BPS=50               # 0.5%
POLL_INTERVAL_MS=30000

# V4 pool selection — defaults are the live ETH/USDC pool on Base Sepolia
POOL_FEE=500                  # 0.05%
POOL_TICK_SPACING=10
POOL_HOOKS=0x0000000000000000000000000000000000000000

# Live swap safety cap (wei). Default for demo:live is 10^15 = 0.001 ETH.
LIVE_AMOUNT_IN_WEI_CAP=1000000000000000
```

## Recording the demo (3-min video)

Suggested narration & timing:

| Time | What happens on screen | What you say |
|---|---|---|
| 0:00–0:15 | Title card from `./scripts/demo.sh` | "OpenACID brings classical ACID guarantees to AI agents that hold real money." |
| 0:15–0:50 | `demo:a` runs | "Atomicity. A multi-step swap saga, with one step deliberately failing. The library auto-runs compensations in reverse — the orphan allowance is gone." |
| 0:50–1:25 | `demo:c` runs | "Consistency. The saga succeeds mechanically but leaves a non-zero allowance. The postcondition fires; the action is rejected." |
| 1:25–1:55 | `demo:i` runs | "Isolation. Two parallel calls, same idempotency key. The second blocks; only one execution; both calls get the same result." |
| 1:55–2:25 | `demo:d` runs | "Durability. The agent broadcasts, then crashes. On restart, no re-broadcast, no double-spend. The persisted receipt is signed and verifies." |
| 2:25–3:05 | `demo:live` runs against real chains | "And here's the full pipeline live. Base Sepolia balance read, decision, saga — quotes V4, applies slippage, broadcasts the actual `V4_SWAP` against the ETH/USDC pool — receipt blob to 0G Storage, ENS mirror — and now we're polling the resolver until it reflects the new callId. Verified on chain: real swap tx, real receipt CID, any third party can hit any ENS resolver and read it back." |

## Architecture (per the rebalance action)

```
USER CODE
  agent.tick() → action(args)

ACTION COMPOSITION (outer to inner):
  receipted({ storage: 0G, signer, chain: 0G Galileo })
    invariant({ pre: amountIn>0, post: noOrphanAllowances })
      idempotent({ key: rebalance:dir:amount:deadline })
        saga({ steps: [approve, swap, stake] })

ON-CHAIN WRITES:
  Base Sepolia        — V4 swap (Universal Router execute, V4_SWAP cmd)
                        actions: SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL
                        ETH input: native value, no Permit2
  0G Galileo          — receipt blob upload     (receipted's persistence)
  Sepolia ENS         — text record writes      (EnsReceiptMirror onReceipt)
```
