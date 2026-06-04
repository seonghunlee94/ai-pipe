// TODO: spec §11 — post-init / pre-run validation.
//
// Checks:
//   - All required template files present
//   - All JSON files parse (config/pipeline.json, settings.json, schemas/*.json)
//   - All .sh hooks pass `bash -n` syntax check
//   - project-settings.md placeholders are filled (no remaining {{PLACEHOLDER}})
//   - Agent files have valid YAML frontmatter
//
// Used both as a CLI command and as a library function called from init.ts.

export async function runValidate(_args: string[]): Promise<void> {
  throw new Error("validate is a stub — see TODO in src/validate.ts and spec §11");
}
