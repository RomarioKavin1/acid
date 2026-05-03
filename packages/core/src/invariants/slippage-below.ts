import type { InvariantContext, InvariantViolation } from "../types.js";

export interface SlippageBelowOpts<A, R> {
  thresholdBps: number;
  getQuoted: (args: A, result: R) => Promise<bigint>;
  getActual: (args: A, result: R) => Promise<bigint>;
}

export function slippageBelow<A, R>(opts: SlippageBelowOpts<A, R>) {
  const { thresholdBps, getQuoted, getActual } = opts;
  return async (
    args: A,
    result: R,
    _ctx: InvariantContext,
  ): Promise<boolean | InvariantViolation> => {
    const quoted = await getQuoted(args, result);
    const actual = await getActual(args, result);
    if (quoted === 0n) {
      return {
        reason: "quoted amount is zero; cannot compute slippage",
        severity: "high",
      };
    }
    const diff = quoted > actual ? quoted - actual : 0n;
    const bps = Number((diff * 10_000n) / quoted);
    if (bps > thresholdBps) {
      return {
        reason: `slippage ${bps}bps exceeds ${thresholdBps}bps`,
        severity: "high",
        context: {
          quoted: quoted.toString(),
          actual: actual.toString(),
          bps,
          thresholdBps,
        },
      };
    }
    return true;
  };
}
