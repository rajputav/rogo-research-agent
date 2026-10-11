import "dotenv/config";
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
  console.log(`\n[chat] ${message}`);

  const startedAt = Date.now();
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await runAgent(message, (event) => {
      switch (event.type) {
        case "iteration":
          console.log(`[agent] iteration ${event.n}`);
          break;
        case "model_call":
          modelCalls++;
          inputTokens += event.inputTokens;
          outputTokens += event.outputTokens;
          console.log(
            `[model] ${event.label.padEnd(12)} ${(event.ms / 1000).toFixed(1)}s  ` +
              `in=${event.inputTokens.toLocaleString()} out=${event.outputTokens.toLocaleString()}  ` +
              `stop=${event.stopReason}`,
          );
          break;
        case "answer":
          console.log(`\n──── answer ────\n${event.text}\n`);
          break;
        case "tool_start":
          toolCalls++;
          console.log(`[tool]  → ${event.name} ${JSON.stringify(event.input)}`);
          break;
        case "tool_end":
          console.log(`[tool]  ← ${event.name} (${event.ms}ms)`);
          break;
        case "tool_failed":
          console.log(`[tool]  ! ${event.name}: ${event.message}`);
          break;
      }
    });

    console.log(
      `[done]  total ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ` +
        `${modelCalls} model calls · ${toolCalls} tools · ` +
        `in=${inputTokens.toLocaleString()} out=${outputTokens.toLocaleString()}`,
    );

    res.json({ answer: result.answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});
