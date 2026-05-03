import type { StorageAdapter } from "./adapters/storage.js";
import type { Wrapper } from "./types.js";
import {
  IdempotentInFlightError,
  IdempotentInFlightLostError,
  NonDeterministicKeyError,
} from "./errors.js";
import { tagWrapper } from "./compose.js";

export type IdempotentInFlightMode = "block" | "return-pending" | "reject";

export interface IdempotentOpts<A, R> {
  key: (args: A) => string;
  storage: StorageAdapter;
  inFlight?: IdempotentInFlightMode;
  ttl?: number;
  strictKeys?: boolean;
  pollIntervalMs?: number;
  blockTimeoutMs?: number;
  namespace?: string;
}

interface InFlightSlot {
  status: "in-flight";
  startedAt: number;
  owner: string;
}

interface CompletedSlot<R> {
  status: "completed";
  result: R;
  completedAt: number;
}

type Slot<R> = InFlightSlot | CompletedSlot<R>;

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_POLL_MS = 50;
const DEFAULT_BLOCK_TIMEOUT_MS = 30_000;

export function idempotent<A, R>(opts: IdempotentOpts<A, R>): Wrapper<A, R> {
  const {
    key: deriveKey,
    storage,
    inFlight = "block",
    ttl = DEFAULT_TTL_SECONDS,
    strictKeys = true,
    pollIntervalMs = DEFAULT_POLL_MS,
    blockTimeoutMs = DEFAULT_BLOCK_TIMEOUT_MS,
    namespace = "idempotent",
  } = opts;

  return (fn) => {
    const wrapped = async (args: A): Promise<R> => {
      const userKey = deriveKey(args);

      if (strictKeys) {
        const second = deriveKey(args);
        if (userKey !== second) {
          throw new NonDeterministicKeyError([userKey, second]);
        }
      }

      const storageKey = `${namespace}:${userKey}`;

      const existing = await storage.get<Slot<R>>(storageKey);
      if (existing?.status === "completed") return existing.result;
      if (existing?.status === "in-flight") {
        return await handleInFlight<R>(
          storage,
          storageKey,
          userKey,
          inFlight,
          pollIntervalMs,
          blockTimeoutMs,
        );
      }

      const owner = randomOwner();
      const claim: InFlightSlot = {
        status: "in-flight",
        startedAt: Date.now(),
        owner,
      };
      const won = await storage.cas<Slot<R>>(storageKey, null, claim);
      if (!won) {
        const after = await storage.get<Slot<R>>(storageKey);
        if (after?.status === "completed") return after.result;
        return await handleInFlight<R>(
          storage,
          storageKey,
          userKey,
          inFlight,
          pollIntervalMs,
          blockTimeoutMs,
        );
      }

      let result: R;
      try {
        result = await fn(args);
      } catch (err) {
        const release = await storage.cas<Slot<R>>(
          storageKey,
          claim,
          null as never,
        );
        if (!release) await storage.delete(storageKey);
        throw err;
      }

      const completed: CompletedSlot<R> = {
        status: "completed",
        result,
        completedAt: Date.now(),
      };
      await storage.put<Slot<R>>(storageKey, completed, { ttl });
      return result;
    };
    return tagWrapper(wrapped, "idempotent", fn);
  };
}

async function handleInFlight<R>(
  storage: StorageAdapter,
  storageKey: string,
  userKey: string,
  mode: IdempotentInFlightMode,
  pollIntervalMs: number,
  blockTimeoutMs: number,
): Promise<R> {
  if (mode === "reject" || mode === "return-pending") {
    throw new IdempotentInFlightError(userKey);
  }

  const deadline = Date.now() + blockTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const slot = await storage.get<Slot<R>>(storageKey);
    if (slot?.status === "completed") return slot.result;
    if (slot === null) throw new IdempotentInFlightLostError(userKey);
  }
  throw new IdempotentInFlightError(userKey);
}

function randomOwner(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
