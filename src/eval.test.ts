import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AiPipeError } from "./errors.js";
import { checkMetrics, loadEvalCase, type Metric } from "./eval.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aipipe-eval-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeCase(name: string, body: unknown): string {
  const f = join(dir, `${name}.eval.json`);
  writeFileSync(f, JSON.stringify(body));
  return f;
}

describe("loadEvalCase", () => {
  it("parses a well-formed case", () => {
    const f = writeCase("ok", { name: "ok", input: "do x", metric: { status_in: ["success"] } });
    const c = loadEvalCase(f);
    expect(c.name).toBe("ok");
    expect(c.input).toBe("do x");
    expect(c.metric.status_in).toEqual(["success"]);
  });
  it("keeps the optional agent field when present, omits it otherwise", () => {
    const withAgent = loadEvalCase(writeCase("a", { name: "a", agent: "pm", input: "i", metric: {} }));
    expect(withAgent.agent).toBe("pm");
    const without = loadEvalCase(writeCase("b", { name: "b", input: "i", metric: {} }));
    expect(without.agent).toBeUndefined();
  });
  it("rejects malformed cases", () => {
    expect(() => loadEvalCase(writeCase("c", { input: "i", metric: {} }))).toThrow(AiPipeError);
    expect(() => loadEvalCase(writeCase("d", { name: "d", metric: {} }))).toThrow(/missing string "input"/);
    expect(() => loadEvalCase(writeCase("e", { name: "e", input: "i" }))).toThrow(/missing object "metric"/);
    const bad = join(dir, "f.eval.json");
    writeFileSync(bad, "{ not json");
    expect(() => loadEvalCase(bad)).toThrow(/invalid JSON/);
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
  it("downstream_notes_not_null: object passes, null/array/absent fail", () => {
    const m: Metric = { downstream_notes_not_null: true };
    expect(checkMetrics({ downstream_notes: { a: 1 } }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ downstream_notes: null }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({ downstream_notes: [] }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, base)[0]?.pass).toBe(false);
  });
  it("status_in: membership check", () => {
    const m: Metric = { status_in: ["success"] };
    expect(checkMetrics({ status: "success" }, m, base)[0]?.pass).toBe(true);
    expect(checkMetrics({ status: "failure" }, m, base)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, base)[0]?.pass).toBe(false);
  });
  it("spec_path_exists: resolves relative to baseDir", () => {
    writeFileSync(join(dir, "spec.md"), "x");
    const m: Metric = { spec_path_exists: true };
    expect(checkMetrics({ spec_path: "spec.md" }, m, dir)[0]?.pass).toBe(true);
    expect(checkMetrics({ spec_path: "missing.md" }, m, dir)[0]?.pass).toBe(false);
    expect(checkMetrics({}, m, dir)[0]?.pass).toBe(false);
  });
  it("flags an unknown metric key as a failure (not a silent pass)", () => {
    const r = checkMetrics({}, { typo_metric: 1 } as Metric, base);
    expect(r).toHaveLength(1);
    expect(r[0]?.pass).toBe(false);
    expect(r[0]?.detail).toMatch(/unknown metric/);
  });
  it("a non-object output fails all metrics rather than throwing", () => {
    const m: Metric = { req_ids_min: 1, status_in: ["success"] };
    const r = checkMetrics(null, m, base);
    expect(r.every((x) => !x.pass)).toBe(true);
  });
});
