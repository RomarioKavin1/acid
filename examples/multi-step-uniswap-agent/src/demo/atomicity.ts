/**
 * A — ATOMICITY
 *
 * Multi-step saga (approve → swap → stake) where step 3 throws after steps 1+2
 * succeeded. Demonstrates that compensations run in reverse order and orphan
 * allowances are reverted to zero. Pure in-memory; no chain calls.
 */

import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  saga,
  receipted,
  inspectComposition,
  type Receipt,
} from "@openacid/acid";
import { banner, step, ok, fail, comp, info, summary, pause } from "./banner.js";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

interface DemoArgs {
  amount: bigint;
  deadline: number;
}

interface AllowanceLedger {
  approved: bigint;
}

async function main(): Promise<void> {
  banner("A", "ATOMICITY — saga compensations on partial failure");

  const storage = new MemoryStorageAdapter();
  const signer = new MemorySigner(TEST_KEY);

  const ledger: AllowanceLedger = { approved: 0n };

  step(1, "build saga: approve → swap → stake (stake throws)");
  step(2, "wrap with receipted for an EIP-712 signed audit trail");
  await pause(1);

  const action = receipted<DemoArgs, Record<string, unknown>>({
    storage,
    signer,
    chain: { chainId: 16602 },
    fnName: "rebalance",
    onReceipt: (r) => onReceipt(r),
  })(
    saga<DemoArgs>({
      steps: [
        {
          id: "approve",
          do: async (ctx) => {
            ledger.approved = ctx.args.amount;
            ok(`approve: USDC allowance set to ${ctx.args.amount}`);
            return { tx: "0xtxApprove", amount: ctx.args.amount };
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
          id: "stake",
          do: async () => {
            fail(`stake:   vault paused — throwing to trigger compensation`);
            throw new Error("vault paused — staking unavailable");
          },
        },
      ],
      compensations: {
        approve: async () => {
          ledger.approved = 0n;
          comp(`approve: revoking allowance back to 0`);
        },
        swap: async () => {
          comp(`swap: no compensation registered (idempotent on chain)`);
        },
      },
      storage,
    }),
  );

  info(
    `composition: ${inspectComposition(action).join(" → ")}  (outermost first)`,
  );
  await pause(0.5);

  try {
    await action({ amount: 1000n, deadline: Date.now() / 1000 + 60 });
    fail("saga unexpectedly succeeded — demo broken");
    process.exit(1);
  } catch (err) {
    summary(
      "saga threw",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    summary(
      "final allowance",
      ledger.approved === 0n
        ? `0  ✓  (compensation reverted the approve)`
        : `${ledger.approved}  ✗  ORPHAN — should be zero`,
    );
  }
}

function onReceipt(r: Receipt): void {
  info(`receipt signed:  callId=${r.callId.slice(0, 14)}…`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
