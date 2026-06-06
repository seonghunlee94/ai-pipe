// spec §2 / observability skill §4 — eval harness runner.
//
// The CLI cannot invoke LLM agents, so `ai-pipe eval` is a deterministic METRIC
// CHECKER: it loads `*.eval.json` cases (shape = shared/evals/eval-case.schema.json),
// validates them, and — when a recorded agent output is provided — scores that
// output against the case's declared metrics. Producing the output (invoking the
// agent) is a Claude Code / manual step; this command scores the result so a
// prompt change can be regression-checked.
//
// Each metric reads a fixed field of the agent OUTPUT object:
//   req_ids_min (number)            → output.req_ids.length >= value
//   spec_path_exists (bool)         → existsSync(<cwd>/output.spec_path) === value
//   downstream_notes_not_null (bool)→ (output.downstream_notes is a non-null object) === value
//   status_in (string[])            → output.status ∈ value
// spec_path is resolved relative to the CURRENT WORKING DIRECTORY (the project
// root where the agent created the spec), not the outputs dir.
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
import { errMsg, hasFlag } from "./utils.js";

export interface Metric {
  readonly req_ids_min?: number;
  readonly spec_path_exists?: boolean;
  readonly downstream_notes_not_null?: boolean;
  readonly status_in?: readonly string[];
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Single registry: each metric declares how to validate its case-file value and
// how to score an output. Adding a metric = one entry here (no parallel lists).
interface MetricDef {
  // Returns an error string if the case-file value is the wrong type, else null.
  validate(value: unknown): string | null;
  // Scores a recorded output. baseDir resolves any referenced path.
  check(output: Record<string, unknown>, value: unknown, baseDir: string): { pass: boolean; detail: string };
}

const METRICS: Record<string, MetricDef> = {
  req_ids_min: {
    validate: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? null : "must be an integer >= 0"),
    check: (o, v) => {
      const min = v as number;
      const ids = o["req_ids"];
      const count = Array.isArray(ids) ? ids.length : 0;
      return { pass: count >= min, detail: `req_ids count ${count} ${count >= min ? ">=" : "<"} ${min}` };
    },
  },
  spec_path_exists: {
    validate: (v) => (typeof v === "boolean" ? null : "must be a boolean"),
    check: (o, v, baseDir) => {
      const want = v as boolean;
      const sp = o["spec_path"];
      const exists = typeof sp === "string" && existsSync(resolve(baseDir, sp));
      return {
        pass: exists === want,
        detail: typeof sp === "string" ? `spec_path "${sp}" exists=${exists} (want ${want})` : "spec_path missing/not a string",
      };
    },
  },
  downstream_notes_not_null: {
    validate: (v) => (typeof v === "boolean" ? null : "must be a boolean"),
    check: (o, v) => {
      const want = v as boolean;
      const notNull = isObject(o["downstream_notes"]);
      return { pass: notNull === want, detail: `downstream_notes is ${notNull ? "a non-null object" : "null/absent/non-object"} (want not-null=${want})` };
    },
  },
  status_in: {
    validate: (v) =>
      Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")
        ? null
        : "must be a non-empty array of strings",
    check: (o, v) => {
      const allowed = v as string[];
      const status = o["status"];
      const ok = typeof status === "string" && allowed.includes(status);
      return { pass: ok, detail: `status ${JSON.stringify(status)} in ${JSON.stringify(allowed)}` };
    },
  },
};

