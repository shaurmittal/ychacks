import { describe, expect, it } from "vitest";
import { aiCodeShare, normaliseLines } from "./aiShare";

describe("aiCodeShare", () => {
  it("is 0 for empty final code", () => {
    expect(aiCodeShare("", ["function f() { return 1; }"])).toBe(0);
    expect(aiCodeShare("  \n}\n", ["x"])).toBe(0);
  });
  it("is 0 with no AI blocks", () => {
    expect(aiCodeShare("const total = 0;", [])).toBe(0);
  });
  it("drops short lines, comments and lone braces", () => {
    expect(normaliseLines("function f(a) {\n  // comment\n  /* c */\n  return a + 1;\n}\n});\nx++\n")).toEqual([
      "function f(a) {",
      "return a + 1;",
    ]);
  });
  it("ignores whitespace differences", () => {
    const ai = "function twoSum(nums, target) {\n    const seen = new Map();\n    return [];\n}";
    const final = "function twoSum(nums,  target) {\n\tconst   seen = new Map();\n  for (const n of nums) count++;\n  return [];\n}";
    expect(aiCodeShare(final, [ai])).toBeCloseTo(3 / 4);
  });
  it("is 1 when fully copied", () => {
    const ai = "function f(x) {\n  return x * 2;\n}";
    expect(aiCodeShare(ai, ["unrelated block here", ai])).toBe(1);
  });
});
