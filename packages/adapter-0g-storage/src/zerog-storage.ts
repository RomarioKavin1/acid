import { Indexer, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import { Wallet, JsonRpcProvider } from "ethers";
import type { StorageAdapter } from "@openacid/acid";
import { writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ZeroGStorageOpts {
  evmRpc: string;
  indexerRpc: string;
  privateKey: string;
  expectedReplica?: number;
  cacheTtlSec?: number;
}

interface Pointer {
  rootHash: string;
  txHash: string;
  uploadedAt: number;
  expiresAt?: number;
}

export class ZeroGStorageAdapter implements StorageAdapter {
  private readonly indexer: Indexer;
  private readonly signer: Wallet;
  private readonly evmRpc: string;
  private readonly expectedReplica: number;

  private readonly hot = new Map<string, { value: unknown; expiresAt?: number }>();
  private readonly pointers = new Map<string, Pointer>();

  constructor(opts: ZeroGStorageOpts) {
    this.evmRpc = opts.evmRpc;
    this.expectedReplica = opts.expectedReplica ?? 1;
    const provider = new JsonRpcProvider(opts.evmRpc);
    this.signer = new Wallet(opts.privateKey, provider);
    this.indexer = new Indexer(opts.indexerRpc);
  }

  async get<T>(key: string): Promise<T | null> {
    const hot = this.hot.get(key);
    if (hot) {
      if (hot.expiresAt !== undefined && hot.expiresAt <= Date.now()) {
        this.hot.delete(key);
      } else {
        return hot.value as T;
      }
    }
    const ptr = this.pointers.get(key);
    if (!ptr) return null;
    return await this.fetchFromBlob<T>(ptr.rootHash);
  }

  async put<T>(
    key: string,
    value: T,
    opts?: { ttl?: number },
  ): Promise<void> {
    const expiresAt =
      opts?.ttl !== undefined ? Date.now() + opts.ttl * 1000 : undefined;
    this.hot.set(
      key,
      expiresAt === undefined ? { value } : { value, expiresAt },
    );

    const json = JSON.stringify(value, bigintReplacer);
    const buf = new TextEncoder().encode(json);
    const { rootHash, txHash } = await this.uploadBuffer(buf);

    const ptr: Pointer = {
      rootHash,
      txHash,
      uploadedAt: Date.now(),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
    this.pointers.set(key, ptr);
  }

  async delete(key: string): Promise<void> {
    this.hot.delete(key);
    this.pointers.delete(key);
  }

  async cas<T>(key: string, expected: T | null, next: T): Promise<boolean> {
    const current = (this.hot.get(key)?.value as T | undefined) ?? null;
    if (!deepEqual(current, expected)) return false;
    await this.put<T>(key, next);
    return true;
  }

  async stream(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<string> {
    const buffers: Uint8Array[] = [];
    let total = 0;
    for await (const c of chunks) {
      buffers.push(c);
      total += c.byteLength;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) {
      merged.set(b, off);
      off += b.byteLength;
    }
    const { rootHash, txHash } = await this.uploadBuffer(merged);
    this.pointers.set(key, {
      rootHash,
      txHash,
      uploadedAt: Date.now(),
    });
    return rootHash;
  }

  pointerFor(key: string): Pointer | undefined {
    return this.pointers.get(key);
  }

  private async uploadBuffer(
    buf: Uint8Array,
  ): Promise<{ rootHash: string; txHash: string }> {
    const dir = await mkdtemp(join(tmpdir(), "openacid-0g-"));
    const path = join(dir, "blob.bin");
    try {
      await writeFile(path, buf);
      const file = await ZgFile.fromFilePath(path);
      try {
        const [out, err] = await this.indexer.upload(
          file,
          this.evmRpc,
          this.signer,
        );
        if (err) throw err;
        const rootHash = "rootHash" in out ? out.rootHash : out.rootHashes[0]!;
        const txHash = "txHash" in out ? out.txHash : out.txHashes[0]!;
        return { rootHash, txHash };
      } finally {
        await file.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async fetchFromBlob<T>(rootHash: string): Promise<T | null> {
    const dir = await mkdtemp(join(tmpdir(), "openacid-0g-dl-"));
    const path = join(dir, "blob.bin");
    try {
      const err = await this.indexer.download(rootHash, path, true);
      if (err) throw err;
      const buf = await readFile(path);
      const json = new TextDecoder().decode(buf);
      return JSON.parse(json, bigintReviver) as T;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `__bigint:${v.toString()}` : v;
}

function bigintReviver(_k: string, v: unknown): unknown {
  if (typeof v === "string" && v.startsWith("__bigint:")) {
    return BigInt(v.slice("__bigint:".length));
  }
  return v;
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
