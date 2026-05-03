import type { Hex } from "viem";
import {
  saga,
  invariant,
  idempotent,
  receipted,
  noOrphanAllowances,
  type Receipt,
} from "@openacid/acid";
import type {
  StorageAdapter,
  SignerAdapter,
} from "@openacid/acid";
import type { DriftDecision } from "./drift.js";
import { readAllowance } from "./wallet-state.js";

// Loose viem client types so the example doesn't fight pnpm's hoisting (the
// strict viem types reference identical generics that pnpm gives us under
// different module identities).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViemPublicLike = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViemWalletLike = any;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface RebalanceArgs {
  decision: DriftDecision;
  deadline: number;
}

export interface BuildSagaDeps {
  publicClient: ViemPublicLike;
  walletClient: ViemWalletLike;
  agentAddress: Hex;
  storage: StorageAdapter;
  signer: SignerAdapter;
  receiptStorage: StorageAdapter;
  zerogChainId: number;
  weth: Hex;
  usdc: Hex;
  universalRouter: Hex;
  dryRun: boolean;
  agentName: string;
}

export function buildRebalanceAction(deps: BuildSagaDeps) {
  const {
    publicClient,
    walletClient,
    agentAddress,
    storage,
    signer,
    receiptStorage,
    zerogChainId,
    weth,
    usdc,
    universalRouter,
    dryRun,
    agentName,
  } = deps;

  const sagaPipeline = saga<RebalanceArgs>({
    steps: [
      {
        id: "approve",
        do: async (ctx) => {
          const { decision } = ctx.args;
          if (decision.direction === "usdc->eth") {
            const amount = decision.amountInUsdc;
            if (dryRun) {
              return {
                tx: simulatedHash("approve", ctx.sagaId),
                token: usdc,
                amount,
              };
            }
            const hash = await walletClient.writeContract({
              address: usdc,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [universalRouter, amount],
              account: walletClient.account!,
              chain: walletClient.chain,
            });
            return { tx: hash, token: usdc, amount };
          }
          if (dryRun) {
            return {
              tx: simulatedHash("approve-skipped", ctx.sagaId),
              token: weth,
              amount: 0n,
            };
          }
          return { tx: "0x0", token: weth, amount: 0n };
        },
      },
      {
        id: "swap",
        do: async (ctx) => {
          const { decision } = ctx.args;
          if (dryRun) {
            const out =
              decision.direction === "eth->usdc"
                ? { tx: simulatedHash("swap", ctx.sagaId), out: 950n }
                : { tx: simulatedHash("swap", ctx.sagaId), out: 950n * 10n ** 12n };
            return out;
          }
          throw new Error(
            "live V4 swap not implemented in this example — use --dry-run or extend with the Universal Router commands payload for your pool",
          );
        },
      },
    ],
    compensations: {
      approve: async (_ctx, prior) => {
        const detail = prior as { token: Hex; amount: bigint };
        if (detail.amount === 0n) return;
        if (dryRun) return;
        await walletClient.writeContract({
          address: detail.token,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [universalRouter, 0n],
          account: walletClient.account!,
          chain: walletClient.chain,
        });
      },
    },
    storage,
  });

  const guarded = invariant<RebalanceArgs, Record<string, unknown>>({
    pre: async (a) => {
      if (!a.decision.shouldSwap) {
        return { reason: "no rebalance needed", severity: "medium" };
      }
      if (Date.now() / 1000 > a.deadline) {
        return { reason: "deadline passed before action", severity: "high" };
      }
      return true;
    },
    post: noOrphanAllowances<RebalanceArgs, Record<string, unknown>>({
      getAllowances: async () => {
        if (dryRun) return [];
        const u = await readAllowance(
          publicClient,
          usdc,
          agentAddress,
          universalRouter,
        );
        const w = await readAllowance(
          publicClient,
          weth,
          agentAddress,
          universalRouter,
        );
        return [
          { token: usdc, spender: universalRouter, amount: u },
          { token: weth, spender: universalRouter, amount: w },
        ];
      },
      allow: () => false,
    }),
  })(sagaPipeline);

  const deduped = idempotent<RebalanceArgs, Record<string, unknown>>({
    key: (a) =>
      `rebalance:${a.decision.direction}:${a.decision.amountInWei}:${a.decision.amountInUsdc}:${a.deadline}`,
    storage,
    ttl: 600,
    inFlight: "block",
  })(guarded);

  let lastReceipt: Receipt | undefined;
  const action = receipted<RebalanceArgs, Record<string, unknown>>({
    storage: receiptStorage,
    signer,
    chain: { chainId: zerogChainId },
    fnName: "rebalance",
    prevReceiptKey: agentName,
    collectTxRefs: (r) => {
      const out: string[] = [];
      const o = r as Record<string, unknown>;
      for (const v of Object.values(o)) {
        if (
          typeof v === "object" &&
          v !== null &&
          typeof (v as { tx: unknown }).tx === "string"
        ) {
          out.push((v as { tx: string }).tx);
        }
      }
      return out;
    },
    onReceipt: (r) => {
      lastReceipt = r;
    },
  })(deduped);

  return {
    action,
    getLastReceipt: () => lastReceipt,
  };
}

function simulatedHash(label: string, sagaId: string): string {
  const tail = sagaId.replace(/^0x/, "").padEnd(40, "0").slice(0, 40);
  return `0xDRYRUN${label.padEnd(10, "_").slice(0, 10)}${tail}`;
}
