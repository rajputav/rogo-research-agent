import { describe, expect, it } from "vitest";
import { applyEvent, finishSteps, summarize, type Step, type StreamEvent } from "./progress.ts";

const run = (events: StreamEvent[]) =>
  events.reduce<Step[]>((steps, event) => applyEvent(steps, event, 1000), []);

const modelCall = (stopReason: string): StreamEvent => ({
  type: "model_call",
  label: "research",
  ms: 2000,
  inputTokens: 1,
  outputTokens: 1,
  stopReason,
});

describe("applyEvent", () => {
  it("tracks parallel tool calls of the same tool by id", () => {
    const steps = run([
      { type: "iteration", n: 1 },
      modelCall("tool_use"),
      { type: "tool_start", id: "a", name: "getFinancials", input: { company: "Acme Corp" } },
      { type: "tool_start", id: "b", name: "getFinancials", input: { company: "Globex Inc" } },
      { type: "tool_end", id: "b", name: "getFinancials", ms: 801 },
    ]);
    expect(steps.map((s) => [s.label, s.status, s.ms])).toEqual([
      ["Planning research", "done", 2000],
      ["Pulling Acme Corp financials", "running", undefined],
      ["Pulling Globex Inc financials", "done", 801],
    ]);
  });

  it("records when each step started", () => {
    let steps = applyEvent([], { type: "iteration", n: 1 }, 5000);
    steps = applyEvent(steps, { type: "tool_start", id: "a", name: "getFinancials", input: {} }, 7500);
    expect(steps.map((s) => s.startedAt)).toEqual([5000, 7500]);
  });

  it("keeps failed tools marked failed after they end", () => {
    const steps = run([
      { type: "tool_start", id: "a", name: "getCompanyProfile", input: { company: "Acme" } },
      { type: "tool_failed", id: "a", name: "getCompanyProfile", message: 'no profile found for "Acme"' },
      { type: "tool_end", id: "a", name: "getCompanyProfile", ms: 450 },
    ]);
    expect(steps[0]).toMatchObject({ status: "failed", ms: 450, detail: 'no profile found for "Acme"' });
  });

  it("relabels the model step that wrote the answer", () => {
    const steps = run([{ type: "iteration", n: 2 }, modelCall("end_turn")]);
    expect(steps[0].label).toBe("Wrote the answer");
  });
});

describe("finishSteps", () => {
  it("freezes steps left running when the request ended", () => {
    const steps = finishSteps(run([{ type: "iteration", n: 1 }]), 4000);
    expect(steps[0]).toMatchObject({ status: "failed", ms: 3000, detail: "did not finish" });
  });
});

describe("summarize", () => {
  it("counts lookups and failures", () => {
    const steps = run([
      { type: "tool_start", id: "a", name: "getFinancials", input: { company: "Initech" } },
      { type: "tool_start", id: "b", name: "searchDocuments", input: { query: "risk" } },
      { type: "tool_failed", id: "b", name: "searchDocuments", message: "too many terms" },
    ]);
    expect(summarize(steps, 13240)).toBe("Researched in 13.2s · 2 lookups · 1 failed");
  });
});
