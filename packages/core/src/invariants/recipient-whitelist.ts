import type { InvariantContext, InvariantViolation } from "../types.js";

export interface RecipientWhitelistOpts<A, R> {
  /** Lowercased addresses (or arbitrary identifiers) the agent is allowed to send to. */
  allowed: ReadonlyArray<string>;
  /** Extracts the list of recipients touched by this action from args+result. */
  getRecipients: (args: A, result: R) => Promise<ReadonlyArray<string>>;
  /** Whether to ignore casing. Default: true (compare lowercased). */
  caseInsensitive?: boolean;
}

/**
 * Postcondition that verifies every recipient touched by the action is in the
 * configured allowlist. Use this when an agent must never send to addresses
 * outside a known set (e.g., approved DEX routers, the agent's own vault).
 */
export function recipientWhitelist<A, R>(opts: RecipientWhitelistOpts<A, R>) {
  const { allowed, getRecipients, caseInsensitive = true } = opts;
  const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
  const allow = new Set(allowed.map(norm));

  return async (
    args: A,
    result: R,
    _ctx: InvariantContext,
  ): Promise<boolean | InvariantViolation> => {
    const recipients = await getRecipients(args, result);
    const offenders = recipients
      .map(norm)
      .filter((r) => !allow.has(r));

    if (offenders.length > 0) {
      return {
        reason: `action touched ${offenders.length} recipient(s) outside the whitelist`,
        severity: "critical",
        context: {
          offenders,
          allowedSize: allow.size,
        },
      };
    }
    return true;
  };
}
