import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AiPipeError } from "./errors.js";
import { parseCommandArgs, readPackageInfo, resolveTargetDir } from "./utils.js";

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
  const cli = parseSemver(cliVersion);
  const proj = parseSemver(projectVersion);
  if (cli.major !== proj.major) return "major-mismatch";
  if (cli.minor - proj.minor >= 2) return "minor-lag";
  return "out-of-sync";
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): Semver {
  const parts = v.trim().split(".");
  if (parts.length < 3) {
    throw new AiPipeError("E_VERSION_PARSE", `Unparseable version: "${v}"`);
  }
  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  // Strip prerelease tag from patch ("1-rc.1" → "1") before parsing.
  const patchRaw = (parts[2] ?? "").split("-")[0] ?? "";
  const patch = Number.parseInt(patchRaw, 10);
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    throw new AiPipeError("E_VERSION_PARSE", `Unparseable version: "${v}"`);
  }
  return { major, minor, patch };
}

export async function runVersion(args: string[]): Promise<void> {
  const { values } = parseCommandArgs("version", args, { project: { type: "string" } });
  const projectVal = values.project;
  const projectPath = typeof projectVal === "string" ? projectVal : undefined;
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
