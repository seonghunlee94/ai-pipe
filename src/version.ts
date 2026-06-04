import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AiPipeError } from "./errors.js";
import { readOptionValue, readPackageInfo, resolveTargetDir } from "./utils.js";

export type VersionStatus =
  | "in-sync"
  | "not-installed"
  | "out-of-sync"
  | "minor-lag"
  | "major-mismatch";

// Spec §9.1: compare CLI version against the project's installed version.
export function checkVersionSync(cliVersion: string, projectVersion: string | null): VersionStatus {
  if (!projectVersion) return "not-installed";
  if (cliVersion === projectVersion) return "in-sync";
  const [cliMajor, cliMinor] = parseSemver(cliVersion);
  const [projMajor, projMinor] = parseSemver(projectVersion);
  if (cliMajor !== projMajor) return "major-mismatch";
  if (cliMinor - projMinor >= 2) return "minor-lag";
  return "out-of-sync";
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.trim().split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length < 3 || parts.some(Number.isNaN)) {
    throw new AiPipeError("E_VERSION_PARSE", `Unparseable version: "${v}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

export async function runVersion(args: string[]): Promise<void> {
  const projectPath = readOptionValue(args, "--project");
  const target = resolveTargetDir(projectPath);
  const versionFile = join(target, ".claude", ".dev-pipe-version");

  const cli = readPackageInfo();
  const projectVersion = existsSync(versionFile)
    ? readFileSync(versionFile, "utf8").trim()
    : null;

  const status = checkVersionSync(cli.version, projectVersion);

  process.stdout.write(
    `CLI:     ${cli.version}\n` +
      `Project: ${projectVersion ?? "(not installed)"}\n` +
      `Status:  ${status}\n`,
  );

  if (status === "major-mismatch" || status === "minor-lag") {
    process.exitCode = 1;
  }
}
