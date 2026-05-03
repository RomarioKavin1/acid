import type { StorageAdapter } from "@openacid/acid";

interface Entry {
  value: unknown;
  expiresAt?: number;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? Date.now;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.readSync<T>(key);
  }

  async put<T>(
    key: string,
    value: T,
    opts?: { ttl?: number },
  ): Promise<void> {
    this.writeSync(key, value, opts?.ttl);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cas<T>(key: string, expected: T | null, next: T): Promise<boolean> {
    const current = this.readSync<T>(key);
    if (!deepEqual(current, expected)) return false;
    this.writeSync(key, next);
    return true;
  }

  private readSync<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  private writeSync<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = ttl !== undefined ? this.now() + ttl * 1000 : undefined;
    this.store.set(
      key,
      expiresAt === undefined ? { value } : { value, expiresAt },
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const ak = Object.keys(ar);
  const bk = Object.keys(br);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(br, k)) return false;
    if (!deepEqual(ar[k], br[k])) return false;
  }
  return true;
}
