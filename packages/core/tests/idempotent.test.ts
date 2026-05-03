import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryStorageAdapter } from "@openacid/adapter-memory";
import {
  idempotent,
  IdempotentInFlightError,
  NonDeterministicKeyError,
} from "@openacid/acid";

describe("idempotent", () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  it("executes the wrapped fn on first call", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const wrapped = idempotent({
      key: (n: number) => `n:${n}`,
      storage,
    })(fn);

    expect(await wrapped(7)).toBe(14);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns cached result on duplicate call without re-invoking fn", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const wrapped = idempotent({
      key: (n: number) => `n:${n}`,
      storage,
    })(fn);

    expect(await wrapped(7)).toBe(14);
    expect(await wrapped(7)).toBe(14);
    expect(await wrapped(7)).toBe(14);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats different keys as independent executions", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const wrapped = idempotent({
      key: (n: number) => `n:${n}`,
      storage,
    })(fn);

    expect(await wrapped(7)).toBe(14);
    expect(await wrapped(8)).toBe(16);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects non-deterministic keys (strict mode default)", async () => {
    const wrapped = idempotent({
      key: () => Math.random().toString(),
      storage,
    })(async () => 1);

    await expect(wrapped(undefined as never)).rejects.toBeInstanceOf(
      NonDeterministicKeyError,
    );
  });

  it("permits non-deterministic keys when strictKeys is false", async () => {
    let n = 0;
    const wrapped = idempotent({
      key: () => `key-${n++}`,
      storage,
      strictKeys: false,
    })(async () => "ok");

    await expect(wrapped(undefined as never)).resolves.toBe("ok");
  });

  it("blocks concurrent calls and returns the same result (inFlight: 'block')", async () => {
    let resolveInner!: (value: string) => void;
    const inner = new Promise<string>((res) => {
      resolveInner = res;
    });
    const fn = vi.fn(async () => inner);

    const wrapped = idempotent({
      key: () => "shared",
      storage,
      pollIntervalMs: 5,
    })(fn);

    const a = wrapped(undefined as never);
    const b = wrapped(undefined as never);
    await new Promise((r) => setTimeout(r, 20));
    resolveInner("done");

    expect(await a).toBe("done");
    expect(await b).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent calls when inFlight is 'reject'", async () => {
    let resolveInner!: () => void;
    const fn = vi.fn(
      async () =>
        new Promise<string>((res) => {
          resolveInner = () => res("done");
        }),
    );

    const wrapped = idempotent({
      key: () => "shared",
      storage,
      inFlight: "reject",
    })(fn);

    const first = wrapped(undefined as never);
    await new Promise((r) => setTimeout(r, 5));
    await expect(wrapped(undefined as never)).rejects.toBeInstanceOf(
      IdempotentInFlightError,
    );
    resolveInner();
    await first;
  });

  it("releases the in-flight marker on fn error so retries are possible", async () => {
    const fn = vi
      .fn<(n: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(42);

    const wrapped = idempotent({
      key: () => "k",
      storage,
    })(fn);

    await expect(wrapped(1)).rejects.toThrow("boom");
    expect(await wrapped(1)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-executes after the cache TTL expires", async () => {
    let now = 1_000_000;
    const s = new MemoryStorageAdapter({ now: () => now });
    const fn = vi.fn(async () => Math.random());
    const wrapped = idempotent({
      key: () => "k",
      storage: s,
      ttl: 1,
    })(fn);

    const first = await wrapped(undefined as never);
    expect(await wrapped(undefined as never)).toBe(first);
    now += 2_000;
    expect(await wrapped(undefined as never)).not.toBe(first);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
