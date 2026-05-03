/**
 * I — ISOLATION
 *
 * Two parallel calls with the same idempotency key. Demonstrates that the
 * underlying work runs exactly once; the second call blocks on the in-flight
 * marker and returns the cached result.
 */

import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  saga,
  idempotent,
  receipted,
} from "@openacid/acid";
import { banner, step, ok, info, summary, pause } from "./banner.js";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

interface RebalanceArgs {
  targetRatio: number;
  deadline: number;
}

async function main(): Promise<void> {
  banner("I", "ISOLATION — parallel calls deduped by idempotency key");

  const storage = new MemoryStorageAdapter();
  const signer = new MemorySigner(TEST_KEY);

  let actualRunCount = 0;

  step(1, "build receipted(idempotent(saga)) with key='rebalance:60:dl'");
  step(2, "fire two calls in parallel with identical args");
  await pause(1);

  const action = receipted<RebalanceArgs, Record<string, unknown>>({
    storage,
    signer,
    chain: { chainId: 16602 },
    fnName: "rebalance",
  })(
    idempotent<RebalanceArgs, Record<string, unknown>>({
      key: (a) => `rebalance:${a.targetRatio}:${a.deadline}`,
      storage,
      pollIntervalMs: 25,
    })(
      saga<RebalanceArgs>({
        steps: [
          {
            id: "swap",
            do: async () => {
              actualRunCount++;
              info(`saga: actually executing the swap (count=${actualRunCount})`);
              await pause(1.2);
              return { tx: "0xtxSwap", out: 950n };
            },
          },
        ],
        storage,
      }),
    ),
  );

  const args: RebalanceArgs = { targetRatio: 60, deadline: 1700000000 };
  const startedAt = Date.now();

  ok(`call A: dispatched at t+0ms`);
  const a = action(args);

  await pause(0.05);
  ok(`call B: dispatched at t+50ms (sees in-flight marker)`);
  const b = action(args);

  const [resultA, resultB] = await Promise.all([a, b]);
  const elapsed = Date.now() - startedAt;

  summary("call A returned", JSON.stringify(resultA, replaceBigInt));
  summary("call B returned", JSON.stringify(resultB, replaceBigInt));
  summary(
    "results identical",
    JSON.stringify(resultA, replaceBigInt) ===
      JSON.stringify(resultB, replaceBigInt)
      ? "✓"
      : "✗",
  );
  summary("saga executions", `${actualRunCount}  (expected: 1)`);
  summary("wall time", `${elapsed}ms`);
}

function replaceBigInt(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
