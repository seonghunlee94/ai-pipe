import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkMetrics, loadEvalCase, runEval, type Metric } from "./eval.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aipipe-eval-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function writeCase(name: string, body: unknown): string {
  const f = join(dir, `${name}.eval.json`);
  writeFileSync(f, JSON.stringify(body));
  return f;
}

describe("loadEvalCase", () => {
  it("parses a well-formed case", () => {
    const c = loadEvalCase(writeCase("ok", { name: "ok", input: "do x", metric: { status_in: ["success"] } }));
    expect(c.name).toBe("ok");
    expect(c.metric.status_in).toEqual(["success"]);
  });
  it("keeps the optional agent field when present, omits it otherwise", () => {
    const withAgent = loadEvalCase(writeCase("a", { name: "a", agent: "pm", input: "i", metric: { req_ids_min: 1 } }));
    expect(withAgent.agent).toBe("pm");
    const without = loadEvalCase(writeCase("b", { name: "b", input: "i", metric: { req_ids_min: 1 } }));
    expect(without.agent).toBeUndefined();
  });
  it("rejects structural problems", () => {
    expect(() => loadEvalCase(writeCase("c", { input: "i", metric: { req_ids_min: 1 } }))).toThrow(/missing string "name"/);
    expect(() => loadEvalCase(writeCase("d", { name: "d", metric: { req_ids_min: 1 } }))).toThrow(/missing string "input"/);
    expect(() => loadEvalCase(writeCase("e", { name: "e", input: "i" }))).toThrow(/missing object "metric"/);
    const bad = join(dir, "f.eval.json");
    writeFileSync(bad, "{ not json");
    expect(() => loadEvalCase(bad)).toThrow(/invalid JSON/);
  });
  it("rejects an empty metric (would vacuously pass)", () => {
    expect(() => loadEvalCase(writeCase("g", { name: "g", input: "i", metric: {} }))).toThrow(/no metrics/);
  });
  it("rejects an unknown metric key", () => {
    expect(() => loadEvalCase(writeCase("h", { name: "h", input: "i", metric: { typo: 1 } }))).toThrow(/unknown metric "typo"/);
  });
  it("rejects wrong metric value types", () => {
    expect(() => loadEvalCase(writeCase("i", { name: "i", input: "x", metric: { req_ids_min: "3" } }))).toThrow(/integer >= 0/);
    expect(() => loadEvalCase(writeCase("j", { name: "j", input: "x", metric: { status_in: "success" } }))).toThrow(/array of strings/);
    expect(() => loadEvalCase(writeCase("k", { name: "k", input: "x", metric: { spec_path_exists: "yes" } }))).toThrow(/boolean/);
    expect(() => loadEvalCase(writeCase("l", { name: "l", input: "x", metric: { status_in: [] } }))).toThrow(/non-empty/);
  });
  it("rejects unknown top-level keys (schema additionalProperties:false)", () => {
    expect(() => loadEvalCase(writeCase("m", { name: "m", input: "x", metric: { req_ids_min: 1 }, bogus: 1 }))).toThrow(/unknown top-level/);
  });
  it("loads the shipped seed case", () => {
    const seed = loadEvalCase(
      // resolve from this test file to the plugin seed
      new URL("../plugins/ai-pipe-core/shared/evals/pm-auth-spec.eval.json", import.meta.url).pathname,
    );
    expect(seed.name).toBe("pm-auth-spec");
    expect(Object.keys(seed.metric).length).toBeGreaterThan(0);
  });
});

