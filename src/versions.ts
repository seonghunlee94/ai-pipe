// TODO: spec §9.1 — list versions available on the registry.
//
// `ai-pipe versions` — query GitHub Packages (or npm registry) via
// `npm view @your-org/ai-pipe versions --json` and pretty-print.
// Useful for `ai-pipe upgrade --version` planning.

export async function runVersions(_args: string[]): Promise<void> {
  throw new Error("versions is a stub — see TODO in src/versions.ts and spec §9.1");
}
