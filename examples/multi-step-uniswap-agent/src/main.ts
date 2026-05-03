import { RebalancingAgent, loadConfig } from "./agent.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  // eslint-disable-next-line no-console
  console.log(
    `[acid-agent] starting in ${cfg.dryRun ? "DRY-RUN" : "LIVE"} mode against Base Sepolia (${cfg.base.rpc})`,
  );
  const agent = new RebalancingAgent(cfg);

  process.on("SIGINT", () => {
    // eslint-disable-next-line no-console
    console.log("[acid-agent] caught SIGINT, will stop after current tick");
    agent.stop();
  });

  const fixedRate = 3000n * 10n ** 6n;
  await agent.run(async () => fixedRate);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[acid-agent] fatal:", err);
  process.exit(1);
});
