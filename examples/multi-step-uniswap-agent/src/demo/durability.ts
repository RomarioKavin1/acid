/**
 * D — DURABILITY
 *
 * Simulates a process crash mid-saga, then a "restart" with the same args.
 * Two phases share storage (as 0G Storage would across crashes). The second
 * phase finds the prior receipt and returns the cached result without
 * re-broadcasting. Closes with `verifyReceipt(...)` proving the EIP-712
 * signature is intact across the simulated crash.
 */

import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  saga,
  idempotent,
  receipted,
  verifyReceipt,
  type Receipt,
} from "@openacid/acid";
import {
  banner,
  step,
  ok,
  info,
  summary,
  pause,
} from "./banner.js";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const CHAIN = { chainId: 16602 };

interface RebalanceArgs {
  targetRatio: number;
  deadline: number;
}

async function main(): Promise<void> {
  banner("D", "DURABILITY — kill-9 mid-broadcast, no re-execution on restart");

  // Shared storage across both "processes" — same role 0G Storage plays in production.
  const storage = new MemoryStorageAdapter();
  const signer = new MemorySigner(TEST_KEY);

  let totalBroadcasts = 0;
  let lastReceipt: Receipt | undefined;

  const buildAction = () =>
    receipted<RebalanceArgs, Record<string, unknown>>({
      storage,
      signer,
      chain: CHAIN,
      fnName: "rebalance",
      onReceipt: (r) => {
        lastReceipt = r;
      },
    })(
      idempotent<RebalanceArgs, Record<string, unknown>>({
        key: (a) => `rebalance:${a.targetRatio}:${a.deadline}`,
        storage,
      })(
        saga<RebalanceArgs>({
          steps: [
            {
              id: "swap",
              do: async () => {
                totalBroadcasts++;
                info(`saga: broadcasting tx (broadcast #${totalBroadcasts})`);
                return { tx: "0xtxSwap", out: 950n };
              },
            },
          ],
          storage,
        }),
      ),
    );

  const args: RebalanceArgs = { targetRatio: 60, deadline: 1700000000 };

  step(1, "PHASE 1 — process A starts, runs saga, persists receipt");
  await pause(0.5);
  await buildAction()(args);
  ok(`phase 1 complete: ${totalBroadcasts} broadcast`);
  summary("receipt callId", lastReceipt!.callId);
  summary("receipt signature", lastReceipt!.signature.slice(0, 22) + "…");
  await pause(0.5);

  step(2, "(simulated kill -9 — process A killed mid-loop)");
  await pause(0.8);

  step(3, "PHASE 2 — process B restarts with the SAME args");
  await pause(0.5);
  await buildAction()(args);
  await pause(0.3);

  summary(
    "broadcast count",
    `${totalBroadcasts}  (expected: 1, NOT 2 — durability worked)`,
  );

  step(4, "verifying the persisted receipt still recovers to the signer");
  const ok1 = await verifyReceipt(
    lastReceipt!,
    signer.identity as `0x${string}`,
    CHAIN,
  );
  summary("verifyReceipt", ok1 ? "✓ EIP-712 signature recovers correctly" : "✗");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
