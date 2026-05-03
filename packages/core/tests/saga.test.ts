import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryStorageAdapter } from "@openacid/adapter-memory";
import { saga, SagaStepError } from "@openacid/acid";
import type { SagaContext } from "@openacid/acid";

describe("saga", () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  it("returns empty results for an empty step list", async () => {
    const fn = saga<{ id: number }>({ steps: [], storage });
    expect(await fn({ id: 1 })).toEqual({});
  });

  it("runs a single step and returns its result keyed by id", async () => {
    const fn = saga<{ x: number }>({
      steps: [{ id: "double", do: async (c) => c.args.x * 2 }],
      storage,
    });
    expect(await fn({ x: 21 })).toEqual({ double: 42 });
  });

  it("runs multiple steps in order, accumulating results", async () => {
    const fn = saga<{ start: number }>({
      steps: [
        { id: "a", do: async (c) => c.args.start + 1 },
        { id: "b", do: async (c) => (c.results.a as number) * 10 },
        { id: "c", do: async (c) => (c.results.b as number) + 5 },
      ],
      storage,
    });
    expect(await fn({ start: 1 })).toEqual({ a: 2, b: 20, c: 25 });
  });

  it("compensates prior steps in reverse order on failure", async () => {
    const compA = vi.fn(async () => undefined);
    const compB = vi.fn(async () => undefined);
    const order: string[] = [];

    const fn = saga<{ x: number }>({
      steps: [
        { id: "a", do: async () => "a-out" },
        { id: "b", do: async () => "b-out" },
        {
          id: "c",
          do: async () => {
            throw new Error("c failed");
          },
        },
      ],
      compensations: {
        a: async (ctx, prior) => {
          order.push("compA");
          await compA(ctx, prior);
        },
        b: async (ctx, prior) => {
          order.push("compB");
          await compB(ctx, prior);
        },
      },
      storage,
    });

    await expect(fn({ x: 1 })).rejects.toBeInstanceOf(SagaStepError);
    expect(order).toEqual(["compB", "compA"]);
    expect(compB).toHaveBeenCalledWith(
      expect.objectContaining({ args: { x: 1 } }),
      "b-out",
    );
    expect(compA).toHaveBeenCalledWith(
      expect.objectContaining({ args: { x: 1 } }),
      "a-out",
    );
  });

  it("does not re-run compensations that already completed", async () => {
    const compA = vi.fn(async () => undefined);

    const makeSaga = () =>
      saga<{ x: number }>({
        steps: [
          { id: "a", do: async () => "a-out" },
          {
            id: "b",
            do: async () => {
              throw new Error("b failed");
            },
          },
        ],
        compensations: { a: compA },
        storage,
      });

    await expect(makeSaga()({ x: 1 })).rejects.toBeInstanceOf(SagaStepError);
    await expect(makeSaga()({ x: 1 })).rejects.toBeInstanceOf(SagaStepError);
    expect(compA).toHaveBeenCalledTimes(1);
  });

  it("skips compensation when compensateOn is 'never'", async () => {
    const compA = vi.fn(async () => undefined);

    const fn = saga<{ x: number }>({
      steps: [
        { id: "a", do: async () => "a-out", compensateOn: "never" },
        {
          id: "b",
          do: async () => {
            throw new Error("boom");
          },
        },
      ],
      compensations: { a: compA },
      storage,
    });

    await expect(fn({ x: 1 })).rejects.toBeInstanceOf(SagaStepError);
    expect(compA).not.toHaveBeenCalled();
  });

  it("crash recovery: state in 'running' on entry triggers compensation of prior steps", async () => {
    const compA = vi.fn(async () => undefined);
    const stepB = vi.fn(async () => "b-out");

    const fnA = saga<{ x: number }>({
      steps: [
        { id: "a", do: async () => "a-out" },
        {
          id: "b",
          do: async () => {
            throw new Error("simulate process kill mid-step");
          },
        },
      ],
      compensations: { a: compA },
      storage,
    });
    await expect(fnA({ x: 1 })).rejects.toThrow();
    expect(compA).toHaveBeenCalledTimes(1);

    const fnB = saga<{ x: number }>({
      steps: [
        { id: "a", do: async () => "a-out" },
        { id: "b", do: stepB },
      ],
      compensations: { a: compA },
      storage,
    });
    await expect(fnB({ x: 1 })).rejects.toThrow();
    expect(stepB).not.toHaveBeenCalled();
  });

it("'halt' mode does not run compensations", async () => {
    const compA = vi.fn(async () => undefined);

    const fn = saga<{ x: number }>({
      steps: [
        { id: "a", do: async () => "a-out" },
        {
          id: "b",
          do: async () => {
            throw new Error("nope");
          },
        },
      ],
      compensations: { a: compA },
      storage,
      onPartialFailure: "halt",
    });

    await expect(fn({ x: 1 })).rejects.toBeInstanceOf(SagaStepError);
    expect(compA).not.toHaveBeenCalled();
  });

  it("same args produce the same sagaId", async () => {
    const seen = new Set<string>();
    const fn = saga<{ a: number; b: string }>({
      steps: [
        {
          id: "spy",
          do: async (ctx) => {
            seen.add(ctx.sagaId);
            return ctx.sagaId;
          },
        },
      ],
      storage,
    });

    await fn({ a: 1, b: "x" });
    storage = new MemoryStorageAdapter();
    const fn2 = saga<{ a: number; b: string }>({
      steps: [
        {
          id: "spy",
          do: async (ctx) => {
            seen.add(ctx.sagaId);
            return ctx.sagaId;
          },
        },
      ],
      storage,
    });
    await fn2({ b: "x", a: 1 });
    expect(seen.size).toBe(1);
  });

  it("replays a completed saga without re-running steps", async () => {
    const work = vi.fn(async () => 99);
    const fn = saga<{ x: number }>({
      steps: [{ id: "s", do: work }],
      storage,
    });

    expect(await fn({ x: 1 })).toEqual({ s: 99 });
    expect(await fn({ x: 1 })).toEqual({ s: 99 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate step ids at construction time", () => {
    expect(() =>
      saga<unknown>({
        steps: [
          { id: "a", do: async () => null },
          { id: "a", do: async () => null },
        ],
        storage,
      }),
    ).toThrow(/unique/);
  });

  it("provides args, sagaId, attempt, and results to step ctx", async () => {
    const seen: SagaContext<{ flag: string }> | null = null;
    let captured: SagaContext<{ flag: string }> | null = seen;

    const fn = saga<{ flag: string }>({
      steps: [
        {
          id: "x",
          do: async (ctx) => {
            captured = ctx;
            return "ok";
          },
        },
      ],
      storage,
    });
    await fn({ flag: "yes" });

    expect(captured).not.toBeNull();
    expect(captured!.args).toEqual({ flag: "yes" });
    expect(typeof captured!.sagaId).toBe("string");
    expect(captured!.attempt).toBe(1);
    expect(captured!.results).toEqual({});
  });
});
