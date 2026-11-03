import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const REQUIRED_METADATA = [
  "benchmark_version",
  "prompt_version",
  "fixture_sha256",
  "source_sha",
  "requested_repetitions",
  "minimum_repetitions",
];

function assertSummary(summary, expectedProvider) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("INVALID_CAMPAIGN_SUMMARY");
  }
  if (summary.model_provider !== expectedProvider) {
    throw new Error("UNEXPECTED_PROVIDER:" + expectedProvider);
  }
  if (typeof summary.model_id !== "string" || summary.model_id.length === 0) {
    throw new Error("MISSING_MODEL_ID:" + expectedProvider);
  }
  if (!summary.summary || typeof summary.summary !== "object" ||
      !summary.summary.by_test || typeof summary.summary.by_test !== "object") {
    throw new Error("MISSING_TEST_SCORES:" + expectedProvider);
  }
  if (summary.stop_reason !== null) throw new Error("INCOMPLETE_CAMPAIGN:" + expectedProvider);
  if ((summary.summary.by_status?.BLOCKED ?? 0) > 0) {
    throw new Error("BLOCKED_REPETITIONS:" + expectedProvider);
  }
}

export function buildComparison(ollama, groq) {
  assertSummary(ollama, "ollama");
  assertSummary(groq, "groq");
  if (ollama.model_id === groq.model_id) throw new Error("MODELS_MUST_BE_DISTINCT");

  for (const field of REQUIRED_METADATA) {
    if (ollama[field] === null || ollama[field] === undefined ||
        groq[field] === null || groq[field] === undefined) {
      throw new Error("MISSING_COMPARISON_METADATA:" + field);
    }
    if (ollama[field] !== groq[field]) {
      throw new Error("CAMPAIGNS_NOT_COMPARABLE:" + field);
    }
  }

  const ollamaTests = Object.keys(ollama.summary.by_test).sort();
  const groqTests = Object.keys(groq.summary.by_test).sort();
  if (JSON.stringify(ollamaTests) !== JSON.stringify(groqTests)) {
    throw new Error("FIXTURE_SET_MISMATCH");
  }

  const tests = ollamaTests.map((testId) => {
    const local = ollama.summary.by_test[testId];
    const cloud = groq.summary.by_test[testId];
    if (local.repetitions_recorded !== ollama.requested_repetitions ||
        cloud.repetitions_recorded !== groq.requested_repetitions ||
        local.repetitions_recorded !== cloud.repetitions_recorded) {
      throw new Error("INCOMPLETE_REPETITIONS:" + testId);
    }
    return {
      test_id: testId,
      repetitions: local.repetitions_recorded,
      ollama_mean: local.mean_score,
      groq_mean: cloud.mean_score,
      groq_minus_ollama: typeof local.mean_score === "number" && typeof cloud.mean_score === "number" ?
        Number((cloud.mean_score - local.mean_score).toFixed(2)) : null,
      ollama_median: local.median_score,
      groq_median: cloud.median_score,
    };
  });

  const dimensionNames = Object.keys(ollama.summary.dimension_averages_0_to_4 ?? {}).sort();
  const cloudDimensionNames = Object.keys(groq.summary.dimension_averages_0_to_4 ?? {}).sort();
  if (JSON.stringify(dimensionNames) !== JSON.stringify(cloudDimensionNames)) {
    throw new Error("DIMENSION_SET_MISMATCH");
  }
  const dimensions = dimensionNames.map((dimension) => {
    const local = ollama.summary.dimension_averages_0_to_4[dimension];
    const cloud = groq.summary.dimension_averages_0_to_4[dimension];
    return {
      dimension,
      ollama: local,
      groq: cloud,
      groq_minus_ollama: typeof local === "number" && typeof cloud === "number" ?
        Number((cloud - local).toFixed(2)) : null,
    };
  });

  return {
    comparison_version: "1.0.0",
    benchmark_version: ollama.benchmark_version,
    prompt_version: ollama.prompt_version,
    fixture_sha256: ollama.fixture_sha256,
    source_sha: ollama.source_sha,
    requested_repetitions: ollama.requested_repetitions,
    ollama: {
      campaign_id: ollama.campaign_id,
      model_id: ollama.model_id,
      model_version: ollama.model_version,
      transport: ollama.transport,
      summary: ollama.summary.by_status,
    },
    groq: {
      campaign_id: groq.campaign_id,
      model_id: groq.model_id,
      model_version: groq.model_version,
      transport: groq.transport,
      summary: groq.summary.by_status,
    },
    tests,
    dimensions,
    interpretation: "Positive deltas favor Groq; negative deltas favor Ollama. Scores are fixture-rubric results, not a general model ranking.",
  };
}

