import { type Hex, toBytes } from "viem";
import type { StorageAdapter } from "./adapters/storage.js";
import type { SignerAdapter } from "./adapters/signer.js";
import type { Receipt, Wrapper } from "./types.js";
import {
  hashCanonical,
  hashTxRefs,
  deriveCallId,
  receiptDigest,
  ZERO_BYTES32,
  type ReceiptDomain,
} from "./receipt.js";

export interface ReceiptedOpts {
  storage: StorageAdapter;
  signer: SignerAdapter;
  chain: ReceiptDomain;
  prevReceiptKey?: string;
  fnName?: string;
  collectTxRefs?: (result: unknown) => string[];
  onReceipt?: (receipt: Receipt) => void | Promise<void>;
  namespace?: string;
}

export function receipted<A, R>(opts: ReceiptedOpts): Wrapper<A, R> {
  const {
    storage,
    signer,
    chain,
    prevReceiptKey,
    fnName = "anonymous",
    collectTxRefs = () => [],
    onReceipt,
    namespace = "receipt",
  } = opts;

  return (fn) => async (args) => {
    const startedAt = Date.now();
    const inputHash = hashCanonical(args);

    const prevReceipt = prevReceiptKey
      ? await loadPrev(storage, namespace, prevReceiptKey)
      : null;
    const prevReceiptId = (prevReceipt?.callId ?? ZERO_BYTES32) as Hex;

    let result: R;
    let thrown: unknown;
    let retries = 0;
    try {
      result = await fn(args);
    } catch (err) {
      thrown = err;
      result = undefined as never;
    }
    const endedAt = Date.now();

    const txRefs = thrown ? [] : collectTxRefs(result);
    const txRefsHash = hashTxRefs(txRefs);
    const outputHash = thrown
      ? hashCanonical({ error: serializeError(thrown) })
      : hashCanonical(result);

    const callId = deriveCallId({
      fnName,
      inputHash,
      startedAt,
      retries,
      prevReceipt: prevReceiptId,
    });

    const digest = receiptDigest(chain, {
      callId,
      prevReceipt: prevReceiptId,
      fnName,
      inputHash,
      outputHash,
      txRefsHash,
      startedAt,
      endedAt,
      retries,
    });

    const signature = (await signer.sign(toBytes(digest))) as Hex;

    const receipt: Receipt = {
      callId,
      prevReceipt: prevReceiptId === ZERO_BYTES32 ? null : prevReceiptId,
      fnName,
      inputHash,
      outputHash,
      txRefs,
      startedAt,
      endedAt,
      retries,
      signature,
      cid: callId,
    };

    await storage.put(`${namespace}:by-id:${callId}`, receipt);
    if (prevReceiptKey) {
      await storage.put(`${namespace}:head:${prevReceiptKey}`, receipt);
    }

    if (onReceipt) await onReceipt(receipt);

    if (thrown) throw thrown;
    return result;
  };
}

async function loadPrev(
  storage: StorageAdapter,
  namespace: string,
  prevReceiptKey: string,
): Promise<Receipt | null> {
  return await storage.get<Receipt>(`${namespace}:head:${prevReceiptKey}`);
}

function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}
