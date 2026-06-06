import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AiPipeError } from "./errors.js";
import { errMsg, fileHash, parseCommandArgs, resolveTargetDir } from "./utils.js";

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

describe("parseCommandArgs", () => {
  const spec = { force: { type: "boolean" as const }, out: { type: "string" as const } };
  it("parses booleans, valued flags (space and equals form), and positionals", () => {
    const a = parseCommandArgs("x", ["--force", "dir"], spec);
    expect(a.values.force).toBe(true);
    expect(a.positionals).toEqual(["dir"]);
    expect(parseCommandArgs("x", ["--out", "v", "dir"], spec).values.out).toBe("v");
    expect(parseCommandArgs("x", ["--out=v"], spec).values.out).toBe("v");
  });
  it("a positional may come before flags", () => {
    const a = parseCommandArgs("x", ["dir", "--force"], spec);
    expect(a.positionals).toEqual(["dir"]);
    expect(a.values.force).toBe(true);
  });
  it("throws E_BAD_USAGE (with the command prefix) on an unknown flag", () => {
    try {
      parseCommandArgs("mycmd", ["--typo"], spec);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AiPipeError);
      expect((e as AiPipeError).code).toBe("E_BAD_USAGE");
      expect((e as AiPipeError).message).toMatch(/^mycmd:/);
    }
  });
  it("throws E_BAD_USAGE when a valued flag is missing its value", () => {
    expect(() => parseCommandArgs("x", ["--out"], spec)).toThrow(AiPipeError);
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
