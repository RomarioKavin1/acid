import {
  serializeSignature,
  toHex,
  type Hex,
} from "viem";
import { sign } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";
import type { SignerAdapter } from "@openacid/acid";

export class MemorySigner implements SignerAdapter {
  readonly identity: string;
  private readonly privateKey: Hex;
  private readonly address: Hex;

  constructor(privateKey: Hex) {
    this.privateKey = privateKey;
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.identity = account.address;
  }

  async sign(message: Uint8Array): Promise<string> {
    const sig = await sign({
      hash: toHex(message) as Hex,
      privateKey: this.privateKey,
    });
    return serializeSignature(sig);
  }

  async publicKey(): Promise<string> {
    return this.address;
  }
}
