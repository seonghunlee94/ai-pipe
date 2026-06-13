import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateTree, type Problem } from "./validate.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aipipe-validate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function messages(problems: Problem[], level?: Problem["level"]): string[] {
  return problems.filter((p) => (level ? p.level === level : true)).map((p) => `${p.file}: ${p.message}`);
}

describe("validateTree", () => {
  it("returns no problems for a clean tree", () => {
    write("config.json", '{"ok":true}');
    write("agents/pm.md", "---\nname: pm\ndescription: does pm\n---\nbody\n");
    write("skills/x/SKILL.md", "---\nname: x\ndescription: does x\n---\nbody\n");
    expect(validateTree(root)).toEqual([]);
  });

  it("flags invalid JSON as an error", () => {
    write("bad.json", "{ not json ,,, }");
    const errs = messages(validateTree(root), "error");
    expect(errs.some((m) => m.startsWith("bad.json") && m.includes("invalid JSON"))).toBe(true);
  });

  it("requires both name and description in a definition file", () => {
    write("agents/noname.md", "---\ndescription: x\n---\n");
    write("agents/nodesc.md", "---\nname: y\n---\n");
    const errs = messages(validateTree(root), "error");
    expect(errs.some((m) => m.includes("noname.md") && m.includes("`name:`"))).toBe(true);
    expect(errs.some((m) => m.includes("nodesc.md") && m.includes("`description:`"))).toBe(true);
  });

  it("accepts a `description: |` block scalar", () => {
    write("agents/ok.md", "---\nname: ok\ndescription: |\n  multi\n  line\n---\n");
    expect(validateTree(root)).toEqual([]);
  });

  it("does NOT require frontmatter on bundled reference markdown under skills/", () => {
    write("skills/x/SKILL.md", "---\nname: x\ndescription: d\n---\n");
    write("skills/x/reference.md", "just notes, no frontmatter\n");
    expect(validateTree(root)).toEqual([]);
  });

  it("flags unfilled placeholders by default but not with {placeholders:false}", () => {
    write("rules/project-settings.md", "# Settings\n- org: {{ORG}}\n");
    expect(messages(validateTree(root), "error").some((m) => m.includes("PLACEHOLDER"))).toBe(true);
    expect(validateTree(root, { placeholders: false })).toEqual([]);
  });

  it("exempts template/ files from the placeholder check", () => {
    write("template/rules/project-settings.md", "- org: {{ORG}}\n");
    expect(messages(validateTree(root), "error")).toEqual([]);
  });

  it("runs bash -n on hooks: flags a syntax error, passes clean scripts", () => {
    write("hooks/bad.sh", "#!/bin/bash\nif true; then echo x\n"); // unterminated if
    write("hooks/ok.sh", "#!/bin/bash\necho ok\n");
    write("src/notahook.sh", "#!/bin/bash\nif true; then echo x\n"); // not under hooks/ → skipped
    const errs = messages(validateTree(root), "error");
    expect(errs.some((m) => m.startsWith("hooks/bad.sh") && m.includes("bash -n failed"))).toBe(true);
    expect(errs.some((m) => m.startsWith("hooks/ok.sh"))).toBe(false);
    expect(errs.some((m) => m.includes("notahook.sh"))).toBe(false);
  });

  it("warns on a leftover org placeholder but not on a real org name", () => {
    // Fixtures built from parts so the README §0 sed sweep can't rewrite them
    // (same sweep-proofing as ORG_PLACEHOLDER in validate.ts — a rewritten
    // fixture would keep the test green while the detector was broken).
    write("pub.json", `{"repo":"github.com/${"your-" + "org"}/x"}`);
    write("ok.json", `{"repo":"${"your-" + "organization"}-name"}`);
    const warns = messages(validateTree(root), "warn");
    expect(warns.some((m) => m.startsWith("pub.json"))).toBe(true);
    expect(warns.some((m) => m.startsWith("ok.json"))).toBe(false);
  });

  it("warns on the org placeholder in a .ts file (slash form) and .npmrc (colon scope form) (N27)", () => {
    // Built from parts (sweep-proof) — see the json fixture above. The .npmrc
    // uses the REAL scope-route form `@your-org:registry` (colon, no slash) —
    // exactly the leak the slash-only check once missed; the [/:] matcher
    // catches it.
    write("src/init.ts", `const url = "github:${"your-" + "org"}/ai-pipe";\n`);
    write(".npmrc", `@${"your-" + "org"}:registry=https://npm.pkg.github.com\n`);
    const warns = messages(validateTree(root), "warn");
    expect(warns.some((m) => m.startsWith("src/init.ts"))).toBe(true);
    expect(warns.some((m) => m.startsWith(".npmrc"))).toBe(true);
  });

  it("does NOT flag a real org that merely starts with the placeholder stem (N27)", () => {
    // `your-organization` has no `/` or `:` right after `your-org`, so the
    // delimiter-anchored matcher must not false-positive — in a .ts this time.
    write("src/real.ts", `const scope = "@${"your-" + "organization"}/pkg";\n`);
    const warns = messages(validateTree(root), "warn");
    expect(warns.some((m) => m.startsWith("src/real.ts"))).toBe(false);
  });

  it("does NOT self-flag the detector's own source (basename exempt, N27)", () => {
    // A file named validate.ts may legitimately contain the placeholder string
    // (it IS the detector). Same for its test. Must not warn.
    write("src/validate.ts", `// matches ${"your-" + "org"}/ in this comment\n`);
    write("src/validate.test.ts", `const f = "${"your-" + "org"}/x";\n`);
    const warns = messages(validateTree(root), "warn");
    expect(warns.some((m) => m.startsWith("src/validate.ts"))).toBe(false);
    expect(warns.some((m) => m.startsWith("src/validate.test.ts"))).toBe(false);
  });

  it("exempts template/ .ts files from the placeholder check (N27)", () => {
    write("template/x.ts", `const u = "${"your-" + "org"}/y";\n`);
    const warns = messages(validateTree(root), "warn");
    expect(warns.some((m) => m.includes("x.ts"))).toBe(false);
  });
});
