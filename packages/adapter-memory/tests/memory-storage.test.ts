import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorageAdapter } from "../src/memory-storage.js";

describe("MemoryStorageAdapter", () => {
  let store: MemoryStorageAdapter;

  beforeEach(() => {
    store = new MemoryStorageAdapter();
  });

  describe("get / put / delete", () => {
    it("returns null for a missing key", async () => {
      expect(await store.get("missing")).toBeNull();
    });

    it("round-trips a value", async () => {
      await store.put("k", { hello: "world" });
      expect(await store.get("k")).toEqual({ hello: "world" });
    });

    it("read-your-writes consistency: latest put wins", async () => {
      await store.put("k", "first");
      await store.put("k", "second");
      expect(await store.get("k")).toBe("second");
    });

    it("delete removes the value", async () => {
      await store.put("k", "v");
      await store.delete("k");
      expect(await store.get("k")).toBeNull();
    });
  });

  describe("ttl", () => {
    it("returns the value before ttl expires", async () => {
      let now = 1_000_000;
      const s = new MemoryStorageAdapter({ now: () => now });
      await s.put("k", "v", { ttl: 60 });
      now += 30_000;
      expect(await s.get("k")).toBe("v");
    });

    it("returns null after ttl expires", async () => {
      let now = 1_000_000;
      const s = new MemoryStorageAdapter({ now: () => now });
      await s.put("k", "v", { ttl: 60 });
      now += 61_000;
      expect(await s.get("k")).toBeNull();
    });

    it("ttl-expired entries are cleaned up on read", async () => {
      let now = 1_000_000;
      const s = new MemoryStorageAdapter({ now: () => now });
      await s.put("k", "v", { ttl: 1 });
      now += 5_000;
      await s.get("k");
      now -= 10_000;
      expect(await s.get("k")).toBeNull();
    });
  });

  describe("cas", () => {
    it("swaps when expected matches null on missing key", async () => {
      const ok = await store.cas("k", null, "first");
      expect(ok).toBe(true);
      expect(await store.get("k")).toBe("first");
    });

    it("rejects when expected is null but key is set", async () => {
      await store.put("k", "v");
      const ok = await store.cas("k", null, "next");
      expect(ok).toBe(false);
      expect(await store.get("k")).toBe("v");
    });

    it("swaps when expected matches current", async () => {
      await store.put("k", "first");
      const ok = await store.cas("k", "first", "second");
      expect(ok).toBe(true);
      expect(await store.get("k")).toBe("second");
    });

    it("rejects when expected differs from current", async () => {
      await store.put("k", "actual");
      const ok = await store.cas("k", "wrong", "next");
      expect(ok).toBe(false);
      expect(await store.get("k")).toBe("actual");
    });

    it("compares objects by structural equality", async () => {
      await store.put("k", { a: 1, b: { c: 2 } });
      const ok = await store.cas("k", { a: 1, b: { c: 2 } }, { a: 9 });
      expect(ok).toBe(true);
      expect(await store.get("k")).toEqual({ a: 9 });
    });

    it("compares Uint8Arrays by byte content", async () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3]);
      await store.put("k", a);
      const ok = await store.cas("k", b, new Uint8Array([4]));
      expect(ok).toBe(true);
    });

    it("two concurrent cas attempts: exactly one wins", async () => {
      await store.put("k", "before");
      const [r1, r2] = await Promise.all([
        store.cas("k", "before", "winner-A"),
        store.cas("k", "before", "winner-B"),
      ]);
      expect(r1 !== r2).toBe(true);
      const final = await store.get<string>("k");
      expect(final === "winner-A" || final === "winner-B").toBe(true);
    });
  });
});
