import type { InvariantContext, InvariantViolation } from "../types.js";

export interface GasUnderCapOpts<A, R> {
  cap: bigint;
  getGasUsed: (args: A, result: R) => Promise<bigint>;
  label?: string;
}

export function gasUnderCap<A, R>(opts: GasUnderCapOpts<A, R>) {
  const { cap, getGasUsed, label = "gas" } = opts;
  return async (
    args: A,
    result: R,
    _ctx: InvariantContext,
  ): Promise<boolean | InvariantViolation> => {
    const used = await getGasUsed(args, result);
    if (used > cap) {
      return {
        reason: `${label} used ${used} exceeds cap ${cap}`,
        severity: "medium",
        context: { used: used.toString(), cap: cap.toString() },
      };
    }
    return true;
  };
}
