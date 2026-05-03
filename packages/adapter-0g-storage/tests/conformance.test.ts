import { describe, it } from "vitest";
import { storageConformanceCases } from "@openacid/acid";
import { ZeroGStorageAdapter } from "../src/zerog-storage.js";

const evmRpc = process.env.ZEROG_CHAIN_RPC;
const indexerRpc = process.env.ZEROG_STORAGE_INDEXER_RPC;
const privateKey = process.env.ZEROG_CHAIN_PRIVATE_KEY;
const liveAvailable = Boolean(evmRpc && indexerRpc && privateKey);

const describeIfLive = liveAvailable ? describe : describe.skip;

describeIfLive(
  "ZeroGStorageAdapter — live 0G Galileo conformance",
  () => {
    for (const c of storageConformanceCases) {
      if (c.needsClock) continue;
      it(c.name, async () => {
        await c.run(
          () =>
            new ZeroGStorageAdapter({
              evmRpc: evmRpc!,
              indexerRpc: indexerRpc!,
              privateKey: privateKey!,
            }),
        );
      }, 120_000);
    }
  },
);
