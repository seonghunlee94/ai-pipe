// spec §2 / observability skill §4 — eval harness runner.
//
// The CLI cannot invoke LLM agents, so `ai-pipe eval` is a deterministic METRIC
// CHECKER: it loads `*.eval.json` cases (shape = shared/evals/eval-case.schema.json),
// validates them, and — when a recorded agent output is provided — scores that
// output against the case's declared metrics. Producing the output (invoking the
// agent) is a Claude Code / manual step; this command scores the result so a
// prompt change can be regression-checked.
//
// Usage:
//   ai-pipe eval <evalsDir>                  # discover + validate cases
//   ai-pipe eval <evalsDir> --outputs <dir>  # also score each case against
//                                            #   <dir>/<name>.json (recorded output)
//
// Exit 0 if every case is valid and every scored metric passes; 1 otherwise
// (E_EVAL); 2 for usage errors.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { AiPipeError } from "./errors.js";
import { errMsg, hasFlag, readOptionValue } from "./utils.js";

export interface Metric {
  readonly req_ids_min?: number;
  readonly spec_path_exists?: boolean;
  readonly downstream_notes_not_null?: boolean;
  readonly status_in?: readonly string[];
  // schema allows additionalProperties; unknown keys are reported, not silently ignored.
  readonly [key: string]: unknown;
}

export interface EvalCase {
  readonly name: string;
  readonly agent?: string;
  readonly input: string;
  readonly metric: Metric;
}

export interface MetricResult {
  readonly key: string;
  readonly pass: boolean;
  readonly detail: string;
}

const KNOWN_METRICS = new Set([
  "req_ids_min",
  "spec_path_exists",
  "downstream_notes_not_null",
  "status_in",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Parse + structurally validate one eval case file. Throws AiPipeError on a
// malformed case so the caller can attribute it to the file.
export function loadEvalCase(file: string): EvalCase {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    throw new AiPipeError("E_EVAL", `cannot read eval case ${file}: ${errMsg(e)}`, 1);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new AiPipeError("E_EVAL", `invalid JSON in ${file}: ${errMsg(e)}`, 1);
  }
  if (!isObject(json)) {
    throw new AiPipeError("E_EVAL", `${file}: eval case must be a JSON object`, 1);
  }
  const { name, input, metric, agent } = json as Record<string, unknown>;
  if (typeof name !== "string" || name.length === 0) {
    throw new AiPipeError("E_EVAL", `${file}: missing string "name"`, 1);
  }
  if (typeof input !== "string") {
    throw new AiPipeError("E_EVAL", `${file}: missing string "input"`, 1);
  }
  if (!isObject(metric)) {
    throw new AiPipeError("E_EVAL", `${file}: missing object "metric"`, 1);
  }
  if (agent !== undefined && typeof agent !== "string") {
    throw new AiPipeError("E_EVAL", `${file}: "agent" must be a string`, 1);
  }
  const result: EvalCase = agent === undefined
    ? { name, input, metric: metric as Metric }
    : { name, input, agent, metric: metric as Metric };
  return result;
}

// Score a recorded agent output against a case's metrics. `baseDir` resolves
// any relative path the output references (e.g. spec_path). Returns one result
// per declared metric; unknown metric keys are reported as failures so a typo
// in a case is loud rather than silently green.
export function checkMetrics(output: unknown, metric: Metric, baseDir: string): MetricResult[] {
  const out: MetricResult[] = [];
  const obj = isObject(output) ? output : {};

  for (const key of Object.keys(metric)) {
    if (key === "req_ids_min") {
      const min = metric.req_ids_min ?? 0;
      const ids = obj["req_ids"];
      const count = Array.isArray(ids) ? ids.length : 0;
      out.push({
        key,
        pass: count >= min,
        detail: `req_ids count ${count} ${count >= min ? ">=" : "<"} ${min}`,
      });
    } else if (key === "spec_path_exists") {
      const want = metric.spec_path_exists === true;
      const sp = obj["spec_path"];
      const exists = typeof sp === "string" && existsSync(resolve(baseDir, sp));
      out.push({
        key,
        pass: exists === want,
        detail: typeof sp === "string" ? `spec_path "${sp}" exists=${exists}` : "spec_path missing/not a string",
      });
    } else if (key === "downstream_notes_not_null") {
      const want = metric.downstream_notes_not_null === true;
      const dn = obj["downstream_notes"];
      const notNull = isObject(dn);
      out.push({
        key,
        pass: notNull === want,
        detail: `downstream_notes is ${notNull ? "a non-null object" : "null/absent/non-object"}`,
      });
    } else if (key === "status_in") {
      const allowed = Array.isArray(metric.status_in) ? metric.status_in : [];
      const status = obj["status"];
      const ok = typeof status === "string" && allowed.includes(status);
      out.push({
        key,
        pass: ok,
        detail: `status ${JSON.stringify(status)} in ${JSON.stringify(allowed)}`,
      });
    } else if (!KNOWN_METRICS.has(key)) {
      out.push({ key, pass: false, detail: `unknown metric "${key}" — not scored (typo?)` });
    }
  }
  return out;
}

function discoverCases(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".eval.json"))
    .sort()
    .map((f) => join(dir, f));
}

