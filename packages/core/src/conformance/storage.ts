import type { StorageAdapter } from "../adapters/storage.js";

export interface ConformanceCase {
  name: string;
  needsClock?: boolean;
  run: (
    factory: (now?: () => number) => StorageAdapter | Promise<StorageAdapter>,
  ) => Promise<void>;
}

export const storageConformanceCases: ConformanceCase[] = [
  {
    name: "get returns null for a missing key",
    run: async (factory) => {
      const a = await factory();
      const v = await a.get("missing");
      assertEqual(v, null, "expected null for missing key");
    },
  },
  {
    name: "round-trips an object value",
    run: async (factory) => {
      const a = await factory();
      const v = { hello: "world", n: 1 };
      await a.put("k", v);
      assertEqual(await a.get("k"), v, "round-trip mismatch");
    },
  },
  {
    name: "read-your-writes — latest put wins",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "first");
      await a.put("k", "second");
      assertEqual(await a.get("k"), "second");
    },
  },
  {
    name: "delete removes the key",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "v");
      await a.delete("k");
      assertEqual(await a.get("k"), null);
    },
  },
  {
    name: "ttl: value is present before expiry",
    needsClock: true,
    run: async (factory) => {
      let now = 1_000_000;
      const a = await factory(() => now);
      await a.put("k", "v", { ttl: 60 });
      now += 30_000;
      assertEqual(await a.get("k"), "v");
    },
  },
  {
    name: "ttl: value is null after expiry",
    needsClock: true,
    run: async (factory) => {
      let now = 1_000_000;
      const a = await factory(() => now);
      await a.put("k", "v", { ttl: 60 });
      now += 61_000;
      assertEqual(await a.get("k"), null);
    },
  },
  {
    name: "cas: succeeds when expected matches null on missing key",
    run: async (factory) => {
      const a = await factory();
      const ok = await a.cas("k", null, "first");
      assertEqual(ok, true);
      assertEqual(await a.get("k"), "first");
    },
  },
  {
    name: "cas: rejects when expected is null but key is set",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "v");
      const ok = await a.cas("k", null, "next");
      assertEqual(ok, false);
      assertEqual(await a.get("k"), "v");
    },
  },
  {
    name: "cas: succeeds when expected matches current value",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "first");
      const ok = await a.cas("k", "first", "second");
      assertEqual(ok, true);
      assertEqual(await a.get("k"), "second");
    },
  },
  {
    name: "cas: rejects when expected differs from current",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "actual");
      const ok = await a.cas("k", "wrong", "next");
      assertEqual(ok, false);
      assertEqual(await a.get("k"), "actual");
    },
  },
  {
    name: "cas: structural equality across nested objects",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", { a: 1, b: { c: 2 } });
      const ok = await a.cas("k", { a: 1, b: { c: 2 } }, { a: 9 });
      assertEqual(ok, true);
      assertEqual(await a.get("k"), { a: 9 });
    },
  },
  {
    name: "cas: two concurrent attempts — exactly one wins",
    run: async (factory) => {
      const a = await factory();
      await a.put("k", "before");
      const [r1, r2] = await Promise.all([
        a.cas("k", "before", "winner-A"),
        a.cas("k", "before", "winner-B"),
      ]);
      if (r1 === r2) {
        throw new Error(
          `expected exactly one cas to win; both returned ${r1}`,
        );
      }
      const final = await a.get<string>("k");
      if (final !== "winner-A" && final !== "winner-B") {
        throw new Error(`unexpected final value: ${final}`);
      }
    },
  },
];

function assertEqual(actual: unknown, expected: unknown, msg = ""): void {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (!eq) {
    throw new Error(
      `${msg ? msg + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