describe("checkMetrics", () => {
  const base = "/tmp";
  it("req_ids_min: passes at or above the threshold, fails below", () => {
    const m: Metric = { req_ids_min: 3 };
    expect(checkMetrics({ req_ids: ["REQ-1", "REQ-2", "REQ-3"] }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ req_ids: ["REQ-1"] }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, base)[0]?.pass).toBe(false);
  });
  it("downstream_notes_not_null: object (incl. empty {}) passes, null/array/absent fail", () => {
    const m: Metric = { downstream_notes_not_null: true };
    expect(checkMetrics({ downstream_notes: { a: 1 } }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ downstream_notes: {} }, m, base)[0]?.pass).toBe(true); // empty object is allowed
    expect(checkMetrics({ downstream_notes: null }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({ downstream_notes: [] }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, base)[0]?.pass).toBe(false);
  });
  it("downstream_notes_not_null:false inverts the assertion", () => {
    const m: Metric = { downstream_notes_not_null: false };
    expect(checkMetrics({ downstream_notes: null }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ downstream_notes: { a: 1 } }, m, base)[0]?.pass).toBe(false);
  });
  it("status_in: membership check", () => {
    const m: Metric = { status_in: ["success"] };
    expect(checkMetrics({ status: "success" }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ status: "failure" }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, base)[0]?.pass).toBe(false);
  });
  it("spec_path_exists: resolves relative to baseDir, honors true and false", () => {
    writeFileSync(join(dir, "spec.md"), "x");
    expect(checkMetrics({ spec_path: "spec.md" }, { spec_path_exists: true }, dir)[0]?.pass).toBe(true);
    expect(checkMetrics({ spec_path: "missing.md" }, { spec_path_exists: true }, dir)[0]?.pass).toBe(false);
    expect(checkMetrics({ spec_path: "missing.md" }, { spec_path_exists: false }, dir)[0]?.pass).toBe(true);
  });
  it("flags an unknown metric key as a failure (not a silent pass)", () => {
    const r = checkMetrics({}, { typo_metric: 1 } as Metric, base);
    expect(r[0]?.pass).toBe(false);
    expect(r[0]?.detail).toMatch(/unknown metric/);
  });
  it("a non-object output fails all metrics rather than throwing", () => {
    expect(checkMetrics(null, { req_ids_min: 1, status_in: ["success"] }, base).every((x) => !x.pass)).toBe(true);
  });
});

describe("runEval", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  function caseFile(): void {
    writeCase("c1", { name: "c1", input: "i", metric: { status_in: ["success"], req_ids_min: 1 } });
  }

  it("validate-only: passes for a valid case dir", async () => {
    caseFile();
    await expect(runEval([dir])).resolves.toBeUndefined();
  });
  it("rejects a missing --outputs value (no silent downgrade)", async () => {
    caseFile();
    await expect(runEval([dir, "--outputs"])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
    await expect(runEval([dir, "--outputs", "--verbose"])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
  });
  it("rejects a non-existent --outputs dir (no false green)", async () => {
    caseFile();
    await expect(runEval([dir, "--outputs", join(dir, "nope")])).rejects.toMatchObject({ code: "E_BAD_USAGE" });
  });
  it("scores: passes when the output meets metrics, throws E_EVAL when it fails", async () => {
    caseFile();
    const out = mkdtempSync(join(tmpdir(), "aipipe-evalout-"));
    try {
      writeFileSync(join(out, "c1.json"), JSON.stringify({ status: "success", req_ids: ["REQ-1"] }));
      await expect(runEval([dir, "--outputs", out])).resolves.toBeUndefined();
      writeFileSync(join(out, "c1.json"), JSON.stringify({ status: "failure", req_ids: [] }));
      await expect(runEval([dir, "--outputs", out])).rejects.toMatchObject({ code: "E_EVAL" });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  it("flags a duplicate case name as invalid", async () => {
    writeCase("dup-a", { name: "same", input: "i", metric: { req_ids_min: 1 } });
    writeCase("dup-b", { name: "same", input: "i", metric: { req_ids_min: 1 } });
    await expect(runEval([dir])).rejects.toMatchObject({ code: "E_EVAL" });
  });
  it("accepts the --outputs=DIR equals form", async () => {
    caseFile();
    const out = mkdtempSync(join(tmpdir(), "aipipe-evalout-"));
    try {
      writeFileSync(join(out, "c1.json"), JSON.stringify({ status: "success", req_ids: ["REQ-1"] }));
      await expect(runEval([dir, `--outputs=${out}`])).resolves.toBeUndefined();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  it("an empty dir reports no cases and exits 0", async () => {
    await expect(runEval([dir])).resolves.toBeUndefined();
  });
  it("skips a case with no recorded output (exit 0), fails on non-JSON output", async () => {
    caseFile();
    const out = mkdtempSync(join(tmpdir(), "aipipe-evalout-"));
    try {
      await expect(runEval([dir, "--outputs", out])).resolves.toBeUndefined(); // skipped, no output
      writeFileSync(join(out, "c1.json"), "{ not json");
      await expect(runEval([dir, "--outputs", out])).rejects.toMatchObject({ code: "E_EVAL" });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  it("propagates a malformed case file as invalid (E_EVAL)", async () => {
    writeFileSync(join(dir, "broken.eval.json"), "{ not json");
    await expect(runEval([dir])).rejects.toMatchObject({ code: "E_EVAL" });
  });
});
