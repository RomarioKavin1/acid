import { namehash, type Hex } from "viem";
import type { Receipt } from "@openacid/acid";

const RESOLVER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export interface EnsReceiptMirrorOpts {
  /** A connected viem wallet client (any chain that hosts the ENS deployment). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: any;
  /** Resolver contract that exposes `setText(node, key, value)`. */
  resolver: Hex;
  /** Subname controlled by the agent, e.g. `alice-bot.openacid.eth`. */
  subname: string;
  /** Optional override for the storage layout used in text records. */
  keys?: {
    latest?: string;
    head?: string;
    signer?: string;
  };
  /** Whether to publish `agent.signer` once on first call. */
  publishSignerOnce?: boolean;
}

/**
 * Updates ENS text records on a per-agent subname every time a receipt is
 * emitted. The library does not own the subname registrar — the user wires
 * up the registration outside this class. Once the subname exists and points
 * at a resolver, this class writes the audit-trail records:
 *
 *  - `receipt.latest`  → CID of the most recent receipt
 *  - `receipt.head`    → CID of the chain head
 *  - `agent.signer`    → public key of the signer (one-time)
 */
export class EnsReceiptMirror {
  private readonly walletClient: EnsReceiptMirrorOpts["walletClient"];
  private readonly resolver: Hex;
  private readonly node: Hex;
  private readonly subname: string;
  private readonly latestKey: string;
  private readonly headKey: string;
  private readonly signerKey: string;
  private readonly publishSignerOnce: boolean;
  private signerPublished = false;

  constructor(opts: EnsReceiptMirrorOpts) {
    this.walletClient = opts.walletClient;
    this.resolver = opts.resolver;
    this.subname = opts.subname;
    this.node = namehash(opts.subname);
    this.latestKey = opts.keys?.latest ?? "receipt.latest";
    this.headKey = opts.keys?.head ?? "receipt.head";
    this.signerKey = opts.keys?.signer ?? "agent.signer";
    this.publishSignerOnce = opts.publishSignerOnce ?? true;
  }

  /** Use as the `onReceipt` callback in `receipted({ ... })`. */
  onReceipt = async (r: Receipt): Promise<void> => {
    await this.setText(this.latestKey, r.cid);
    await this.setText(this.headKey, r.callId);
    if (this.publishSignerOnce && !this.signerPublished) {
      const sig = r.signature.startsWith("0x") ? r.signature : `0x${r.signature}`;
      await this.setText(this.signerKey, sig);
      this.signerPublished = true;
    }
  };

  async setText(key: string, value: string): Promise<Hex> {
    const hash = (await this.walletClient.writeContract({
      address: this.resolver,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [this.node, key, value],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    })) as Hex;
    return hash;
  }

  describe(): { subname: string; node: Hex; resolver: Hex } {
    return { subname: this.subname, node: this.node, resolver: this.resolver };
  }
}
