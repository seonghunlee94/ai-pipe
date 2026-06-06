// spec §8.1 — `ai-pipe pipeline <subcommand>` reads/writes pipeline config.
//   pipeline show [<dir>]              — merged base + local view
//   pipeline get <key> [<dir>]         — read a dot-path value from the merge
//   pipeline set <key> <value> [<dir>] — write to pipeline.local.json (not base)
//
// Base = .claude/config/pipeline.json (template-managed, never written here).
// Local = .claude/config/pipeline.local.json (git-ignored overrides).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { AiPipeError } from "../errors.js";
import { errMsg, resolveTargetDir } from "../utils.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new AiPipeError("E_BAD_USAGE", `pipeline: invalid JSON in ${file}: ${errMsg(e)}`, 2);
  }
  if (!isObject(parsed)) {
    throw new AiPipeError("E_BAD_USAGE", `pipeline: ${file} is not a JSON object`, 2);
  }
  return parsed;
}

// Deep-merge local over base (objects merged recursively; arrays/scalars
// replaced). Built from scratch, copying only OWN non-forbidden keys: a
// hand-edited pipeline.local.json can carry an own "__proto__" key
// (JSON.parse creates it as a plain own property, never the setter), and
// blindly assigning it onto a normal object would re-point that object's
// prototype — same guard discipline as getPath/setPath below.
function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of [base, over]) {
    for (const k of Object.keys(src)) {
      if (FORBIDDEN_SEGMENTS.has(k)) continue;
      const v = src[k];
      const cur = out[k];
      out[k] = isObject(cur) && isObject(v) ? deepMerge(cur, v) : v;
    }
  }
  return out;
}

function configPaths(dir: string | undefined): { base: string; local: string } {
  const cfg = join(resolveTargetDir(dir), ".claude", "config");
  return { base: join(cfg, "pipeline.json"), local: join(cfg, "pipeline.local.json") };
}

// Reject prototype-pollution segments and inherited-key traversal.
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
function hasOwn(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function getPath(obj: Record<string, unknown>, dotKey: string): unknown {
  let cur: unknown = obj;
  for (const part of dotKey.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(part)) return undefined;
    if (!isObject(cur) || !hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, dotKey: string, value: unknown): void {
  const parts = dotKey.split(".");
  for (const p of parts) {
    if (FORBIDDEN_SEGMENTS.has(p)) {
      throw new AiPipeError("E_BAD_USAGE", `pipeline: forbidden key segment "${p}"`, 2);
    }
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    // Descend only into an OWN object property; otherwise (missing, inherited,
    // or a scalar intermediate) create a fresh own object — last-write-wins.
    if (!hasOwn(cur, part) || !isObject(cur[part])) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
}

export async function runPipeline(args: string[]): Promise<void> {
  // pipeline takes no flags; read args positionally so a value may start with
  // `-` (e.g. a negative number) without being mistaken for a flag.
  const sub = args[0];

  if (sub === "show") {
    const { base, local } = configPaths(args[1]);
    if (!existsSync(base)) {
      throw new AiPipeError("E_BAD_USAGE", `pipeline: no config at ${base} (run \`ai-pipe init\` first)`, 2);
    }
    const merged = deepMerge(readJson(base), readJson(local));
    process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
    return;
  }

  if (sub === "get") {
    const key = args[1];
    if (key === undefined) throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe pipeline get <key> [<dir>]", 2);
    const { base, local } = configPaths(args[2]);
    const merged = deepMerge(readJson(base), readJson(local));
    const val = getPath(merged, key);
    if (val === undefined) throw new AiPipeError("E_BAD_USAGE", `pipeline: key not found: ${key}`, 2);
    process.stdout.write((typeof val === "string" ? val : JSON.stringify(val)) + "\n");
    return;
  }

  if (sub === "set") {
    const key = args[1];
    const rawVal = args[2];
    if (key === undefined || rawVal === undefined) {
      throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe pipeline set <key> <value> [<dir>]", 2);
    }
    const { local } = configPaths(args[3]);
    // Parse the value as JSON when possible (numbers/booleans/objects), else string.
    let value: unknown;
    try {
      value = JSON.parse(rawVal);
    } catch {
      value = rawVal;
    }
    const localCfg = readJson(local);
    setPath(localCfg, key, value);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, JSON.stringify(localCfg, null, 2) + "\n", "utf8");
    process.stdout.write(`pipeline: set ${key} in ${local}\n`);
    return;
  }

  throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe pipeline <show|get|set> [...]", 2);
}
