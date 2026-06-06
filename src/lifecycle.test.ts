import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseOrg } from "./detect.js";
import { runDiff } from "./diff.js";
import { runInit } from "./init.js";
import { runMigrate } from "./conventions/migrate.js";
import { runPipeline } from "./pipeline/commands.js";
import { preflightChecks } from "./preflight.js";
import { scanTemplate } from "./template-sync.js";
import { runUpdate } from "./update.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aipipe-life-"));
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("scanTemplate", () => {
  it("classifies a fresh install as same/local (no new/changed/orphaned)", async () => {
    await runInit([dir]);
    const changes = scanTemplate(join(dir, ".claude"));
    const byStatus = (s: string) => changes.filter((c) => c.status === s).map((c) => c.path);
    expect(byStatus("new")).toEqual([]);
    expect(byStatus("changed")).toEqual([]);
    expect(byStatus("orphaned")).toEqual([]);
    expect(byStatus("local")).toContain("rules/project-settings.md");
    expect(byStatus("same")).toContain("config/pipeline.json");
  });

  it("detects changed, new, and orphaned files", async () => {
    await runInit([dir]);
    const claude = join(dir, ".claude");
    writeFileSync(join(claude, "config", "pipeline.json"), "{}"); // drift → changed
    rmSync(join(claude, "settings.local.json.example")); // present in template, absent here → new
    writeFileSync(join(claude, "config", "extra.json"), "{}"); // not in template, not local → orphaned
    const changes = scanTemplate(claude);
    const find = (p: string) => changes.find((c) => c.path === p)?.status;
    expect(find("config/pipeline.json")).toBe("changed");
    expect(find("settings.local.json.example")).toBe("new");
    expect(find("config/extra.json")).toBe("orphaned");
  });

  it("never classifies a LOCAL_FILE as changed even when it differs", async () => {
    await runInit([dir]);
    const claude = join(dir, ".claude");
    writeFileSync(join(claude, "rules", "project-settings.md"), "MY EDITS");
    const settings = scanTemplate(claude).find((c) => c.path === "rules/project-settings.md");
    expect(settings?.status).toBe("local");
  });
});

