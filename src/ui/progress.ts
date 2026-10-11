/**
 * Turns the agent's streamed events into human-readable progress steps.
 */

import type { AgentEvent } from "../agent.ts";

export interface Step {
  id: string;
  kind: "model" | "tool";
  label: string;
  status: "running" | "done" | "failed";
  /** Client clock (ms) when the step started, for a live elapsed counter. */
  startedAt: number;
  ms?: number;
  detail?: string;
}

/** Lines the server streams: agent events, then one "done" or "error" line. */
export type StreamEvent =
  | AgentEvent
  | { type: "done"; answer: string; ms: number; requestId: string }
  | { type: "error"; message: string; requestId: string };

export function toolLabel(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, string | undefined>;
  switch (name) {
    case "searchCompanies":
      return `Searching coverage for “${args.query}”`;
    case "getCompanyProfile":
      return `Reading ${args.company} profile`;
    case "getFinancials":
      return `Pulling ${args.company} financials`;
    case "searchDocuments":
      return args.company
        ? `Searching ${args.company} documents for “${args.query}”`
        : `Searching all documents for “${args.query}”`;
    default:
      return `Running ${name}`;
  }
}

const update = (steps: Step[], id: string, change: Partial<Step>) =>
  steps.map((step) => (step.id === id ? { ...step, ...change } : step));

/** `now` is when the event was received; new steps record it as their start time. */
export function applyEvent(steps: Step[], event: StreamEvent, now: number): Step[] {
  switch (event.type) {
    case "iteration":
      return [
        ...steps,
        {
          id: `model-${event.n}`,
          kind: "model",
          label: event.n === 1 ? "Planning research" : "Reviewing findings",
          status: "running",
          startedAt: now,
        },
      ];
    case "model_call": {
      // Model calls are sequential, so the running model step is the one that finished.
      const running = steps.find((s) => s.kind === "model" && s.status === "running");
      if (!running) return steps;
      return update(steps, running.id, {
        status: "done",
        ms: event.ms,
        ...(event.stopReason === "end_turn" ? { label: "Wrote the answer" } : {}),
      });
    }
    case "tool_start":
      return [
        ...steps,
        {
          id: event.id,
          kind: "tool",
          label: toolLabel(event.name, event.input),
          status: "running",
          startedAt: now,
        },
      ];
    case "tool_failed":
      return update(steps, event.id, { status: "failed", detail: event.message });
    case "tool_end": {
      const step = steps.find((s) => s.id === event.id);
      return update(steps, event.id, {
        status: step?.status === "failed" ? "failed" : "done",
        ms: event.ms,
      });
    }
    default:
      return steps;
  }
}

/** Marks steps still running when the request ended (e.g. on an error) as failed, freezing their time. */
export function finishSteps(steps: Step[], now: number): Step[] {
  return steps.map((step) =>
    step.status === "running"
      ? { ...step, status: "failed", ms: Math.max(0, now - step.startedAt), detail: "did not finish" }
      : step,
  );
}

/** One-line summary for a finished run, e.g. "Researched in 13.2s · 6 lookups". */
export function summarize(steps: Step[], ms: number): string {
  const tools = steps.filter((s) => s.kind === "tool");
  const failed = tools.filter((s) => s.status === "failed").length;
  const lookups = `${tools.length} lookup${tools.length === 1 ? "" : "s"}`;
  return `Researched in ${(ms / 1000).toFixed(1)}s · ${lookups}${failed ? ` · ${failed} failed` : ""}`;
}
