import { describe, it, expect } from "vitest";
import { recoverAddress, toBytes, type Hex } from "viem";
import { ViemSigner } from "../src/signer.js";

const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe("ViemSigner", () => {
  it("identity matches the address derived from the private key", () => {
    const s = new ViemSigner({ privateKey: ANVIL_KEY_0 });
    expect(s.identity).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("signs a 32-byte hash that recovers to the signer's address", async () => {
    const s = new ViemSigner({ privateKey: ANVIL_KEY_0 });
    const hash = ("0x" + "11".repeat(32)) as Hex;
    const sig = (await s.sign(toBytes(hash))) as Hex;
    const recovered = await recoverAddress({ hash, signature: sig });
    expect(recovered.toLowerCase()).toBe(s.identity.toLowerCase());
  });

  it("publicKey() returns the address", async () => {
    const s = new ViemSigner({ privateKey: ANVIL_KEY_0 });
    expect(await s.publicKey()).toBe(s.identity);
  });
});
