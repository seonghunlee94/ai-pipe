import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { errMsg, fileHash, hasFlag, readOptionValue, resolveTargetDir } from "./utils.js";

const tmpDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("errMsg", () => {
  it("returns the message of an Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg(42)).toBe("42");
    expect(errMsg(undefined)).toBe("undefined");
  });
});

describe("readOptionValue", () => {
  it("returns the value following the flag", () => {
    expect(readOptionValue(["--project", "/tmp/x"], "--project")).toBe("/tmp/x");
  });
  it("returns undefined when the flag is absent", () => {
    expect(readOptionValue(["--other", "y"], "--project")).toBeUndefined();
  });
  it("returns undefined when the flag is last with no value", () => {
    expect(readOptionValue(["--project"], "--project")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  it("detects a present flag", () => {
    expect(hasFlag(["--force"], "--force")).toBe(true);
  });
  it("is false when absent", () => {
    expect(hasFlag(["--other"], "--force")).toBe(false);
  });
});

describe("fileHash", () => {
  it("is deterministic and content-sensitive", () => {
    const dir = makeTmp("aipipe-hash-");
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "hello");
    writeFileSync(b, "hello");
    expect(fileHash(a)).toBe(fileHash(b));
    writeFileSync(b, "world");
    expect(fileHash(a)).not.toBe(fileHash(b));
    expect(fileHash(a)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("resolveTargetDir", () => {
  it("resolves '.' (undefined) to cwd", () => {
    expect(resolveTargetDir(undefined)).toBe(resolve(process.cwd(), "."));
  });
  it("resolves a relative arg against cwd", () => {
    expect(resolveTargetDir("sub")).toBe(resolve(process.cwd(), "sub"));
  });
  it("keeps an absolute arg", () => {
    expect(resolveTargetDir("/tmp/abs")).toBe(resolve("/tmp/abs"));
  });
});
