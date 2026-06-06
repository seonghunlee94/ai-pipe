import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GITIGNORE_MARKER } from "./local-files.js";
import { runInit } from "./init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aipipe-init-"));
  // init prints next-steps to stdout; keep test output clean.
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("installs the .claude tree, version stamp, and gitignore block", async () => {
    await runInit([dir]);
    const claude = join(dir, ".claude");
    expect(existsSync(join(claude, "config", "pipeline.json"))).toBe(true);
    expect(existsSync(join(claude, "rules", "project-settings.md"))).toBe(true);
    expect(existsSync(join(claude, ".dev-pipe-version"))).toBe(true);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain(GITIGNORE_MARKER);
    expect(gitignore).toContain(".artifacts/");
  });

  it("refuses to overwrite without --force", async () => {
    await runInit([dir]);
    await expect(runInit([dir])).rejects.toMatchObject({ code: "E_TARGET_EXISTS" });
  });

  it("does not duplicate the gitignore block on --force re-init", async () => {
    await runInit([dir]);
    await runInit([dir, "--force"]);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    const occurrences = gitignore.split(GITIGNORE_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("appends the block to a pre-existing .gitignore without clobbering it", async () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n*.log\n");
    await runInit([dir]);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("*.log");
    expect(gitignore.split(GITIGNORE_MARKER).length - 1).toBe(1);
    expect(gitignore).toContain(".artifacts/");
  });

  it("preserves a customized LOCAL_FILE on --force", async () => {
    await runInit([dir]);
    const settings = join(dir, ".claude", "rules", "project-settings.md");
    writeFileSync(settings, "MY CUSTOM SETTINGS\n");
    await runInit([dir, "--force"]);
    expect(readFileSync(settings, "utf8")).toBe("MY CUSTOM SETTINGS\n");
  });
});
