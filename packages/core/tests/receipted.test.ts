import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  receipted,
  verifyReceipt,
  ReceiptVerificationError,
} from "@openacid/acid";
import type { Receipt } from "@openacid/acid";

const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_KEY_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const CHAIN = { chainId: 16602 };

describe("receipted", () => {
  let storage: MemoryStorageAdapter;
  let signer: MemorySigner;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    signer = new MemorySigner(ANVIL_KEY_0);
  });

  it("produces a signed receipt that verifies against the signer's address", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      fnName: "doThing",
      onReceipt: (r) => {
        captured = r;
      },
    })<{ x: number }, number>(async ({ x }) => x * 2);

    const result = await wrapped({ x: 21 });
    expect(result).toBe(42);
    expect(captured).toBeDefined();
    expect(captured!.fnName).toBe("doThing");
    expect(captured!.signature).toMatch(/^0x[0-9a-f]+$/i);

    expect(
      await verifyReceipt(captured!, signer.identity as `0x${string}`, CHAIN),
    ).toBe(true);
  });

  it("rejects verification against the wrong address", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      onReceipt: (r) => {
        captured = r;
      },
    })<undefined, string>(async () => "ok");

    await wrapped(undefined);
    const wrongSigner = new MemorySigner(ANVIL_KEY_1);
    await expect(
      verifyReceipt(captured!, wrongSigner.identity as `0x${string}`, CHAIN),
    ).rejects.toBeInstanceOf(ReceiptVerificationError);
  });

  it("detects tampered receipts during verification", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      onReceipt: (r) => {
        captured = r;
      },
    })<undefined, string>(async () => "original");

    await wrapped(undefined);
    const tampered: Receipt = {
      ...captured!,
      fnName: "evil",
    };
    await expect(
      verifyReceipt(tampered, signer.identity as `0x${string}`, CHAIN),
    ).rejects.toBeInstanceOf(ReceiptVerificationError);
  });

  it("chains receipts via prevReceiptKey", async () => {
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      prevReceiptKey: "agent-alice",
    })<number, number>(async (n) => n + 1);

    await wrapped(1);
    await wrapped(2);
    const third = receipted({
      storage,
      signer,
      chain: CHAIN,
      prevReceiptKey: "agent-alice",
    })<number, number>(async (n) => n + 1);
    await third(3);

    const head = await storage.get<Receipt>("receipt:head:agent-alice");
    expect(head).not.toBeNull();
    expect(head!.prevReceipt).not.toBeNull();
  });

  it("persists the receipt under by-id and head keys", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      prevReceiptKey: "x",
      onReceipt: (r) => {
        captured = r;
      },
    })<undefined, string>(async () => "ok");

    await wrapped(undefined);
    const byId = await storage.get<Receipt>(`receipt:by-id:${captured!.callId}`);
    const head = await storage.get<Receipt>("receipt:head:x");
    expect(byId).toEqual(captured!);
    expect(head).toEqual(captured!);
  });

  it("emits a receipt even when the wrapped fn throws, then re-throws", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      onReceipt: (r) => {
        captured = r;
      },
    })<undefined, never>(async () => {
      throw new Error("kaboom");
    });

    await expect(wrapped(undefined)).rejects.toThrow("kaboom");
    expect(captured).toBeDefined();
    expect(
      await verifyReceipt(captured!, signer.identity as `0x${string}`, CHAIN),
    ).toBe(true);
  });

  it("collects txRefs via the configured callback", async () => {
    let captured: Receipt | undefined;
    const wrapped = receipted({
      storage,
      signer,
      chain: CHAIN,
      collectTxRefs: (r) => (r as { txs: string[] }).txs,
      onReceipt: (r) => {
        captured = r;
      },
    })<undefined, { txs: string[] }>(async () => ({
      txs: ["0xaaa", "0xbbb"],
    }));

    await wrapped(undefined);
    expect(captured!.txRefs).toEqual(["0xaaa", "0xbbb"]);
    expect(
      await verifyReceipt(captured!, signer.identity as `0x${string}`, CHAIN),
    ).toBe(true);
  });
});
