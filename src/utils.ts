import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { parseArgs } from "node:util";

import { AiPipeError } from "./errors.js";

// Unified CLI arg parsing on node:util's parseArgs (stdlib — keeps the
// zero-runtime-dep posture). strict:true makes a mistyped flag a LOUD
// E_BAD_USAGE instead of a silently-ignored token — the bug class that once
// ate `upgrade --version`'s directory. Note: `pipeline` deliberately does NOT
// use this (it takes values that may start with `-`, e.g. negative numbers,
// which an option parser would reject; see pipeline/commands.ts).
export type FlagSpec = Record<string, { type: "boolean" | "string" }>;

export function parseCommandArgs(
  cmd: string,
  args: string[],
  options: FlagSpec,
): { values: Record<string, string | boolean | undefined>; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
    return { values: values as Record<string, string | boolean | undefined>, positionals };
  } catch (e) {
    throw new AiPipeError("E_BAD_USAGE", `${cmd}: ${errMsg(e)}`, 2);
  }
}

// Narrow an unknown thrown value to a message string, matching the repo's
// instanceof-narrowing convention (cli.ts/utils.ts) rather than `as Error` casts.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Spec §9.2: SHA256 hash for file change detection (timestamps are unreliable).
export function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// Locate the package root by walking up from this file (works whether installed
// globally via npm or run from dist/ in dev). The package root contains both
// `package.json` and `template/`.
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "template"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new AiPipeError(
    "E_TEMPLATE_MISSING",
    `Could not locate package root (looked up from ${here}).`,
  );
}

export function templateDir(): string {
  return join(packageRoot(), "template", ".claude");
}

export interface PackageInfo {
  name: string;
  version: string;
}

export function readPackageInfo(): PackageInfo {
  const pkgPath = join(packageRoot(), "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const json: unknown = JSON.parse(raw);
  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as { name?: unknown }).name !== "string" ||
    typeof (json as { version?: unknown }).version !== "string"
  ) {
    throw new AiPipeError(
      "E_VERSION_PARSE",
      `package.json at ${pkgPath} is missing string "name"/"version" fields.`,
    );
  }
  const obj = json as { name: string; version: string };
  return { name: obj.name, version: obj.version };
}

export function resolveTargetDir(arg: string | undefined): string {
  return resolve(process.cwd(), arg ?? ".");
}
