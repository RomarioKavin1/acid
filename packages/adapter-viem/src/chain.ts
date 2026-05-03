import type {
  Hex,
  PublicClient,
  Transaction,
  TransactionReceipt,
} from "viem";
import type { ChainAdapter, TxStatus } from "@openacid/acid";

export interface ViemChainAdapterOpts {
  client: PublicClient;
  chainId?: number;
  defaultPollIntervalMs?: number;
  defaultTimeoutMs?: number;
}

export class ViemChainAdapter implements ChainAdapter {
  readonly chainId: number;
  private readonly client: PublicClient;
  private readonly defaultPollMs: number;
  private readonly defaultTimeoutMs: number;

  constructor(opts: ViemChainAdapterOpts) {
    this.client = opts.client;
    this.chainId =
      opts.chainId ?? opts.client.chain?.id ?? 0;
    this.defaultPollMs = opts.defaultPollIntervalMs ?? 2_000;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;
  }

  async getTxByHash(hash: string): Promise<TxStatus | null> {
    let receipt: TransactionReceipt | null = null;
    try {
      receipt = await this.client.getTransactionReceipt({ hash: hash as Hex });
    } catch {
      receipt = null;
    }

    let tx: Transaction | null = null;
    try {
      tx = await this.client.getTransaction({ hash: hash as Hex });
    } catch {
      tx = null;
    }

    if (!receipt && !tx) return null;
    if (!receipt && tx) return "pending";
    if (receipt) {
      if (receipt.status === "reverted") return "failed";
      const finalized = await this.isFinalized(receipt.blockNumber);
      return finalized ? "finalized" : "mined";
    }
    return null;
  }

  async getTxByNonce(
    address: string,
    nonce: number,
  ): Promise<TxStatus | null> {
    const currentNonce = await this.client.getTransactionCount({
      address: address as Hex,
      blockTag: "latest",
    });

    const pendingNonce = await this.client.getTransactionCount({
      address: address as Hex,
      blockTag: "pending",
    });

    if (nonce >= pendingNonce) return null;
    if (nonce >= currentNonce) return "pending";
    return "mined";
  }

  async waitForFinality(
    hash: string,
    confirmations: number,
  ): Promise<TxStatus> {
    const receipt = await this.client.waitForTransactionReceipt({
      hash: hash as Hex,
      confirmations,
      pollingInterval: this.defaultPollMs,
      timeout: this.defaultTimeoutMs,
    });
    if (receipt.status === "reverted") return "failed";
    return "finalized";
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.client.getBlockNumber());
  }

  private async isFinalized(blockNumber: bigint): Promise<boolean> {
    try {
      const finalized = await this.client.getBlock({
        blockTag: "finalized",
      });
      return finalized.number !== null && finalized.number >= blockNumber;
    } catch {
      const head = await this.client.getBlockNumber();
      return head - blockNumber >= 64n;
    }
  }
}
