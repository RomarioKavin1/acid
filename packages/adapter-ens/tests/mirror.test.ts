import { describe, it, expect, vi } from "vitest";
import { namehash } from "viem";
import { EnsReceiptMirror } from "../src/mirror.js";
import type { Receipt } from "@openacid/acid";

const RESOLVER = "0x000000000000000000000000000000000000beef" as const;

const mockWallet = (writeContract = vi.fn(async () => "0xtxhash")) => ({
  writeContract,
  account: { address: "0xCAFE000000000000000000000000000000000000" },
  chain: { id: 11155111 },
});

const sampleReceipt: Receipt = {
  callId: "0xfeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeee",
  prevReceipt: null,
  fnName: "rebalance",
  inputHash: "0xdead",
  outputHash: "0xbeef",
  txRefs: ["0xabc"],
  startedAt: 1,
  endedAt: 2,
  retries: 0,
  signature: "0xff" + "11".repeat(64),
  cid: "0xfeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeeefeee",
};

describe("EnsReceiptMirror", () => {
  it("computes the correct namehash for the subname", () => {
    const wallet = mockWallet();
    const mirror = new EnsReceiptMirror({
      walletClient: wallet,
      resolver: RESOLVER,
      subname: "alice.openacid.eth",
    });
    const desc = mirror.describe();
    expect(desc.node).toBe(namehash("alice.openacid.eth"));
    expect(desc.subname).toBe("alice.openacid.eth");
  });

  it("writes receipt.latest, receipt.head, and agent.signer on first call", async () => {
    const writeContract = vi.fn(async () => "0xhash");
    const wallet = mockWallet(writeContract);
    const mirror = new EnsReceiptMirror({
      walletClient: wallet,
      resolver: RESOLVER,
      subname: "alice.openacid.eth",
    });

    await mirror.onReceipt(sampleReceipt);
    expect(writeContract).toHaveBeenCalledTimes(3);
    const calls = writeContract.mock.calls.map((c) => (c[0] as { args: unknown[] }).args[1]);
    expect(calls).toEqual(["receipt.latest", "receipt.head", "agent.signer"]);
  });

  it("only publishes agent.signer once across multiple receipts", async () => {
    const writeContract = vi.fn(async () => "0xhash");
    const wallet = mockWallet(writeContract);
    const mirror = new EnsReceiptMirror({
      walletClient: wallet,
      resolver: RESOLVER,
      subname: "alice.openacid.eth",
    });

    await mirror.onReceipt(sampleReceipt);
    await mirror.onReceipt(sampleReceipt);
    await mirror.onReceipt(sampleReceipt);

    const keysWritten = writeContract.mock.calls.map(
      (c) => (c[0] as { args: unknown[] }).args[1] as string,
    );
    const signerCalls = keysWritten.filter((k) => k === "agent.signer");
    expect(signerCalls.length).toBe(1);
  });

  it("supports custom record key names", async () => {
    const writeContract = vi.fn(async () => "0xhash");
    const wallet = mockWallet(writeContract);
    const mirror = new EnsReceiptMirror({
      walletClient: wallet,
      resolver: RESOLVER,
      subname: "alice.openacid.eth",
      keys: {
        latest: "audit.latest",
        head: "audit.head",
        signer: "audit.signer",
      },
    });

    await mirror.onReceipt(sampleReceipt);
    const keysWritten = writeContract.mock.calls.map(
      (c) => (c[0] as { args: unknown[] }).args[1] as string,
    );
    expect(keysWritten).toEqual(["audit.latest", "audit.head", "audit.signer"]);
  });
});
