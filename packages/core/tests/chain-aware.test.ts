import { describe, it, expect, vi } from "vitest";
import { MemoryStorageAdapter } from "@openacid/adapter-memory";
import {
  chainAwareBroadcast,
  inspectInFlight,
  type BroadcastRecord,
} from "@openacid/acid";
import type { ChainAdapter, TxStatus } from "@openacid/acid";

class FakeChain implements ChainAdapter {
  chainId = 84532;
  hashes = new Map<string, TxStatus>();
  blockNumber = 100;
  finalityCalls: string[] = [];

  async getTxByHash(hash: string) {
    return this.hashes.get(hash) ?? null;
  }
  async getTxByNonce() {
    return null;
  }
  async waitForFinality(hash: string, _confirmations: number) {
    this.finalityCalls.push(hash);
    const cur = this.hashes.get(hash);
    if (cur === "failed" || cur === "replaced") return cur;
    this.hashes.set(hash, "finalized");
    return "finalized" as TxStatus;
  }
  async getBlockNumber() {
    return this.blockNumber++;
  }
}

describe("chainAwareBroadcast", () => {
  it("broadcasts when no prior record exists", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    const broadcast = vi.fn(async () => "0xnew");
    chain.hashes.set("0xnew", "pending");

    const out = await chainAwareBroadcast(
      { storage, chain, trackKey: "tx:1" },
      broadcast,
    );
    expect(broadcast).toHaveBeenCalledOnce();
    expect(out.reused).toBe(false);
    expect(out.hash).toBe("0xnew");
    expect(out.status).toBe("finalized");

    const record = await storage.get<BroadcastRecord>("tx:1");
    expect(record?.hash).toBe("0xnew");
  });

  it("reuses a finalized hash without re-broadcasting", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    chain.hashes.set("0xprior", "finalized");
    await storage.put<BroadcastRecord>("tx:1", {
      hash: "0xprior",
      broadcastAt: 1,
    });

    const broadcast = vi.fn(async () => "0xnew");
    const out = await chainAwareBroadcast(
      { storage, chain, trackKey: "tx:1" },
      broadcast,
    );
    expect(broadcast).not.toHaveBeenCalled();
    expect(out.reused).toBe(true);
    expect(out.hash).toBe("0xprior");
    expect(out.status).toBe("finalized");
  });

  it("waits for finality on a pending hash without re-broadcasting", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    chain.hashes.set("0xpending", "pending");
    await storage.put<BroadcastRecord>("tx:1", {
      hash: "0xpending",
      broadcastAt: 1,
    });

    const broadcast = vi.fn(async () => "0xnew");
    const out = await chainAwareBroadcast(
      { storage, chain, trackKey: "tx:1" },
      broadcast,
    );
    expect(broadcast).not.toHaveBeenCalled();
    expect(out.reused).toBe(true);
    expect(out.hash).toBe("0xpending");
    expect(chain.finalityCalls).toContain("0xpending");
  });

  it("re-broadcasts when the prior tx was replaced", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    chain.hashes.set("0xdead", "replaced");
    await storage.put<BroadcastRecord>("tx:1", {
      hash: "0xdead",
      broadcastAt: 1,
    });
    chain.hashes.set("0xnew", "pending");

    const broadcast = vi.fn(async () => "0xnew");
    const out = await chainAwareBroadcast(
      { storage, chain, trackKey: "tx:1" },
      broadcast,
    );
    expect(broadcast).toHaveBeenCalledOnce();
    expect(out.hash).toBe("0xnew");
  });

  it("inspectInFlight reports the tracked status", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    chain.hashes.set("0xpending", "pending");
    await storage.put<BroadcastRecord>("tx:1", {
      hash: "0xpending",
      broadcastAt: 1,
    });

    const r = await inspectInFlight({ storage, chain, trackKey: "tx:1" });
    expect(r).toEqual({ hash: "0xpending", status: "pending" });
  });

  it("inspectInFlight returns null when nothing tracked", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    expect(
      await inspectInFlight({ storage, chain, trackKey: "tx:none" }),
    ).toBeNull();
  });
});

describe("kill -9 simulation: process restarts mid-broadcast", () => {
  it("first 'process' broadcasts and dies; second 'process' picks up the same hash and finalizes", async () => {
    const storage = new MemoryStorageAdapter();
    const chain = new FakeChain();
    let firstHash: string | null = null;

    const broadcastA = async () => {
      const hash = "0xtxA";
      chain.hashes.set(hash, "pending");
      firstHash = hash;
      throw new Error("simulate kill -9 right after broadcast");
    };

    await expect(
      chainAwareBroadcast(
        { storage, chain, trackKey: "rebalance:1:tx" },
        broadcastA,
      ),
    ).rejects.toThrow();
    expect(firstHash).toBe("0xtxA");

    await storage.put("rebalance:1:tx", {
      hash: firstHash,
      broadcastAt: Date.now(),
    });

    const broadcastB = vi.fn(async () => "0xnewer");
    const out = await chainAwareBroadcast(
      { storage, chain, trackKey: "rebalance:1:tx" },
      broadcastB,
    );

    expect(broadcastB).not.toHaveBeenCalled();
    expect(out.hash).toBe("0xtxA");
    expect(out.status).toBe("finalized");
    expect(out.reused).toBe(true);
  });
});
