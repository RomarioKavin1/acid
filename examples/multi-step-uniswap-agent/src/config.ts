import type { Hex } from "viem";

export interface AgentConfig {
  base: {
    rpc: string;
    chainId: 84532;
  };
  zerogChainId: number;
  privateKey: Hex;
  driftThresholdBps: number;
  pollIntervalMs: number;
  slippageBps: number;
  targetEthRatioBps: number;
  pairs: {
    weth: Hex;
    usdc: Hex;
  };
  v4: {
    poolManager: Hex;
    universalRouter: Hex;
    quoter: Hex;
  };
  dryRun: boolean;
  zeroG?: {
    chainRpc: string;
    indexerRpc: string;
    privateKey: string;
  };
}

export function loadConfig(): AgentConfig {
  const argv = new Set(process.argv.slice(2));
  const dryRun = argv.has("--dry-run");

  const rpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const pk = (process.env.EVM_PRIVATE_KEY ?? "0x") as Hex;

  if (!dryRun && pk === "0x") {
    throw new Error(
      "EVM_PRIVATE_KEY missing — set in .env.local or pass --dry-run for offline simulation",
    );
  }

  const config: AgentConfig = {
    base: { rpc, chainId: 84532 },
    zerogChainId: 16602,
    privateKey: pk === "0x" ? generatePlaceholderKey() : pk,
    driftThresholdBps: Number(process.env.DRIFT_THRESHOLD_BPS ?? 500),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
    slippageBps: Number(process.env.SLIPPAGE_BPS ?? 50),
    targetEthRatioBps: Number(process.env.TARGET_ETH_RATIO_BPS ?? 6000),
    pairs: {
      weth: "0x4200000000000000000000000000000000000006" as Hex,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex,
    },
    v4: {
      poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408" as Hex,
      universalRouter: "0x492e6456d9528771018deb9e87ef7750ef184104" as Hex,
      quoter: "0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba" as Hex,
    },
    dryRun,
  };

  if (
    process.env.ZEROG_CHAIN_RPC &&
    process.env.ZEROG_STORAGE_INDEXER_RPC &&
    process.env.ZEROG_CHAIN_PRIVATE_KEY
  ) {
    config.zeroG = {
      chainRpc: process.env.ZEROG_CHAIN_RPC,
      indexerRpc: process.env.ZEROG_STORAGE_INDEXER_RPC,
      privateKey: process.env.ZEROG_CHAIN_PRIVATE_KEY,
    };
  }

  return config;
}

function generatePlaceholderKey(): Hex {
  return ("0x" + "00".repeat(31) + "01") as Hex;
}