export async function runEval(args: string[]): Promise<void> {
  // Collect positionals, skipping flags AND the value that follows --outputs.
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--outputs") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push(a);
  }
  if (positionals.length !== 1) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe eval <evalsDir> [--outputs <dir>]", 2);
  }
  const dir = resolve(process.cwd(), positionals[0] ?? ".");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new AiPipeError("E_BAD_USAGE", `eval: not a directory: ${dir}`, 2);
  }
  const outputsArg = readOptionValue(args, "--outputs");
  const outputsDir = outputsArg !== undefined ? resolve(process.cwd(), outputsArg) : undefined;
  const verbose = hasFlag(args, "--verbose");

  const files = discoverCases(dir);
  if (files.length === 0) {
    process.stdout.write(`eval: no *.eval.json cases in ${dir}\n`);
    return;
  }

  let invalid = 0;
  let scored = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of files) {
    let evalCase: EvalCase;
    try {
      evalCase = loadEvalCase(file);
    } catch (e) {
      invalid++;
      process.stdout.write(`✗ ${file}: ${errMsg(e)}\n`);
      continue;
    }

    if (outputsDir === undefined) {
      process.stdout.write(`✓ ${evalCase.name}: valid (metrics: ${Object.keys(evalCase.metric).join(", ") || "none"})\n`);
      continue;
    }

    const outFile = join(outputsDir, `${evalCase.name}.json`);
    if (!existsSync(outFile)) {
      skipped++;
      process.stdout.write(`· ${evalCase.name}: no recorded output (${outFile}) — skipped\n`);
      continue;
    }
    let output: unknown;
    try {
      output = JSON.parse(readFileSync(outFile, "utf8"));
    } catch (e) {
      failed++;
      process.stdout.write(`✗ ${evalCase.name}: output not valid JSON (${errMsg(e)})\n`);
      continue;
    }
    const results = checkMetrics(output, evalCase.metric, outputsDir);
    const casePass = results.every((r) => r.pass);
    scored++;
    if (!casePass) failed++;
    process.stdout.write(`${casePass ? "✓" : "✗"} ${evalCase.name}: ${results.filter((r) => r.pass).length}/${results.length} metrics\n`);
    if (verbose || !casePass) {
      for (const r of results) {
        process.stdout.write(`    ${r.pass ? "✓" : "✗"} ${r.key}: ${r.detail}\n`);
      }
    }
  }

  const summary =
    outputsDir === undefined
      ? `eval: ${files.length} case(s), ${invalid} invalid`
      : `eval: ${scored} scored, ${failed} failed, ${skipped} skipped (no output), ${invalid} invalid`;
  process.stdout.write(`${summary}\n`);
  if (invalid > 0 || failed > 0) {
    throw new AiPipeError("E_EVAL", summary, 1);
  }
}
