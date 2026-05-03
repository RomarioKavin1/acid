import { describe, it, expect, vi } from "vitest";
import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  receipted,
  invariant,
  idempotent,
  saga,
  verifyReceipt,
  SagaStepError,
  InvariantViolationError,
  type Receipt,
} from "@openacid/acid";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const CHAIN = { chainId: 16602 };

interface RebalanceArgs {
  targetRatio: number;
  amountIn: bigint;
  deadline: number;
}

describe("integration: receipted(invariant(idempotent(saga())))", () => {
  it("happy path — all four primitives compose end-to-end", async () => {
    const storage = new MemoryStorageAdapter();
    const signer = new MemorySigner(ANVIL_KEY);

    const approve = vi.fn(async () => "0xtxApprove");
    const swap = vi.fn(async () => ({ tx: "0xtxSwap", out: 950n }));
    const deposit = vi.fn(async () => "0xtxDeposit");

    let capturedReceipt: Receipt | undefined;

    const rebalance = receipted({
      storage,
      signer,
      chain: CHAIN,
      fnName: "rebalance",
      collectTxRefs: (r) => {
        const res = r as Record<string, unknown>;
        return Object.values(res)
          .filter((v): v is string => typeof v === "string" && v.startsWith("0x"))
          .concat(
            Object.values(res)
              .filter(
                (v): v is { tx: string } =>
                  typeof v === "object" &&
                  v !== null &&
                  typeof (v as { tx: unknown }).tx === "string",
              )
              .map((v) => v.tx),
          );
      },
      onReceipt: (r) => {
        capturedReceipt = r;
      },
    })(
      invariant<RebalanceArgs, Record<string, unknown>>({
        pre: async (a) => a.amountIn > 0n,
        post: async (_a, results) => {
          const swapResult = results.swap as { out: bigint };
          return swapResult.out > 0n;
        },
      })(
        idempotent<RebalanceArgs, Record<string, unknown>>({
          key: (a) => `rebalance:${a.targetRatio}:${a.deadline}`,
          storage,
        })(
          saga<RebalanceArgs>({
            steps: [
              { id: "approve", do: () => approve() },
              { id: "swap", do: () => swap() },
              { id: "deposit", do: () => deposit() },
            ],
            storage,
          }),
        ),
      ),
    );

    const args: RebalanceArgs = {
      targetRatio: 60,
      amountIn: 1000n,
      deadline: 1700000000,
    };
    const out = await rebalance(args);

    expect(out).toEqual({
      approve: "0xtxApprove",
      swap: { tx: "0xtxSwap", out: 950n },
      deposit: "0xtxDeposit",
    });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledTimes(1);

    expect(capturedReceipt).toBeDefined();
    expect(capturedReceipt!.txRefs).toContain("0xtxApprove");
    expect(capturedReceipt!.txRefs).toContain("0xtxDeposit");
    expect(capturedReceipt!.txRefs).toContain("0xtxSwap");
    expect(
      await verifyReceipt(
        capturedReceipt!,
        signer.identity as `0x${string}`,
        CHAIN,
      ),
    ).toBe(true);
  });

  it("idempotency — a duplicate call returns the cached saga result without re-running steps", async () => {
    const storage = new MemoryStorageAdapter();
    const signer = new MemorySigner(ANVIL_KEY);
    const swap = vi.fn(async () => ({ tx: "0xa", out: 100n }));

    const make = () =>
      receipted({
        storage,
        signer,
        chain: CHAIN,
        fnName: "rebalance",
      })(
        idempotent<RebalanceArgs, Record<string, unknown>>({
          key: (a) => `rebalance:${a.targetRatio}:${a.deadline}`,
          storage,
        })(
          saga<RebalanceArgs>({
            steps: [{ id: "swap", do: () => swap() }],
            storage,
          }),
        ),
      );

    const args: RebalanceArgs = {
      targetRatio: 60,
      amountIn: 1n,
      deadline: 0,
    };
    await make()(args);
    await make()(args);
    expect(swap).toHaveBeenCalledTimes(1);
  });

  it("saga step failure runs compensations and bubbles a SagaStepError up", async () => {
    const storage = new MemoryStorageAdapter();
    const signer = new MemorySigner(ANVIL_KEY);

    const compApprove = vi.fn(async () => undefined);

    const action = receipted({
      storage,
      signer,
      chain: CHAIN,
      fnName: "rebalance",
    })(
      idempotent<RebalanceArgs, Record<string, unknown>>({
        key: (a) => `rebalance:${a.deadline}`,
        storage,
      })(
        saga<RebalanceArgs>({
          steps: [
            { id: "approve", do: async () => "0xapprove" },
            {
              id: "swap",
              do: async () => {
                throw new Error("router reverted");
              },
            },
          ],
          compensations: { approve: compApprove },
          storage,
        }),
      ),
    );

    await expect(
      action({ targetRatio: 60, amountIn: 1n, deadline: 1 }),
    ).rejects.toBeInstanceOf(SagaStepError);
    expect(compApprove).toHaveBeenCalledOnce();
  });

  it("invariant pre-condition failure refuses to invoke the saga", async () => {
    const storage = new MemoryStorageAdapter();
    const signer = new MemorySigner(ANVIL_KEY);
    const swap = vi.fn(async () => "should-not-run");

    const action = receipted({
      storage,
      signer,
      chain: CHAIN,
    })(
      invariant<RebalanceArgs, Record<string, unknown>>({
        pre: async (a) => a.amountIn > 0n,
      })(
        saga<RebalanceArgs>({
          steps: [{ id: "swap", do: () => swap() }],
          storage,
        }),
      ),
    );

    await expect(
      action({ targetRatio: 60, amountIn: 0n, deadline: 0 }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(swap).not.toHaveBeenCalled();
  });
});
