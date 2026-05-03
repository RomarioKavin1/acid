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
import {
  buildExactInSingleSwap,
  quoteExactInputSingle,
  applySlippage,
  UNIVERSAL_ROUTER_ABI,
  NATIVE,
} from "./v4-swap.js";

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
  quoter: Hex;
  pool: { fee: number; tickSpacing: number; hooks: Hex };
  slippageBps: number;
  liveAmountInWeiCap?: bigint;
  dryRun: boolean;
  onReceipt?: (r: Receipt) => Promise<void> | void;
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
    quoter,
    pool,
    slippageBps,
    liveAmountInWeiCap,
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

          if (decision.direction === "usdc->eth") {
            throw new Error(
              "USDC→ETH live swap requires Permit2 wiring; not implemented yet. Run with --dry-run for this direction or fund the wallet so drift triggers ETH→USDC.",
            );
          }

          const tokenIn = NATIVE;
          const tokenOut = usdc;
          const cappedAmountIn =
            liveAmountInWeiCap !== undefined &&
            decision.amountInWei > liveAmountInWeiCap
              ? liveAmountInWeiCap
              : decision.amountInWei;

          const quoted = await quoteExactInputSingle({
            publicClient,
            quoter,
            tokenIn,
            tokenOut,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hooks: pool.hooks,
            amountIn: cappedAmountIn,
          });
          const minOut = applySlippage(quoted, slippageBps);

          const built = buildExactInSingleSwap({
            tokenIn,
            tokenOut,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hooks: pool.hooks,
            amountIn: cappedAmountIn,
            amountOutMinimum: minOut,
          });

          const txHash: Hex = await walletClient.writeContract({
            address: universalRouter,
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: "execute",
            args: [built.commands, built.inputs, BigInt(ctx.args.deadline)],
            value: built.value,
            account: walletClient.account!,
            chain: walletClient.chain,
          });

          const rcpt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
          });
          if (rcpt.status !== "success") {
            throw new Error(
              `V4 swap reverted on Base Sepolia: tx=${txHash} status=${rcpt.status}`,
            );
          }

          return {
            tx: txHash,
            out: quoted,
            minOut,
            amountIn: cappedAmountIn,
          };
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
    onReceipt: async (r) => {
      lastReceipt = r;
      if (deps.onReceipt) await deps.onReceipt(r);
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
