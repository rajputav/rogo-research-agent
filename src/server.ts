import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { runAgent } from "./agent.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nANTHROPIC_API_KEY is not set.\nCopy .env.example to .env and add your key, then run `npm run dev` again.\n",
  );
  process.exit(1);
}

const app = express();
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const message = String(req.body.message ?? "");

  // Prefix every log line with a short request id so concurrent requests can be told apart
  // (`grep <id>` gives one request's full trace, answer included).
  const requestId = randomUUID().slice(0, 8);
  const log = (text: string) =>
    console.log(text.split("\n").map((line) => `[${requestId}] ${line}`).join("\n"));

  console.log();
  log(`[chat] ${message}`);

  const startedAt = Date.now();
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  // Stream progress to the UI as newline-delimited JSON, ending with a "done" or "error" line.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Request-Id", requestId);
  const send = (data: object) => res.write(`${JSON.stringify(data)}\n`);

  try {
    const result = await runAgent(message, (event) => {
      // The answer arrives in the final "done" line instead.
      if (event.type !== "answer") send(event);

      switch (event.type) {
        case "iteration":
          log(`[agent] iteration ${event.n}`);
          break;
        case "model_call":
          modelCalls++;
          inputTokens += event.inputTokens;
          outputTokens += event.outputTokens;
          log(
            `[model] ${event.label.padEnd(12)} ${(event.ms / 1000).toFixed(1)}s  ` +
              `in=${event.inputTokens.toLocaleString()} out=${event.outputTokens.toLocaleString()}  ` +
              `stop=${event.stopReason}`,
          );
          break;
        case "answer":
          log(`──── answer ────\n${event.text}`);
          break;
        case "tool_start":
          toolCalls++;
          log(`[tool]  → ${event.name} ${JSON.stringify(event.input)}`);
          break;
        case "tool_end":
          log(`[tool]  ← ${event.name} (${event.ms}ms)`);
          break;
        case "tool_failed":
          log(`[tool]  ! ${event.name}: ${event.message}`);
          break;
      }
    });

    log(
      `[done]  total ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ` +
        `${modelCalls} model calls · ${toolCalls} tools · ` +
        `in=${inputTokens.toLocaleString()} out=${outputTokens.toLocaleString()}`,
    );

    send({ type: "done", answer: result.answer, ms: Date.now() - startedAt, requestId });
  } catch (err) {
    log(`[error] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    send({ type: "error", message: String(err), requestId });
  }
  res.end();
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});
