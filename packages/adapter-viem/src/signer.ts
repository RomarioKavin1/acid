import {
  serializeSignature,
  toHex,
  type Hex,
  type LocalAccount,
} from "viem";
import { sign } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";
import type { SignerAdapter } from "@openacid/acid";

export interface ViemSignerOpts {
  privateKey: Hex;
}

export class ViemSigner implements SignerAdapter {
  readonly identity: string;
  private readonly account: LocalAccount;
  private readonly privateKey: Hex;

  constructor(opts: ViemSignerOpts) {
    this.privateKey = opts.privateKey;
    this.account = privateKeyToAccount(opts.privateKey);
    this.identity = this.account.address;
  }

  async sign(message: Uint8Array): Promise<string> {
    const sig = await sign({
      hash: toHex(message) as Hex,
      privateKey: this.privateKey,
    });
    return serializeSignature(sig);
  }

  async publicKey(): Promise<string> {
    return this.account.address;
  }
}
