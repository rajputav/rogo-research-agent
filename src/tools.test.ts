import { describe, expect, it } from "vitest";
import { executeTool, ToolError, unknownCompany } from "./tools.ts";

describe("unknownCompany", () => {
  it("suggests the company for a ticker", () => {
    expect(unknownCompany("GLBX").message).toBe(
      'no company named "GLBX". Did you mean "Globex Inc" (GLBX)? Call again with that exact name.',
    );
  });

  it("suggests the company for a partial or differently cased name", () => {
    expect(unknownCompany("initech").message).toContain('Did you mean "Initech" (ITCH)?');
    expect(unknownCompany("Globex Corporation").message).toContain('Did you mean "Globex Inc" (GLBX)?');
  });

  it("lists every match for an ambiguous name", () => {
    expect(unknownCompany("Acme").message).toBe(
      '"Acme" matches more than one company: "Acme Corp" (ACME), "Acme Robotics" (ACMR). ' +
        "Call again with an exact name, and tell the analyst which one you assumed (or cover each).",
    );
  });

  it("lists the coverage universe when nothing matches", () => {
    expect(unknownCompany("Hooli").message).toMatch(
      /^no company named "Hooli" in the coverage universe\. Use an exact name: "Acme Corp" \(ACME\), .*"Umbrella Health" \(UMBR\)\.$/,
    );
  });
});

describe("executeTool failures", () => {
  it("rejects an unknown company filter on document search instead of returning nothing", async () => {
    const search = executeTool("searchDocuments", { query: "risk", company: "Umbrella" });
    await expect(search).rejects.toBeInstanceOf(ToolError);
    await expect(search).rejects.toThrow('Did you mean "Umbrella Health" (UMBR)?');
  });

  it("explains how to fix an over-long document query", async () => {
    await expect(
      executeTool("searchDocuments", { query: "what are the main risks for this company" }),
    ).rejects.toThrow("Retry with 6 or fewer keywords");
  });
});
