import type { Wrapper } from "./types.js";
import { tagWrapper } from "./compose.js";
import { AcidError } from "./errors.js";

export class TimeoutError extends AcidError {
  constructor(public readonly timeoutMs: number, public readonly label?: string) {
    super(
      `${label ? `${label} ` : ""}timed out after ${timeoutMs}ms`,
    );
    this.name = "TimeoutError";
  }
}

export interface WithTimeoutOpts {
  /** Hard deadline in milliseconds. */
  ms: number;
  /** Label used in the timeout error message (e.g., "rebalance"). */
  label?: string;
}

/**
 * Wrap a function with a hard timeout. If the wrapped function does not
 * settle within `ms`, the wrapper rejects with a `TimeoutError`. The
 * underlying function is *not* cancelled (JavaScript can't cancel
 * promises) — the caller stops waiting for it.
 *
 * Composition: place `withTimeout` outside `idempotent` so a hung call
 * still releases the in-flight marker via the normal error path. Place
 * it inside `receipted` so the receipt records the timeout as the
 * outcome.
 */
export function withTimeout<A, R>(opts: WithTimeoutOpts): Wrapper<A, R> {
  const { ms, label } = opts;
  return (fn) => {
    const wrapped = async (args: A): Promise<R> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
      });
      try {
        return await Promise.race([fn(args), timeout]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    };
    return tagWrapper(wrapped, "user", fn);
  };
}
