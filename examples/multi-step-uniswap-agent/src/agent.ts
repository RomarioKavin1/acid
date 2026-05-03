import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import {
  MemoryStorageAdapter,
} from "@openacid/adapter-memory";
import { ViemSigner } from "@openacid/adapter-viem";
import { ZeroGStorageAdapter } from "@openacid/adapter-0g-storage";
import { EnsReceiptMirror } from "@openacid/adapter-ens";
import type { StorageAdapter, SignerAdapter, Receipt } from "@openacid/acid";
import { loadConfig, type AgentConfig } from "./config.js";
import { readPortfolio, describePortfolio } from "./wallet-state.js";
import { decideRebalance } from "./drift.js";
import { buildRebalanceAction, type RebalanceArgs } from "./saga-build.js";

export interface AgentTickResult {
  observedRatioBps: number;
  driftBps: number;
  acted: boolean;
  reason: string;
  receipt?: Receipt;
}

export class RebalancingAgent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly walletClient: any;
  private readonly hotStorage: StorageAdapter;
  private readonly receiptStorage: StorageAdapter;
  private readonly signer: SignerAdapter;
  private readonly cfg: AgentConfig;
  private readonly agentName = "rebalancer-1";
  private readonly ensMirror: EnsReceiptMirror | undefined;
  private stopRequested = false;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    const account = privateKeyToAccount(cfg.privateKey);
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(cfg.base.rpc),
    });
    this.walletClient = createWalletClient({
      chain: baseSepolia,
      transport: http(cfg.base.rpc),
      account,
    });
    this.hotStorage = new MemoryStorageAdapter();
    this.receiptStorage = cfg.zeroG
      ? new ZeroGStorageAdapter({
          evmRpc: cfg.zeroG.chainRpc,
          indexerRpc: cfg.zeroG.indexerRpc,
          privateKey: cfg.zeroG.privateKey,
        })
      : new MemoryStorageAdapter();
    this.signer = new ViemSigner({ privateKey: cfg.privateKey });

    if (cfg.ens) {
      const ensAccount = privateKeyToAccount(cfg.ens.privateKey);
      const ensWallet = createWalletClient({
        chain: sepolia,
        transport: http(cfg.ens.sepoliaRpc),
        account: ensAccount,
      });
      this.ensMirror = new EnsReceiptMirror({
        walletClient: ensWallet,
        resolver: cfg.ens.resolver,
        subname: cfg.ens.parentName,
      });
    }
  }

  async tick(oracleRatePerEth: bigint): Promise<AgentTickResult> {
    const account = this.walletClient.account!;
    const snap = await readPortfolio(
      this.publicClient,
      account.address,
      this.cfg.pairs.weth,
      this.cfg.pairs.usdc,
    );

    log(`portfolio: ${describePortfolio(snap)}`);

    const decision = await decideRebalance(
      snap,
      this.cfg.targetEthRatioBps,
      this.cfg.driftThresholdBps,
      { ethUsdcPerEth: async () => oracleRatePerEth },
    );
    log(
      `decision: ${decision.reason} (observed ${decision.observedRatioBps}bps vs target ${decision.targetRatioBps}bps)`,
    );

    if (!decision.shouldSwap) {
      return {
        observedRatioBps: decision.observedRatioBps,
        driftBps: decision.driftBps,
        acted: false,
        reason: decision.reason,
      };
    }

    const { action, getLastReceipt } = buildRebalanceAction({
      publicClient: this.publicClient,
      walletClient: this.walletClient,
      agentAddress: account.address,
      storage: this.hotStorage,
      signer: this.signer,
      receiptStorage: this.receiptStorage,
      zerogChainId: this.cfg.zerogChainId,
      weth: this.cfg.pairs.weth,
      usdc: this.cfg.pairs.usdc,
      universalRouter: this.cfg.v4.universalRouter,
      dryRun: this.cfg.dryRun,
      agentName: this.agentName,
      ...(this.ensMirror
        ? {
            onReceipt: async (r) => {
              try {
                await this.ensMirror!.onReceipt(r);
                log(`mirrored receipt to ENS: ${this.cfg.ens?.parentName}`);
              } catch (err) {
                log(
                  `ENS mirror failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            },
          }
        : {}),
    });

    const args: RebalanceArgs = {
      decision,
      deadline: Math.floor(Date.now() / 1000) + 600,
    };

    try {
      await action(args);
      const r = getLastReceipt();
      log(`receipt: ${r?.callId ?? "<none>"}`);
      return {
        observedRatioBps: decision.observedRatioBps,
        driftBps: decision.driftBps,
        acted: true,
        reason: decision.reason,
        ...(r ? { receipt: r } : {}),
      };
    } catch (err) {
      const r = getLastReceipt();
      const msg = err instanceof Error ? err.message : String(err);
      log(`rebalance threw: ${msg}`);
      return {
        observedRatioBps: decision.observedRatioBps,
        driftBps: decision.driftBps,
        acted: false,
        reason: msg,
        ...(r ? { receipt: r } : {}),
      };
    }
  }

  async run(oracleRate: () => Promise<bigint>): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.tick(await oracleRate());
      } catch (err) {
        log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(this.cfg.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopRequested = true;
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export { loadConfig };