function renderMarkdown(comparison) {
  const lines = [
    "# CB1-CB10: Ollama vs Groq",
    "",
    `- Benchmark: ${comparison.benchmark_version}`,
    `- Prompt: ${comparison.prompt_version}`,
    `- Fixture SHA-256: ${comparison.fixture_sha256}`,
    `- Source SHA: ${comparison.source_sha}`,
    `- Repetitions per case: ${comparison.requested_repetitions}`,
    `- Ollama: ${comparison.ollama.model_id} (${comparison.ollama.campaign_id})`,
    `- Groq: ${comparison.groq.model_id} (${comparison.groq.campaign_id})`,
    "",
    "| Case | Reps | Ollama mean | Groq mean | Groq − Ollama |",
    "|---|---:|---:|---:|---:|",
    ...comparison.tests.map((row) =>
      `| ${row.test_id} | ${row.repetitions} | ${row.ollama_mean ?? "n/a"} | ${row.groq_mean ?? "n/a"} | ${row.groq_minus_ollama ?? "n/a"} |`
    ),
    "",
    "| Dimension | Ollama | Groq | Groq − Ollama |",
    "|---|---:|---:|---:|",
    ...comparison.dimensions.map((row) =>
      `| ${row.dimension} | ${row.ollama ?? "n/a"} | ${row.groq ?? "n/a"} | ${row.groq_minus_ollama ?? "n/a"} |`
    ),
    "",
    comparison.interpretation,
    "",
    "Latency is not directly comparable across local CPU inference and cloud inference. This comparison does not certify Bridge/Observer connectivity or M6.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const [ollamaPath, groqPath] = process.argv.slice(2);
  if (!ollamaPath || !groqPath) {
    throw new Error("USAGE: bun run llm:benchmark:compare -- <ollama-summary.json> <groq-summary.json>");
  }
  const ollama = JSON.parse(await readFile(resolve(ollamaPath), "utf8"));
  const groq = JSON.parse(await readFile(resolve(groqPath), "utf8"));
  const comparison = buildComparison(ollama, groq);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const outputDir = resolve(process.env.LLM_BENCHMARK_COMPARISON_OUTPUT_DIR ||
    `artifacts/llm-benchmark/comparisons/${stamp}-ollama-vs-groq`);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "comparison.json");
  const markdownPath = resolve(outputDir, "comparison.md");
  await writeFile(jsonPath, JSON.stringify(comparison, null, 2) + "\n", { mode: 0o600 });
  await writeFile(markdownPath, renderMarkdown(comparison), { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    status: "COMPARISON_CREATED",
    models: [comparison.ollama.model_id, comparison.groq.model_id],
    cases: comparison.tests.length,
    repetitions_per_case: comparison.requested_repetitions,
    output_dir: outputDir,
    files: [basename(jsonPath), basename(markdownPath)],
  }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ?
      error.message : "LLM_COMPARISON_FAILED";
    process.stderr.write("LLM_BENCHMARK_COMPARE_FAILED:" + code + "\n");
    process.exitCode = 1;
  });
}
