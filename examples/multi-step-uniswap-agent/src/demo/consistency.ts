/**
 * C — CONSISTENCY
 *
 * Saga executes successfully, but the post-condition (`noOrphanAllowances`)
 * detects that a non-zero allowance was left behind by a misbehaving step.
 * Demonstrates that invariants reject the result even when the saga
 * "succeeded" mechanically.
 */

import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  saga,
  invariant,
  receipted,
  noOrphanAllowances,
  InvariantViolationError,
  type Receipt,
} from "@openacid/acid";
import { banner, step, ok, warn, info, summary, pause } from "./banner.js";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const USDC = "0xUSDC" as const;
const ROUTER = "0xRouter" as const;

interface DemoArgs {
  amount: bigint;
}

async function main(): Promise<void> {
  banner("C", "CONSISTENCY — postcondition fires on orphan allowance");

  const storage = new MemoryStorageAdapter();
  const signer = new MemorySigner(TEST_KEY);

  let leakedAllowance = 0n;

  step(1, "build saga that 'succeeds' but leaves a non-zero allowance behind");
  step(2, "wrap with invariant.post = noOrphanAllowances({ getAllowances })");
  await pause(1);

  const action = receipted<DemoArgs, Record<string, unknown>>({
    storage,
    signer,
    chain: { chainId: 16602 },
    fnName: "rebalance",
    onReceipt: (r: Receipt) =>
      info(`receipt emitted: ${r.callId.slice(0, 14)}…`),
  })(
    invariant<DemoArgs, Record<string, unknown>>({
      post: noOrphanAllowances<DemoArgs, Record<string, unknown>>({
        getAllowances: async () => [
          { token: USDC, spender: ROUTER, amount: leakedAllowance },
        ],
      }),
    })(
      saga<DemoArgs>({
        steps: [
          {
            id: "approve",
            do: async () => {
              leakedAllowance = 5n;
              ok(`approve: USDC allowance = 5  (set high deliberately)`);
              return { tx: "0xtxApprove" };
            },
          },
          {
            id: "swap",
            do: async () => {
              ok(`swap:    USDC → ETH executed (out=950)`);
              return { tx: "0xtxSwap", out: 950n };
            },
          },
          {
            id: "buggy-cleanup",
            do: async () => {
              warn(
                `buggy-cleanup: forgot to call approve(0) — leaving 5 USDC orphan!`,
              );
              return { tx: "0xtxBuggy" };
            },
          },
        ],
        storage,
      }),
    ),
  );

  try {
    await action({ amount: 1000n });
    summary("result", "❌ saga 'succeeded' but action was permitted (BUG)");
    process.exit(1);
  } catch (err) {
    if (err instanceof InvariantViolationError) {
      summary("phase", err.phase);
      summary("severity", err.severity);
      summary("reason", err.reason);
      summary(
        "context",
        JSON.stringify(err.context, replaceBigInt, 0).slice(0, 200),
      );
      info(
        "invariant rejected the action; in 'compensate' mode the saga steps would run their compensators here",
      );
    } else {
      throw err;
    }
  }
}

function replaceBigInt(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
