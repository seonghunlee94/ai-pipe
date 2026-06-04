// TODO: spec §9.4 — upgrade global package + sync current project.
//
// Variants:
//   ai-pipe upgrade                   — npm install -g latest, then update .
//   ai-pipe upgrade --version X.Y.Z   — pin to specific version
//
// Difference vs `update`: this also touches the global npm install, not just
// the project's .claude/ tree.

export async function runUpgrade(_args: string[]): Promise<void> {
  throw new Error("upgrade is a stub — see TODO in src/upgrade.ts and spec §9.4");
}
