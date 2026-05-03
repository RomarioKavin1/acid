/**
 * LIVE — one tick of the rebalancer against real Base Sepolia, real 0G
 * Storage, and real Sepolia ENS. Reads the ENS receipt.latest text record
 * before and after the tick to prove the audit trail updated on-chain.
 *
 * Runs in DRY-RUN mode for the swap step (no V4 broadcast required), but
 * the receipt persistence and ENS mirroring are fully live.
 */

import { createPublicClient, http, namehash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia } from "viem/chains";
import { loadConfig } from "../config.js";
import { RebalancingAgent } from "../agent.js";
import {
  banner,
  step,
  ok,
  info,
  warn,
  summary,
  divider,
  pause,
} from "./banner.js";

const RESOLVER_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

async function main(): Promise<void> {
  if (!process.argv.includes("--dry-run")) {
    process.argv.push("--dry-run");
  }

  const cfg = loadConfig();
  banner("D", "LIVE — Base Sepolia · 0G Galileo · Sepolia ENS");

  const signer = privateKeyToAccount(cfg.privateKey).address;
  step(1, `mode:        DRY-RUN swap step, LIVE persistence`);
  step(2, `signer:      ${signer}`);
  step(
    3,
    `0G storage:  ${cfg.zeroG ? `live → ${cfg.zeroG.indexerRpc}` : "in-memory only"}`,
  );
  step(
    4,
    `ENS mirror:  ${cfg.ens ? `live → ${cfg.ens.parentName} (Sepolia)` : "disabled"}`,
  );
  divider();

  if (!cfg.zeroG && !cfg.ens) {
    warn(
      "neither 0G nor ENS env present; this scene degrades to an in-memory dry-run",
    );
  }

  let beforeRecord: string | null = null;
  let ensClient: ReturnType<typeof createPublicClient> | null = null;
  let ensNode: Hex | null = null;
  if (cfg.ens) {
    ensClient = createPublicClient({
      chain: sepolia,
      transport: http(cfg.ens.sepoliaRpc),
    });
    ensNode = namehash(cfg.ens.parentName);
    beforeRecord = (await ensClient.readContract({
      address: cfg.ens.resolver,
      abi: RESOLVER_ABI,
      functionName: "text",
      args: [ensNode, "receipt.latest"],
    })) as string;
    info(
      `ENS BEFORE: ${cfg.ens.parentName}/receipt.latest = ${truncate(beforeRecord) || "<empty>"}`,
    );
  }

  const baseClient = createPublicClient({
    chain: baseSepolia,
    transport: http(cfg.base.rpc),
  });
  const baseBalance = await baseClient.getBalance({
    address: signer as Hex,
  });
  info(
    `Base Sepolia: ${signer} has ${(Number(baseBalance) / 1e18).toFixed(6)} ETH at block ${await baseClient.getBlockNumber()}`,
  );
  divider();

  step(5, "running one rebalance tick…");
  const agent = new RebalancingAgent(cfg);
  const fixedRate = 3000n * 10n ** 6n;
  const tickStart = Date.now();
  const result = await agent.tick(fixedRate);
  const tickMs = Date.now() - tickStart;
  divider();

  summary("acted", String(result.acted));
  summary(
    "drift",
    `${result.driftBps}bps (target ${cfg.targetEthRatioBps}bps, threshold ${cfg.driftThresholdBps}bps)`,
  );
  summary("reason", result.reason);
  if (result.receipt) {
    summary("receipt callId", result.receipt.callId);
    summary(
      "receipt signature",
      result.receipt.signature.slice(0, 22) + "…",
    );
    summary(
      "receipt txRefs",
      result.receipt.txRefs.length > 0
        ? result.receipt.txRefs.map((s) => truncate(s)).join(", ")
        : "<none — tick decided not to swap or saga failed>",
    );
  }
  summary("tick wall time", `${tickMs}ms`);
  divider();

  if (cfg.ens && ensClient && ensNode) {
    step(6, "polling ENS until the resolver reflects the new receipt…");
    const expected = result.receipt?.callId.toLowerCase();
    const deadline = Date.now() + 90_000;
    let afterRecord = "";
    let polls = 0;
    while (Date.now() < deadline) {
      polls++;
      afterRecord = (await ensClient.readContract({
        address: cfg.ens.resolver,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [ensNode, "receipt.latest"],
      })) as string;
      if (
        expected
          ? afterRecord.toLowerCase() === expected
          : afterRecord !== beforeRecord && afterRecord !== ""
      ) {
        break;
      }
      await pause(4);
    }
    info(
      `ENS AFTER:  ${cfg.ens.parentName}/receipt.latest = ${truncate(afterRecord) || "<empty>"} (after ${polls} poll(s))`,
    );

    if (
      result.receipt &&
      afterRecord.toLowerCase() === result.receipt.callId.toLowerCase()
    ) {
      ok(
        `ENS receipt.latest matches the agent's freshly-emitted callId — third party verifiable`,
      );
    } else if (afterRecord && afterRecord !== beforeRecord) {
      ok(
        `ENS receipt.latest changed from BEFORE → AFTER (mirror wrote a new record)`,
      );
    } else if (!result.acted) {
      info(
        `agent did not act this tick (no drift) — ENS record unchanged, as expected`,
      );
    } else {
      warn(
        `ENS readback did not reflect the new receipt within the 90s window; the setText tx may still be pending`,
      );
    }
  } else {
    info(
      "ENS env not configured; skipping the ENS readback. Set ENS_PARENT_NAME and rerun to see the on-chain audit trail update live.",
    );
  }
}

function truncate(s: string | null | undefined, head = 12, tail = 6): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[live] fatal:", err);
  process.exit(1);
});
