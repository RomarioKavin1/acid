import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "@openacid/acid";

describe("withTimeout", () => {
  it("returns the wrapped result when it settles in time", async () => {
    const wrapped = withTimeout<number, number>({ ms: 100 })(
      async (n) => n * 2,
    );
    expect(await wrapped(7)).toBe(14);
  });

  it("rejects with TimeoutError when the deadline passes", async () => {
    const wrapped = withTimeout<undefined, string>({
      ms: 20,
      label: "rebalance",
    })(
      () =>
        new Promise<string>((res) => setTimeout(() => res("late"), 200)),
    );
    await expect(wrapped(undefined)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("includes the label in the error message", async () => {
    const wrapped = withTimeout<undefined, never>({
      ms: 5,
      label: "slow-op",
    })(() => new Promise<never>(() => undefined));

    try {
      await wrapped(undefined);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const e = err as TimeoutError;
      expect(e.label).toBe("slow-op");
      expect(e.timeoutMs).toBe(5);
      expect(e.message).toContain("slow-op");
      expect(e.message).toContain("5ms");
    }
  });

  it("clears the timer on success so the process can exit cleanly", async () => {
    const wrapped = withTimeout<number, number>({ ms: 5_000 })(
      async (n) => n + 1,
    );
    const start = Date.now();
    expect(await wrapped(1)).toBe(2);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
