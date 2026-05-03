import type { InvariantContext, InvariantViolation } from "../types.js";

export interface BalanceWithinBoundOpts<A, R> {
  min: bigint;
  max: bigint;
  getBalance: (args: A, result: R) => Promise<bigint>;
  label?: string;
}

export function balanceWithinBound<A, R>(opts: BalanceWithinBoundOpts<A, R>) {
  const { min, max, getBalance, label = "balance" } = opts;
  return async (
    args: A,
    result: R,
    _ctx: InvariantContext,
  ): Promise<boolean | InvariantViolation> => {
    const balance = await getBalance(args, result);
    if (balance < min) {
      return {
        reason: `${label} ${balance} below minimum ${min}`,
        severity: "high",
        context: { balance: balance.toString(), min: min.toString() },
      };
    }
    if (balance > max) {
      return {
        reason: `${label} ${balance} above maximum ${max}`,
        severity: "high",
        context: { balance: balance.toString(), max: max.toString() },
      };
    }
    return true;
  };
}
