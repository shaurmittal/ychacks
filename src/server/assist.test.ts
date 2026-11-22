import { describe, expect, it } from "vitest";
import { buildSystemPrompt, sanitiseMessages } from "./assistPrompt";

describe("sanitiseMessages", () => {
  it("drops leading assistant turns, empties and merges same-role runs", () => {
    expect(
      sanitiseMessages([
        { role: "assistant", content: "hi" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "  " },
        { role: "system", content: "x" },
        { role: "assistant", content: "c" },
        { role: "user", content: "d" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
  });
  it("handles junk", () => {
    expect(sanitiseMessages(null)).toEqual([]);
    expect(sanitiseMessages([1, "x", { role: "user" }])).toEqual([]);
  });
});

describe("buildSystemPrompt", () => {
  it("includes statement, policy and truncates code to 6 KB", () => {
    const p = buildSystemPrompt("STATEMENT", "a".repeat(10_000), "hints");
    expect(p).toContain("STATEMENT");
    expect(p).toContain("Assistance policy: hints");
    expect(p).toContain("(truncated)");
    expect(p.length).toBeLessThan(8000);
  });
});