// Parse + structurally validate one eval case file (including metric key/value
// types). Throws AiPipeError on a malformed case so the caller can attribute it.
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
  const allowedTop = ["name", "input", "metric", "agent"];
  const extra = Object.keys(json).filter((k) => !allowedTop.includes(k));
  if (extra.length > 0) {
    throw new AiPipeError("E_EVAL", `${file}: unknown top-level key(s): ${extra.join(", ")} (allowed: ${allowedTop.join(", ")})`, 1);
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
  const keys = Object.keys(metric);
  if (keys.length === 0) {
    throw new AiPipeError("E_EVAL", `${file}: "metric" defines no metrics (would vacuously pass)`, 1);
  }
  for (const key of keys) {
    const def = METRICS[key];
    if (!def) {
      throw new AiPipeError("E_EVAL", `${file}: unknown metric "${key}" (known: ${Object.keys(METRICS).join(", ")})`, 1);
    }
    const err = def.validate(metric[key]);
    if (err) {
      throw new AiPipeError("E_EVAL", `${file}: metric "${key}" ${err}`, 1);
    }
  }
  return agent === undefined
    ? { name, input, metric: metric as Metric }
    : { name, input, agent, metric: metric as Metric };
}

// Score a recorded agent output against a case's metrics. `baseDir` resolves any
// path the output references (e.g. spec_path). One result per declared metric;
// an unknown key (only reachable when called directly, not via loadEvalCase) is
// a failure, never a silent pass.
export function checkMetrics(output: unknown, metric: Metric, baseDir: string): MetricResult[] {
  const obj = isObject(output) ? output : {};
  return Object.keys(metric).map((key) => {
    const def = METRICS[key];
    if (!def) return { key, pass: false, detail: `unknown metric "${key}" — not scored (typo?)` };
    // Re-validate the value here too: checkMetrics is a pure, total function that
    // may be called directly (tests) without loadEvalCase having gated the value.
    const verr = def.validate(metric[key]);
    if (verr) return { key, pass: false, detail: `invalid metric value: ${verr}` };
    const { pass, detail } = def.check(obj, metric[key], baseDir);
    return { key, pass, detail };
  });
}

function discoverCases(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".eval.json"))
    .map((e) => e.name)
    .sort()
    .map((name) => join(dir, name));
}

export async function runEval(args: string[]): Promise<void> {
  // --outputs <dir> | --outputs=<dir>: require a real value (a mistyped flag
  // must not silently downgrade a regression gate to "validate-only, pass").
  let outputsDir: string | undefined;
  const oi = args.findIndex((a) => a === "--outputs" || a.startsWith("--outputs="));
  if (oi !== -1) {
    const tok = args[oi] ?? "";
    const val = tok.startsWith("--outputs=") ? tok.slice("--outputs=".length) : args[oi + 1];
    if (val === undefined || val === "" || val.startsWith("-")) {
      throw new AiPipeError("E_BAD_USAGE", "eval: --outputs requires a directory", 2);
    }
    outputsDir = resolve(process.cwd(), val);
  }

  // Positionals: skip flags and the --outputs value (space form).
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
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe eval <evalsDir> [--outputs <dir>] [--verbose]", 2);
  }
  const dir = resolve(process.cwd(), positionals[0] as string);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new AiPipeError("E_BAD_USAGE", `eval: not a directory: ${dir}`, 2);
  }
  if (outputsDir !== undefined && (!existsSync(outputsDir) || !statSync(outputsDir).isDirectory())) {
    throw new AiPipeError("E_BAD_USAGE", `eval: --outputs not a directory: ${outputsDir}`, 2);
  }
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
  const seenNames = new Set<string>();

  for (const file of files) {
    let evalCase: EvalCase;
    try {
      evalCase = loadEvalCase(file);
    } catch (e) {
      invalid++;
      process.stdout.write(`✗ ${file}: ${errMsg(e)}\n`);
      continue;
    }
    if (seenNames.has(evalCase.name)) {
      invalid++;
      process.stdout.write(`✗ ${file}: duplicate case name "${evalCase.name}" (output would collide)\n`);
      continue;
    }
    seenNames.add(evalCase.name);

    if (outputsDir === undefined) {
      process.stdout.write(`✓ ${evalCase.name}: valid (metrics: ${Object.keys(evalCase.metric).join(", ")})\n`);
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
    // spec_path in the output is relative to the project root (cwd), not the
    // outputs dir holding the JSON.
    const results = checkMetrics(output, evalCase.metric, process.cwd());
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
