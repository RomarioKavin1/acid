import type { InvariantContext, InvariantViolation } from "../types.js";

export interface NoOrphanAllowancesOpts<A, R> {
  getAllowances: (
    args: A,
    result: R,
  ) => Promise<Array<{ token: string; spender: string; amount: bigint }>>;
  allow?: (a: { token: string; spender: string; amount: bigint }) => boolean;
}

export function noOrphanAllowances<A, R>(opts: NoOrphanAllowancesOpts<A, R>) {
  const { getAllowances, allow = () => false } = opts;
  return async (
    args: A,
    result: R,
    _ctx: InvariantContext,
  ): Promise<boolean | InvariantViolation> => {
    const allowances = await getAllowances(args, result);
    const orphans = allowances.filter((a) => a.amount > 0n && !allow(a));
    if (orphans.length > 0) {
      return {
        reason: `wallet still holds ${orphans.length} non-zero allowance(s) after action`,
        severity: "critical",
        context: {
          orphans: orphans.map((o) => ({
            token: o.token,
            spender: o.spender,
            amount: o.amount.toString(),
          })),
        },
      };
    }
    return true;
  };
}
