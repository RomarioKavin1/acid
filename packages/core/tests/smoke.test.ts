import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index.js";

describe("acid core", () => {
  it("exposes a version constant", () => {
    expect(VERSION).toBeTypeOf("string");
  });
});
