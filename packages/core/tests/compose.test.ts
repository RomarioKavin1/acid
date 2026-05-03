import { describe, it, expect } from "vitest";
import { MemoryStorageAdapter, MemorySigner } from "@openacid/adapter-memory";
import {
  receipted,
  invariant,
  idempotent,
  saga,
  inspectComposition,
  checkComposition,
  getCompositionLabel,
} from "@openacid/acid";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe("composition introspection", () => {
  it("inspects the recommended outer-to-inner chain", () => {
    const storage = new MemoryStorageAdapter();
    const signer = new MemorySigner(ANVIL_KEY);
    const fn = receipted({
      storage,
      signer,
      chain: { chainId: 16602 },
    })(
      invariant<unknown, Record<string, unknown>>({
        post: async () => true,
      })(
        idempotent<unknown, Record<string, unknown>>({
          key: () => "k",
          storage,
        })(
          saga<unknown>({
            steps: [{ id: "x", do: async () => 1 }],
            storage,
          }),
        ),
      ),
    );

    expect(inspectComposition(fn)).toEqual([
      "receipted",
      "invariant",
      "idempotent",
      "saga",
    ]);
    expect(checkComposition(fn)).toEqual([]);
  });

  it("warns when idempotent wraps invariant (inverted)", () => {
    const storage = new MemoryStorageAdapter();
    const fn = idempotent<number, number>({
      key: (n) => `${n}`,
      storage,
    })(
      invariant<number, number>({
        post: async () => true,
      })(async (n: number) => n),
    );

    const warnings = checkComposition(fn);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.message).toMatch(/idempotent.*outside.*invariant|invariant.*outside.*idempotent/i);
  });

  it("warns when the same primitive is nested twice", () => {
    const storage = new MemoryStorageAdapter();
    const fn = idempotent<number, number>({
      key: (n) => `${n}`,
      storage,
      namespace: "outer",
    })(
      idempotent<number, number>({
        key: (n) => `${n}`,
        storage,
        namespace: "inner",
      })(async (n: number) => n),
    );
    const warnings = checkComposition(fn);
    expect(warnings.some((w) => /idempotent.*idempotent/i.test(w.message))).toBe(true);
  });

  it("returns empty composition for un-tagged functions", () => {
    const fn = (n: number) => n;
    expect(inspectComposition(fn)).toEqual([]);
    expect(checkComposition(fn)).toEqual([]);
  });

  it("getCompositionLabel renders the chain with arrows", () => {
    const storage = new MemoryStorageAdapter();
    const fn = idempotent<number, number>({
      key: (n) => `${n}`,
      storage,
    })(
      saga<number>({
        steps: [{ id: "x", do: async () => 1 }],
        storage,
      }),
    );
    expect(getCompositionLabel(fn)).toBe("idempotent→saga");
  });

  it("getCompositionLabel falls back to 'user' for plain fns", () => {
    expect(getCompositionLabel((n: number) => n)).toBe("user");
  });
});
