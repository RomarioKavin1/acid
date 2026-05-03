import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@openacid/acid": resolve(here, "packages/core/src/index.ts"),
      "@openacid/adapter-memory": resolve(
        here,
        "packages/adapter-memory/src/index.ts",
      ),
      "@openacid/adapter-viem": resolve(
        here,
        "packages/adapter-viem/src/index.ts",
      ),
      "@openacid/adapter-0g-storage": resolve(
        here,
        "packages/adapter-0g-storage/src/index.ts",
      ),
      "@openacid/adapter-ens": resolve(
        here,
        "packages/adapter-ens/src/index.ts",
      ),
    },
  },
});
