import {
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from "viem";

export const NATIVE: Hex = "0x0000000000000000000000000000000000000000";

const V4_SWAP_COMMAND: Hex = "0x10";

const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;

export interface PoolKey {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export interface BuildExactInSingleArgs {
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

export interface BuiltSwap {
  commands: Hex;
  inputs: [Hex];
  value: bigint;
  poolKey: PoolKey;
  zeroForOne: boolean;
}

export function buildExactInSingleSwap(args: BuildExactInSingleArgs): BuiltSwap {
  const { tokenIn, tokenOut, fee, tickSpacing, hooks, amountIn, amountOutMinimum } = args;

  const [c0, c1] =
    tokenIn.toLowerCase() < tokenOut.toLowerCase()
      ? [tokenIn, tokenOut]
      : [tokenOut, tokenIn];
  const zeroForOne = tokenIn.toLowerCase() === c0.toLowerCase();
  const poolKey: PoolKey = { currency0: c0, currency1: c1, fee, tickSpacing, hooks };

  const exactInSingleParam = encodeAbiParameters(
    parseAbiParameters(
      "((address,address,uint24,int24,address),bool,uint128,uint128,bytes)",
    ),
    [
      [
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        zeroForOne,
        amountIn,
        amountOutMinimum,
        "0x",
      ],
    ],
  );

  const settleParam = encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [tokenIn, amountIn],
  );

  const takeParam = encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [tokenOut, amountOutMinimum],
  );

  const actions = `0x${[
    ACTION_SWAP_EXACT_IN_SINGLE,
    ACTION_SETTLE_ALL,
    ACTION_TAKE_ALL,
  ]
    .map((a) => a.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const v4SwapInput = encodeAbiParameters(
    parseAbiParameters("bytes, bytes[]"),
    [actions, [exactInSingleParam, settleParam, takeParam]],
  );

  return {
    commands: V4_SWAP_COMMAND,
    inputs: [v4SwapInput],
    value: tokenIn.toLowerCase() === NATIVE ? amountIn : 0n,
    poolKey,
    zeroForOne,
  };
}

export interface QuoteArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any;
  quoter: Hex;
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
  amountIn: bigint;
}

export async function quoteExactInputSingle(args: QuoteArgs): Promise<bigint> {
  const { publicClient, quoter, tokenIn, tokenOut, fee, tickSpacing, hooks, amountIn } = args;

  const [c0, c1] =
    tokenIn.toLowerCase() < tokenOut.toLowerCase()
      ? [tokenIn, tokenOut]
      : [tokenOut, tokenIn];
  const zeroForOne = tokenIn.toLowerCase() === c0.toLowerCase();

  const sim = await publicClient.simulateContract({
    address: quoter,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: { currency0: c0, currency1: c1, fee, tickSpacing, hooks },
        zeroForOne,
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
  });
  return sim.result[0] as bigint;
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  const denom = 10_000n;
  const num = denom - BigInt(slippageBps);
  return (amount * num) / denom;
}
