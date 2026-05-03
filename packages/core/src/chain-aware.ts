import type { StorageAdapter } from "./adapters/storage.js";
import type { ChainAdapter, TxStatus } from "./adapters/chain.js";

export interface BroadcastRecord {
  hash: string;
  nonce?: number;
  broadcastAt: number;
}

export interface ChainAwareBroadcastOpts {
  storage: StorageAdapter;
  chain: ChainAdapter;
  trackKey: string;
  confirmations?: number;
  ttl?: number;
}

export interface BroadcastOutcome {
  hash: string;
  status: TxStatus;
  reused: boolean;
}

export async function chainAwareBroadcast(
  opts: ChainAwareBroadcastOpts,
  broadcastFn: () => Promise<string | { hash: string; nonce?: number }>,
): Promise<BroadcastOutcome> {
  const { storage, chain, trackKey, confirmations = 1, ttl = 86_400 } = opts;

  const tracked = await storage.get<BroadcastRecord>(trackKey);
  if (tracked) {
    const status = await chain.getTxByHash(tracked.hash);
    if (status === "finalized") {
      return { hash: tracked.hash, status, reused: true };
    }
    if (status === "mined" || status === "pending") {
      const final = await chain.waitForFinality(tracked.hash, confirmations);
      return { hash: tracked.hash, status: final, reused: true };
    }
    if (status === "replaced" || status === "failed") {
      await storage.delete(trackKey);
    }
  }

  const result = await broadcastFn();
  const hash = typeof result === "string" ? result : result.hash;
  const nonce = typeof result === "string" ? undefined : result.nonce;

  const record: BroadcastRecord = {
    hash,
    broadcastAt: Date.now(),
    ...(nonce !== undefined ? { nonce } : {}),
  };
  await storage.put(trackKey, record, { ttl });

  const final = await chain.waitForFinality(hash, confirmations);
  return { hash, status: final, reused: false };
}

export interface InspectInFlightOpts {
  storage: StorageAdapter;
  chain: ChainAdapter;
  trackKey: string;
}

export async function inspectInFlight(
  opts: InspectInFlightOpts,
): Promise<{ hash: string; status: TxStatus } | null> {
  const tracked = await opts.storage.get<BroadcastRecord>(opts.trackKey);
  if (!tracked) return null;
  const status = await opts.chain.getTxByHash(tracked.hash);
  return status === null ? null : { hash: tracked.hash, status };
}
