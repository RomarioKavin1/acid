import type { PortfolioSnapshot } from "./wallet-state.js";

export interface DriftDecision {
  shouldSwap: boolean;
  direction: "eth->usdc" | "usdc->eth" | "none";
  amountInWei: bigint;
  amountInUsdc: bigint;
  observedRatioBps: number;
  targetRatioBps: number;
  driftBps: number;
  reason: string;
}

export interface PriceOracle {
  ethUsdcPerEth(): Promise<bigint>;
}

export async function decideRebalance(
  snap: PortfolioSnapshot,
  targetEthRatioBps: number,
  driftThresholdBps: number,
  oracle: PriceOracle,
): Promise<DriftDecision> {
  const usdcPerEth = await oracle.ethUsdcPerEth();
  const ethValueInUsdc = (snap.ethWei * usdcPerEth) / 10n ** 18n;
  const totalUsdc =
    ethValueInUsdc + snap.usdcUnits * 10n ** BigInt(6 - snap.usdcDecimals);
  if (totalUsdc === 0n) {
    return baseline(snap, targetEthRatioBps, "wallet has no value");
  }

  const observedRatioBps = Number((ethValueInUsdc * 10_000n) / totalUsdc);
  const driftBps = Math.abs(observedRatioBps - targetEthRatioBps);
  if (driftBps < driftThresholdBps) {
    return {
      shouldSwap: false,
      direction: "none",
      amountInWei: 0n,
      amountInUsdc: 0n,
      observedRatioBps,
      targetRatioBps: targetEthRatioBps,
      driftBps,
      reason: `drift ${driftBps}bps below threshold ${driftThresholdBps}bps`,
    };
  }

  const targetEthValueInUsdc =
    (totalUsdc * BigInt(targetEthRatioBps)) / 10_000n;
  if (ethValueInUsdc > targetEthValueInUsdc) {
    const surplusUsdc = ethValueInUsdc - targetEthValueInUsdc;
    const amountInWei = (surplusUsdc * 10n ** 18n) / usdcPerEth;
    return {
      shouldSwap: true,
      direction: "eth->usdc",
      amountInWei,
      amountInUsdc: 0n,
      observedRatioBps,
      targetRatioBps: targetEthRatioBps,
      driftBps,
      reason: `over-weighted ETH by ${driftBps}bps; selling ${formatBig(amountInWei, 18)} ETH for USDC`,
    };
  }

  const shortageUsdc = targetEthValueInUsdc - ethValueInUsdc;
  return {
    shouldSwap: true,
    direction: "usdc->eth",
    amountInWei: 0n,
    amountInUsdc: shortageUsdc,
    observedRatioBps,
    targetRatioBps: targetEthRatioBps,
    driftBps,
    reason: `under-weighted ETH by ${driftBps}bps; buying ETH with ${formatBig(shortageUsdc, 6)} USDC`,
  };
}

function baseline(
  _snap: PortfolioSnapshot,
  target: number,
  reason: string,
): DriftDecision {
  return {
    shouldSwap: false,
    direction: "none",
    amountInWei: 0n,
    amountInUsdc: 0n,
    observedRatioBps: 0,
    targetRatioBps: target,
    driftBps: 0,
    reason,
  };
}

function formatBig(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  return s.slice(0, -decimals) + "." + s.slice(-decimals);
}
