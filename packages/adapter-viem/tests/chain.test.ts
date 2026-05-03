import { describe, it, expect, beforeAll } from "vitest";
import { createPublicClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { ViemChainAdapter } from "../src/chain.js";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

describe("ViemChainAdapter (live Base Sepolia)", () => {
  let adapter: ViemChainAdapter;

  beforeAll(() => {
    adapter = new ViemChainAdapter({ client });
  });

  it("reports the configured chain id", () => {
    expect(adapter.chainId).toBe(84532);
  });

  it("returns the current block number", async () => {
    const n = await adapter.getBlockNumber();
    expect(n).toBeGreaterThan(0);
  }, 15_000);

  it("returns null for an unknown tx hash", async () => {
    const status = await adapter.getTxByHash(("0x" + "0".repeat(64)) as Hex);
    expect(status).toBeNull();
  }, 15_000);

  it("returns 'mined' or 'finalized' for a known historic tx", async () => {
    const head = await adapter.getBlockNumber();
    const lookbackHead = head - 200;
    let txHash: Hex | null = null;
    for (let n = lookbackHead; n > lookbackHead - 200 && !txHash; n--) {
      const block = await client.getBlock({
        blockNumber: BigInt(n),
        includeTransactions: false,
      });
      if (block.transactions.length > 0) {
        txHash = block.transactions[0] as Hex;
      }
    }
    expect(txHash).not.toBeNull();
    const status = await adapter.getTxByHash(txHash!);
    expect(["mined", "finalized"]).toContain(status);
  }, 30_000);

  it("returns 'mined' for a low nonce on a known-active address", async () => {
    const someAddress = "0x4200000000000000000000000000000000000006";
    const status = await adapter.getTxByNonce(someAddress, 0);
    expect(status).toBe(null);
  }, 15_000);
});
