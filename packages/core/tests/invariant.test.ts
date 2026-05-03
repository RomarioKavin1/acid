import { describe, it, expect, vi } from "vitest";
import {
  invariant,
  InvariantViolationError,
  balanceWithinBound,
  gasUnderCap,
  slippageBelow,
  noOrphanAllowances,
} from "@openacid/acid";

describe("invariant", () => {
  describe("pre", () => {
    it("runs the wrapped fn when the precondition returns true", async () => {
      const fn = vi.fn(async (n: number) => n * 2);
      const wrapped = invariant<number, number>({
        pre: async (n) => n > 0,
      })(fn);
      expect(await wrapped(5)).toBe(10);
      expect(fn).toHaveBeenCalled();
    });

    it("throws and skips the fn when the precondition returns false", async () => {
      const fn = vi.fn(async (n: number) => n);
      const wrapped = invariant<number, number>({
        pre: async (n) => n > 0,
      })(fn);
      await expect(wrapped(-1)).rejects.toBeInstanceOf(InvariantViolationError);
      expect(fn).not.toHaveBeenCalled();
    });

    it("returns the violation reason from the predicate", async () => {
      const fn = async (n: number) => n;
      const wrapped = invariant<number, number>({
        pre: async () => ({
          reason: "balance too low",
          severity: "critical" as const,
        }),
      })(fn);
      try {
        await wrapped(0);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvariantViolationError);
        const e = err as InvariantViolationError;
        expect(e.phase).toBe("pre");
        expect(e.reason).toBe("balance too low");
        expect(e.severity).toBe("critical");
      }
    });
  });

  describe("post", () => {
    it("runs the wrapped fn and the postcondition", async () => {
      const fn = async (n: number) => n + 1;
      const wrapped = invariant<number, number>({
        post: async (_args, result) => result < 100,
      })(fn);
      expect(await wrapped(5)).toBe(6);
    });

    it("throws when the postcondition fails", async () => {
      const wrapped = invariant<number, number>({
        post: async (_args, result) => result < 100,
      })(async (n) => n);

      try {
        await wrapped(500);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvariantViolationError);
        expect((err as InvariantViolationError).phase).toBe("post");
      }
    });
  });

  describe("modes", () => {
    it("'log-only' mode reports the violation without throwing", async () => {
      const log = vi.fn();
      const wrapped = invariant<number, number>({
        post: async () => false,
        onViolation: "log-only",
        onLog: log,
      })(async (n) => n);

      await expect(wrapped(1)).resolves.toBe(1);
      expect(log).toHaveBeenCalledOnce();
    });

    it("'compensate' mode runs the compensator and then throws", async () => {
      const compensator = vi.fn(async () => undefined);
      const wrapped = invariant<number, number>({
        post: async () => false,
        onViolation: "compensate",
        compensate: compensator,
      })(async (n) => n);

      await expect(wrapped(1)).rejects.toBeInstanceOf(InvariantViolationError);
      expect(compensator).toHaveBeenCalledOnce();
    });

    it("'compensate' mode without a callback throws clearly", async () => {
      const wrapped = invariant<number, number>({
        post: async () => false,
        onViolation: "compensate",
      })(async (n) => n);

      await expect(wrapped(1)).rejects.toThrow(/compensate/);
    });
  });
});

describe("built-in invariants", () => {
  it("balanceWithinBound passes when balance is in range", async () => {
    const inv = balanceWithinBound<unknown, unknown>({
      min: 100n,
      max: 200n,
      getBalance: async () => 150n,
    });
    expect(await inv({}, {}, { fnName: "x", startedAt: 0 })).toBe(true);
  });

  it("balanceWithinBound fails below min", async () => {
    const inv = balanceWithinBound<unknown, unknown>({
      min: 100n,
      max: 200n,
      getBalance: async () => 50n,
    });
    const r = await inv({}, {}, { fnName: "x", startedAt: 0 });
    expect(typeof r).toBe("object");
  });

  it("gasUnderCap fails when gas exceeds cap", async () => {
    const inv = gasUnderCap<unknown, unknown>({
      cap: 100_000n,
      getGasUsed: async () => 200_000n,
    });
    const r = await inv({}, {}, { fnName: "x", startedAt: 0 });
    expect(r).not.toBe(true);
  });

  it("slippageBelow passes when actual matches quoted", async () => {
    const inv = slippageBelow<unknown, unknown>({
      thresholdBps: 50,
      getQuoted: async () => 1000n,
      getActual: async () => 1000n,
    });
    expect(await inv({}, {}, { fnName: "x", startedAt: 0 })).toBe(true);
  });

  it("slippageBelow fails when slippage exceeds threshold", async () => {
    const inv = slippageBelow<unknown, unknown>({
      thresholdBps: 50,
      getQuoted: async () => 1000n,
      getActual: async () => 940n,
    });
    const r = await inv({}, {}, { fnName: "x", startedAt: 0 });
    expect(r).not.toBe(true);
  });

  it("noOrphanAllowances passes when no allowances exist", async () => {
    const inv = noOrphanAllowances<unknown, unknown>({
      getAllowances: async () => [],
    });
    expect(await inv({}, {}, { fnName: "x", startedAt: 0 })).toBe(true);
  });

  it("noOrphanAllowances flags non-zero allowances as critical", async () => {
    const inv = noOrphanAllowances<unknown, unknown>({
      getAllowances: async () => [
        { token: "0xA", spender: "0xB", amount: 5n },
      ],
    });
    const r = await inv({}, {}, { fnName: "x", startedAt: 0 });
    expect(typeof r).toBe("object");
    if (typeof r === "object") {
      expect(r.severity).toBe("critical");
    }
  });
});
