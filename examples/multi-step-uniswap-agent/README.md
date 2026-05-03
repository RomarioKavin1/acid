# multi-step-uniswap-agent

Reference agent for the **OpenACID** library: a long-running portfolio rebalancer that targets a 60/40 ETH/USDC split on **Base Sepolia** and routes the rebalance through Uniswap V4. The rebalance action is wrapped in `receipted(invariant(idempotent(saga(...))))`.

## Run modes

```bash
# Dry run — no creds, no chain writes; the saga executes with simulated tx hashes.
pnpm --filter @openacid/example-uniswap-agent dry-run

# Live — funds Base Sepolia signing, writes receipts to 0G when configured.
pnpm --filter @openacid/example-uniswap-agent dev
```

Required env (`.env.local` at repo root):

```
EVM_PRIVATE_KEY=0x...                     # wallet on Base Sepolia
BASE_SEPOLIA_RPC=https://sepolia.base.org

# optional — receipts go to 0G when set, otherwise stay in memory
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_STORAGE_INDEXER_RPC=...
ZEROG_CHAIN_PRIVATE_KEY=0x...

# tuning
DRIFT_THRESHOLD_BPS=500       # 5%
TARGET_ETH_RATIO_BPS=6000     # 60%
SLIPPAGE_BPS=50               # 0.5%
POLL_INTERVAL_MS=30000
```

## What it demonstrates

| ACID property | Where it shows up |
|---|---|
| **A**tomicity | `saga` runs `approve → swap → (stake)`. If `swap` reverts, `approve` is auto-revoked. |
| **C**onsistency | `noOrphanAllowances` post-condition fires after the saga; if a non-zero allowance remains, the action is rejected. |
| **I**solation | `idempotent` keys the action by direction + amount + deadline. A duplicate call within 10 minutes returns the cached saga result without re-executing. |
| **D**urability | `receipted` produces an EIP-712 signed receipt for every attempt and persists it to 0G Storage. The receipt chain is queryable by `prevReceipt`. |

## Notes on the live swap path

V4 swaps go through the Universal Router with a `commands + inputs` payload. The dry-run mode simulates the swap step; live execution requires assembling the V4 swap command for the chosen pool and is left as the obvious extension. Phase 0 verified the V4 deployment addresses on Base Sepolia (PoolManager, Universal Router, V4Quoter, etc.) — they are baked into `src/config.ts`.
