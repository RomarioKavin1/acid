import { type Hex, formatUnits } from "viem";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViemPublicLike = any;

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface PortfolioSnapshot {
  ethWei: bigint;
  usdcUnits: bigint;
  usdcDecimals: number;
  blockNumber: number;
}

export async function readPortfolio(
  client: ViemPublicLike,
  account: Hex,
  weth: Hex,
  usdc: Hex,
): Promise<PortfolioSnapshot> {
  const [ethWei, usdcUnits, usdcDecimals, blockNumber] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({
      address: usdc,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>,
    client.readContract({
      address: usdc,
      abi: ERC20_BALANCE_ABI,
      functionName: "decimals",
    }) as Promise<number>,
    client.getBlockNumber(),
  ]);
  return {
    ethWei,
    usdcUnits,
    usdcDecimals,
    blockNumber: Number(blockNumber),
  };
}

export async function readAllowance(
  client: ViemPublicLike,
  token: Hex,
  owner: Hex,
  spender: Hex,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

export function describePortfolio(snap: PortfolioSnapshot): string {
  return `${formatUnits(snap.ethWei, 18)} ETH + ${formatUnits(snap.usdcUnits, snap.usdcDecimals)} USDC @ block ${snap.blockNumber}`;
}
