/**
 * The research agent: a tool-use loop over the mocked research tools.
 */

import Anthropic from "@anthropic-ai/sdk";
import { companies } from "./data.ts";
import { executeTool, toolSchemas } from "./tools.ts";

const MODEL = process.env.ROGO_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 12;

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Rogo Research, an assistant that answers questions about companies for financial analysts.

Use the tools to look up companies, profiles, financials and source documents. Answer the analyst's question.

Analysts act on your answers, so every claim must be traceable to a source:

- Cite every figure and factual claim inline, immediately after it:
  - getFinancials → [Financials: TICKER FY2025] (name the period the figure comes from)
  - getCompanyProfile or the coverage list below → [Profile: TICKER]
  - searchDocuments → the document id, e.g. [DOC-GLBX-002]
  In tables, cite in the cell or once per row.
- For growth rates, CAGR and margins, quote the figures in the \`derived\` block of getFinancials results rather than calculating your own. If you need a figure it doesn't provide, show the calculation.
- Treat getFinancials as the record for numbers and documents as management's account. For questions about growth or business quality, check the documents too. When the two disagree (e.g. a growth rate management quotes vs. the one in the financials), report both with their citations and point out the difference.
- State the fiscal period for every figure. If you compare different periods (e.g. one company's FY2025 with another's FY2024 because a year is unfiled), say so.
- Surface any \`warnings\` and unreported (null) years from tool results; never estimate a missing figure.
- Don't state anything the sources don't support. Your own interpretation is welcome but mark it as such (e.g. "My read:"), and don't invent numbers, trends or causes.
- For subjective questions (e.g. "better business"), state the criteria you're judging on.
- If a company name could match more than one company (e.g. "Acme"), say which you assumed or cover each.

Lead with the direct answer, then the supporting detail. Use a table when comparing companies or periods. Keep it concise and easy to scan.

Our coverage universe:
${companies
  .map(
    (c) =>
      `- ${c.name} (${c.ticker}) — ${c.sector}, HQ ${c.hq}, ${c.employees} employees. ${c.description}`,
  )
  .join("\n")}
`;

export type AgentEvent =
  | { type: "iteration"; n: number }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ms: number }
  | { type: "tool_failed"; id: string; name: string; message: string }
  | {
      type: "model_call";
      label: string;
      ms: number;
      inputTokens: number;
      outputTokens: number;
      stopReason: string | null;
    }
  | { type: "answer"; text: string };

export interface AgentResult {
  answer: string;
  iterations: number;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Calls the model and reports how long it took and how many tokens it used. */
async function timedCreate(
  label: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
  onEvent: (event: AgentEvent) => void,
): Promise<Anthropic.Message> {
  const startedAt = Date.now();
  const response = await client.messages.create(params);
  onEvent({
    type: "model_call",
    label,
    ms: Date.now() - startedAt,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  });
  return response;
}

export async function runAgent(
  question: string,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  let answer = "";
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onEvent({ type: "iteration", n: iterations });

    const response = await timedCreate(
      `research #${iterations}`,
      {
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: toolSchemas,
        messages,
      },
      onEvent,
    );

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      answer = textOf(response);
      break;
    }

    // Tool calls within a turn are independent, so run them concurrently.
    // Promise.all preserves order, keeping results aligned with the tool_use blocks.
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const startedAt = Date.now();
        onEvent({ type: "tool_start", id: use.id, name: use.name, input: use.input });

        let content: string;
        try {
          const output = await executeTool(use.name, use.input as Record<string, unknown>);
          content = JSON.stringify(output);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          content = `${use.name} returned: ${message}`;
          onEvent({ type: "tool_failed", id: use.id, name: use.name, message });
        }

        onEvent({ type: "tool_end", id: use.id, name: use.name, ms: Date.now() - startedAt });
        return { type: "tool_result", tool_use_id: use.id, content };
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  if (!answer) {
    answer =
      "I looked at a number of sources but ran out of research steps before I could pull the answer together. Try asking a narrower question.";
  }

  onEvent({ type: "answer", text: answer });

  return { answer, iterations };
}
