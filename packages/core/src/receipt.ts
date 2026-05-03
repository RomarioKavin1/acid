import {
  hashTypedData,
  keccak256,
  recoverAddress,
  stringToBytes,
  toBytes,
  type Hex,
} from "viem";
import type { Receipt } from "./types.js";
import { ReceiptVerificationError } from "./errors.js";
import { canonicalJson } from "./canonical.js";

export const RECEIPT_DOMAIN_NAME = "OpenACID Receipt";
export const RECEIPT_DOMAIN_VERSION = "1";

export const RECEIPT_TYPES = {
  Receipt: [
    { name: "callId", type: "bytes32" },
    { name: "prevReceipt", type: "bytes32" },
    { name: "fnName", type: "string" },
    { name: "inputHash", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "txRefsHash", type: "bytes32" },
    { name: "startedAt", type: "uint64" },
    { name: "endedAt", type: "uint64" },
    { name: "retries", type: "uint32" },
  ],
} as const;

export interface ReceiptDomain {
  chainId: number;
  verifyingContract?: Hex;
}

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export function buildDomain(domain: ReceiptDomain) {
  return {
    name: RECEIPT_DOMAIN_NAME,
    version: RECEIPT_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract:
      domain.verifyingContract ??
      ("0x0000000000000000000000000000000000000000" as Hex),
  };
}

export function hashCanonical(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(value)));
}

export function hashTxRefs(txRefs: readonly string[]): Hex {
  if (txRefs.length === 0) return ZERO_BYTES32;
  return keccak256(stringToBytes(txRefs.join("|")));
}

export function deriveCallId(input: {
  fnName: string;
  inputHash: Hex;
  startedAt: number;
  retries: number;
  prevReceipt: Hex;
}): Hex {
  return keccak256(
    stringToBytes(
      [
        input.fnName,
        input.inputHash,
        input.startedAt,
        input.retries,
        input.prevReceipt,
      ].join("\n"),
    ),
  );
}

export function receiptDigest(
  domain: ReceiptDomain,
  receipt: Pick<
    Receipt,
    | "callId"
    | "prevReceipt"
    | "fnName"
    | "inputHash"
    | "outputHash"
    | "startedAt"
    | "endedAt"
    | "retries"
  > & { txRefsHash: Hex },
): Hex {
  return hashTypedData({
    domain: buildDomain(domain),
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: {
      callId: receipt.callId as Hex,
      prevReceipt: (receipt.prevReceipt ?? ZERO_BYTES32) as Hex,
      fnName: receipt.fnName,
      inputHash: receipt.inputHash as Hex,
      outputHash: receipt.outputHash as Hex,
      txRefsHash: receipt.txRefsHash,
      startedAt: BigInt(receipt.startedAt),
      endedAt: BigInt(receipt.endedAt),
      retries: receipt.retries,
    },
  });
}

export async function verifyReceipt(
  receipt: Receipt,
  expectedSigner: Hex,
  domain: ReceiptDomain,
): Promise<boolean> {
  const txRefsHash = hashTxRefs(receipt.txRefs);
  const digest = receiptDigest(domain, {
    callId: receipt.callId as Hex,
    prevReceipt: receipt.prevReceipt as Hex | null,
    fnName: receipt.fnName,
    inputHash: receipt.inputHash as Hex,
    outputHash: receipt.outputHash as Hex,
    startedAt: receipt.startedAt,
    endedAt: receipt.endedAt,
    retries: receipt.retries,
    txRefsHash,
  });

  const recovered = await recoverAddress({
    hash: digest,
    signature: receipt.signature as Hex,
  });

  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new ReceiptVerificationError(
      `signature signer ${recovered} does not match expected ${expectedSigner}`,
    );
  }
  return true;
}

export { ZERO_BYTES32 };
export { toBytes };
