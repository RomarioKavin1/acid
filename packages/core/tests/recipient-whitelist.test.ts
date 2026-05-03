import { describe, it, expect } from "vitest";
import { recipientWhitelist } from "@openacid/acid";
import type { InvariantViolation } from "@openacid/acid";

const ctx = { fnName: "test", startedAt: 0 };

describe("recipientWhitelist", () => {
  it("passes when all recipients are in the allowlist (case-insensitive)", async () => {
    const inv = recipientWhitelist<unknown, unknown>({
      allowed: ["0xAaA", "0xBBb"],
      getRecipients: async () => ["0xaaa", "0xBBB"],
    });
    expect(await inv({}, {}, ctx)).toBe(true);
  });

  it("flags recipients outside the allowlist as critical", async () => {
    const inv = recipientWhitelist<unknown, unknown>({
      allowed: ["0xAAAA"],
      getRecipients: async () => ["0xAAAA", "0xEvil"],
    });
    const r = (await inv({}, {}, ctx)) as InvariantViolation;
    expect(r).not.toBe(true);
    expect(r.severity).toBe("critical");
    expect(r.context?.offenders).toEqual(["0xevil"]);
  });

  it("respects case sensitivity when caseInsensitive=false", async () => {
    const inv = recipientWhitelist<unknown, unknown>({
      allowed: ["0xAAAA"],
      getRecipients: async () => ["0xaaaa"],
      caseInsensitive: false,
    });
    const r = await inv({}, {}, ctx);
    expect(r).not.toBe(true);
  });

  it("handles empty recipient lists trivially", async () => {
    const inv = recipientWhitelist<unknown, unknown>({
      allowed: ["0xAAAA"],
      getRecipients: async () => [],
    });
    expect(await inv({}, {}, ctx)).toBe(true);
  });
});
