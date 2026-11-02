#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runBenchmark } from "./benchmark.mjs";

async function main() {
  const campaign = await runBenchmark();
  const stamp = campaign.campaign_id.replace(/[^A-Za-z0-9_-]/g, "-");
  const outputDir = resolve(
    process.env.LLM_BENCHMARK_OUTPUT_DIR || "artifacts/llm-benchmark/" + stamp,
  );
  await mkdir(outputDir, { recursive: true });
  const resultsPath = resolve(outputDir, "results.json");
  const summaryPath = resolve(outputDir, "summary.json");
  await writeFile(resultsPath, JSON.stringify(campaign.results, null, 2) + "\n", { mode: 0o600 });
  await writeFile(summaryPath, JSON.stringify({
    ...campaign,
    results: undefined,
    evidence_files: ["results.json", "summary.json"],
  }, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    campaign_id: campaign.campaign_id,
    model_id: campaign.model_id,
    model_version: campaign.model_version,
    tests: campaign.results.length,
    summary: campaign.summary,
    stop_reason: campaign.stop_reason,
    evidence_dir: outputDir,
  }, null, 2) + "\n");
  if (campaign.stop_reason) process.exitCode = 2;
  else if (campaign.results.some((item) => item.status === "BLOCKED")) process.exitCode = 1;
}

main().catch((error) => {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ?
    error.message : "LLM_BENCHMARK_FAILED";
  process.stderr.write("LLM_BENCHMARK_BLOCKED_OR_FAILED:" + code + "\n");
  process.exitCode = 1;
});
