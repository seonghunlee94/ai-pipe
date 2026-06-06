import { describe, expect, it } from "vitest";

import { AiPipeError } from "./errors.js";
import { checkVersionSync } from "./version.js";

describe("checkVersionSync", () => {
  it("not-installed when project has no version", () => {
    expect(checkVersionSync("1.2.3", null)).toBe("not-installed");
  });
  it("in-sync on exact match", () => {
    expect(checkVersionSync("1.2.3", "1.2.3")).toBe("in-sync");
  });
  it("major-mismatch on differing major", () => {
    expect(checkVersionSync("2.0.0", "1.9.0")).toBe("major-mismatch");
  });
  it("minor-lag when CLI leads by >= 2 minor", () => {
    expect(checkVersionSync("1.4.0", "1.2.9")).toBe("minor-lag");
  });
  it("out-of-sync on a small patch/minor drift", () => {
    expect(checkVersionSync("1.2.4", "1.2.3")).toBe("out-of-sync");
    expect(checkVersionSync("1.3.0", "1.2.0")).toBe("out-of-sync");
  });
  it("handles prerelease patch tags via exact-match short-circuit", () => {
    expect(checkVersionSync("1.2.3-rc.1", "1.2.3-rc.1")).toBe("in-sync");
  });
  it("parses prerelease patch when comparing different versions", () => {
    // differing versions force parseSemver; prerelease tag stripped from patch
    expect(checkVersionSync("1.2.3-rc.1", "1.2.0")).toBe("out-of-sync");
  });
  it("throws E_VERSION_PARSE on an unparseable version", () => {
    try {
      checkVersionSync("not-a-version", "1.2.0");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AiPipeError);
      expect((e as AiPipeError).code).toBe("E_VERSION_PARSE");
    }
  });
});
