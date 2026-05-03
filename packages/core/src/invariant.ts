import type { Wrapper, InvariantContext, InvariantViolation } from "./types.js";
import { InvariantViolationError } from "./errors.js";

export type InvariantOnViolation = "throw" | "compensate" | "log-only";

export type Predicate<Phase extends "pre" | "post", A, R> = Phase extends "pre"
  ? (args: A, ctx: InvariantContext) => Promise<boolean | InvariantViolation>
  : (
      args: A,
      result: R,
      ctx: InvariantContext,
    ) => Promise<boolean | InvariantViolation>;

export interface InvariantOpts<A, R> {
  pre?: Predicate<"pre", A, R>;
  post?: Predicate<"post", A, R>;
  onViolation?: InvariantOnViolation;
  onLog?: (
    violation: InvariantViolation,
    phase: "pre" | "post",
    args: A,
    result?: R,
  ) => void;
  compensate?: (
    args: A,
    result: R | undefined,
    violation: InvariantViolation,
    phase: "pre" | "post",
  ) => Promise<void>;
  fnName?: string;
}

export function invariant<A, R>(opts: InvariantOpts<A, R>): Wrapper<A, R> {
  const {
    pre,
    post,
    onViolation = "throw",
    onLog,
    compensate,
    fnName = "anonymous",
  } = opts;

  return (fn) => async (args: A) => {
    const startedAt = Date.now();
    const ctx: InvariantContext = { fnName, startedAt };

    if (pre) {
      const verdict = await pre(args, ctx);
      const violation = normalizeVerdict(verdict, "pre-condition failed");
      if (violation) {
        await handleViolation(
          violation,
          "pre",
          onViolation,
          onLog,
          compensate,
          args,
          undefined,
        );
      }
    }

    const result = await fn(args);

    if (post) {
      const verdict = await post(args, result, ctx);
      const violation = normalizeVerdict(verdict, "post-condition failed");
      if (violation) {
        await handleViolation(
          violation,
          "post",
          onViolation,
          onLog,
          compensate,
          args,
          result,
        );
      }
    }

    return result;
  };
}

function normalizeVerdict(
  verdict: boolean | InvariantViolation,
  defaultReason: string,
): InvariantViolation | null {
  if (verdict === true) return null;
  if (verdict === false) {
    return { reason: defaultReason, severity: "high" };
  }
  return verdict;
}

async function handleViolation<A, R>(
  violation: InvariantViolation,
  phase: "pre" | "post",
  mode: InvariantOnViolation,
  onLog: InvariantOpts<A, R>["onLog"],
  compensate: InvariantOpts<A, R>["compensate"],
  args: A,
  result: R | undefined,
): Promise<void> {
  if (mode === "log-only") {
    if (onLog) onLog(violation, phase, args, result);
    return;
  }

  if (mode === "compensate") {
    if (!compensate) {
      throw new InvariantViolationError(
        phase,
        `${violation.reason} (mode: compensate but no compensate callback provided)`,
        violation.severity,
        violation.context,
      );
    }
    await compensate(args, result, violation, phase);
    throw new InvariantViolationError(
      phase,
      violation.reason,
      violation.severity,
      violation.context,
    );
  }

  throw new InvariantViolationError(
    phase,
    violation.reason,
    violation.severity,
    violation.context,
  );
}
