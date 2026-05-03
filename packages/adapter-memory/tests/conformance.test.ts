import { describe, it } from "vitest";
import { storageConformanceCases } from "@openacid/acid";
import { MemoryStorageAdapter } from "../src/memory-storage.js";

describe("MemoryStorageAdapter — StorageAdapter conformance", () => {
  for (const c of storageConformanceCases) {
    it(c.name, async () => {
      await c.run((now) => new MemoryStorageAdapter(now ? { now } : undefined));
    });
  }
});