describe("runPipeline", () => {
  function configDir(): string {
    const cfg = join(dir, ".claude", "config");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, "pipeline.json"), JSON.stringify({ limits: { max_retries: 3 }, review: { depth: "standard" } }));
    return dir;
  }

  it("get reads a dot-path from the base config", async () => {
    configDir();
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (writes.push(String(s)), true));
    await runPipeline(["get", "limits.max_retries", dir]);
    expect(writes.join("")).toContain("3");
  });

  it("set writes to pipeline.local.json (not base) and get reflects the override", async () => {
    configDir();
    await runPipeline(["set", "limits.max_retries", "9", dir]);
    const local = JSON.parse(readFileSync(join(dir, ".claude", "config", "pipeline.local.json"), "utf8"));
    expect(local.limits.max_retries).toBe(9);
    // base untouched
    const base = JSON.parse(readFileSync(join(dir, ".claude", "config", "pipeline.json"), "utf8"));
    expect(base.limits.max_retries).toBe(3);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (writes.push(String(s)), true));
    await runPipeline(["get", "limits.max_retries", dir]);
    expect(writes.join("")).toContain("9");
  });

  it("set parses JSON values (number/bool) and falls back to string", async () => {
    configDir();
    await runPipeline(["set", "review.depth", "deep", dir]);
    await runPipeline(["set", "limits.max_test", "5", dir]);
    const local = JSON.parse(readFileSync(join(dir, ".claude", "config", "pipeline.local.json"), "utf8"));
    expect(local.review.depth).toBe("deep");
    expect(local.limits.max_test).toBe(5);
  });

  it("get throws on a missing key; bad subcommand throws", async () => {
    configDir();
    await expect(runPipeline(["get", "no.such.key", dir])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
    await expect(runPipeline(["frobnicate"])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
  });

  it("takes a value verbatim even when it starts with '-' (negative number)", async () => {
    configDir();
    await runPipeline(["set", "limits.min", "-5", dir]);
    const local = JSON.parse(readFileSync(join(dir, ".claude", "config", "pipeline.local.json"), "utf8"));
    expect(local.limits.min).toBe(-5);
  });

  it("blocks prototype-pollution segments (set throws, get returns not-found, proto intact)", async () => {
    configDir();
    await expect(runPipeline(["set", "__proto__.polluted", "true", dir])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    await expect(runPipeline(["get", "__proto__", dir])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
    await expect(runPipeline(["get", "constructor", dir])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
  });
});

describe("runUpdate", () => {
  it("dry-run reports drift without writing; --force applies and re-scan is clean", async () => {
    await runInit([dir]);
    const claude = join(dir, ".claude");
    const pj = join(claude, "config", "pipeline.json");
    writeFileSync(pj, "{}"); // drift the base config

    await runUpdate([dir]); // dry-run
    expect(readFileSync(pj, "utf8")).toBe("{}"); // not yet applied

    await runUpdate([dir, "--force"]);
    expect(scanTemplate(claude).filter((c) => c.status === "changed" || c.status === "new")).toEqual([]);
  });

  it("--force preserves a customized LOCAL file", async () => {
    await runInit([dir]);
    const settings = join(dir, ".claude", "rules", "project-settings.md");
    writeFileSync(settings, "MY EDITS");
    await runUpdate([dir, "--force"]);
    expect(readFileSync(settings, "utf8")).toBe("MY EDITS");
  });

  it("throws when there is no .claude install", async () => {
    await expect(runUpdate([join(dir, "nope")])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
  });
});

describe("runDiff", () => {
  it("renders drift with glyphs and a counts summary; --all includes same/local", async () => {
    await runInit([dir]);
    writeFileSync(join(dir, ".claude", "config", "pipeline.json"), "{}"); // drift
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (writes.push(String(s)), true));
    await runDiff([dir]);
    const out = writes.join("");
    expect(out).toContain("~ config/pipeline.json");
    expect(out).toMatch(/diff: 0 new, 1 changed, 0 orphaned/);
    expect(out).not.toContain("✓"); // same hidden without --all

    writes.length = 0;
    await runDiff([dir, "--all"]);
    const all = writes.join("");
    expect(all).toContain("✓"); // same shown
    expect(all).toContain("· rules/project-settings.md"); // local shown
  });

  it("throws when there is no .claude install (message keeps the command prefix)", async () => {
    await expect(runDiff([join(dir, "nope")])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
    await expect(runDiff([join(dir, "nope")])).rejects.toThrow(/^diff:/);
  });
});

describe("deepMerge prototype safety (via pipeline show/get on a hand-edited local)", () => {
  it("an own __proto__ key in pipeline.local.json is dropped, never re-points prototypes", async () => {
    const cfg = join(dir, ".claude", "config");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, "pipeline.json"), JSON.stringify({ limits: { max_retries: 3 } }));
    // JSON.parse creates __proto__ as a plain OWN property; the merge must skip it.
    writeFileSync(join(cfg, "pipeline.local.json"), '{"__proto__":{"polluted":true},"limits":{"max_retries":9}}');
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (writes.push(String(s)), true));
    await runPipeline(["show", dir]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    const merged = JSON.parse(writes.join(""));
    expect(merged.limits.max_retries).toBe(9); // override still applied
    expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(false);
  });
});

describe("preflightChecks", () => {
  it("reports node as a satisfied required tool (test runs on node >= 20)", () => {
    const node = preflightChecks().find((c) => c.name === "node");
    expect(node?.required).toBe(true);
    expect(node?.ok).toBe(true);
  });
});

describe("parseOrg", () => {
  it("extracts a filled org, rejects the placeholder", () => {
    expect(parseOrg("- **org**: my-real-org\n")).toBe("my-real-org");
    expect(parseOrg("- **org**: {{ORG}}\n")).toBeNull();
    expect(parseOrg("no org line here")).toBeNull();
  });
});

describe("runMigrate", () => {
  it("is a clean no-op when no migrations are defined", async () => {
    await expect(runMigrate([dir])).resolves.toBeUndefined();
  });
});
