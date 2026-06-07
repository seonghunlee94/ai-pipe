// spec §13.3 — verify required external tools are present before init/run.
// Required: node >= 20, npm, git, gh, jq, bash. Optional: rclone (cloud sync).
// Exit 1 if a REQUIRED tool is missing/too old; 0 otherwise (optional tools
// only warn). Exposed as a library fn so init/other commands can reuse it.

import { execFileSync } from "node:child_process";

import { AiPipeError } from "./errors.js";
import { errMsg, parseCommandArgs } from "./utils.js";

export interface ToolCheck {
  readonly name: string;
  readonly required: boolean;
  readonly ok: boolean;
  readonly detail: string;
}

function probe(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

export function preflightChecks(): ToolCheck[] {
  const checks: ToolCheck[] = [];

  // node — required, >= 20 (from process, no subprocess needed)
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "node",
    required: true,
    ok: major >= 20,
    detail: major >= 20 ? `v${process.versions.node}` : `v${process.versions.node} (need >= 20)`,
  });

  const simple: { name: string; required: boolean; args: string[] }[] = [
    { name: "npm", required: true, args: ["--version"] },
    { name: "git", required: true, args: ["--version"] },
    { name: "bash", required: true, args: ["--version"] },
    { name: "jq", required: true, args: ["--version"] },
    { name: "gh", required: true, args: ["--version"] },
    { name: "rclone", required: false, args: ["version"] },
  ];
  for (const t of simple) {
    const out = probe(t.name, t.args);
    checks.push({
      name: t.name,
      required: t.required,
      ok: out !== null,
      detail: out !== null ? out.split("\n")[0] ?? "present" : "not found",
    });
  }
  return checks;
}

export async function runPreflight(args: string[]): Promise<void> {
  const { positionals } = parseCommandArgs("preflight", args, {});
  if (positionals.length > 0) {
    throw new AiPipeError("E_BAD_USAGE", "usage: ai-pipe preflight", 2);
  }
  let checks: ToolCheck[];
  try {
    checks = preflightChecks();
  } catch (e) {
    throw new AiPipeError("E_BAD_USAGE", `preflight failed: ${errMsg(e)}`, 2);
  }
  for (const c of checks) {
    const tag = c.ok ? "✓" : c.required ? "✗" : "○";
    const req = c.required ? "required" : "optional";
    process.stdout.write(`${tag} ${c.name.padEnd(8)} ${req.padEnd(9)} ${c.detail}\n`);
  }
  const missingRequired = checks.filter((c) => c.required && !c.ok);
  if (missingRequired.length > 0) {
    throw new AiPipeError(
      "E_VALIDATION",
      `preflight: ${missingRequired.length} required tool(s) missing: ${missingRequired.map((c) => c.name).join(", ")}`,
      1,
    );
  }
  process.stdout.write("preflight: all required tools present\n");
}
