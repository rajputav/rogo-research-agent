import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCitations } from "./citations.ts";
import { applyEvent, finishSteps, summarize, type Step, type StreamEvent } from "./progress.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
  steps?: Step[];
  summary?: string;
  /** Failed replies aren't sent back as conversation history. */
  failed?: boolean;
}

const STATUS_ICON: Record<Step["status"], string> = { running: "◌", done: "✓", failed: "✕" };

/** Current time, re-rendering every 100ms while `active` so running steps show a live counter. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function StepList({ steps }: { steps: Step[] }) {
  const now = useNow(steps.some((step) => step.status === "running"));

  return (
    <ol className="steps">
      {steps.map((step) => (
        <li key={step.id} className={`step ${step.status}`}>
          <span className="step-icon">{STATUS_ICON[step.status]}</span>
          <span className="step-label">
            {step.label}
            {step.detail && <span className="step-detail"> — {step.detail}</span>}
          </span>
          <span className="step-ms">
            {((step.ms ?? Math.max(0, now - step.startedAt)) / 1000).toFixed(1)}s
          </span>
        </li>
      ))}
    </ol>
  );
}

const EXAMPLES = [
  "Compare Acme and Globex and tell me which one appears to be growing faster.",
  "What are the biggest risks Umbrella Health flags in its filings?",
  "How is Initech's subscription transition going?",
  "Which company in the universe is growing fastest?",
];

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Step[]>([]);

  async function send(question: string) {
    if (!question.trim() || busy) return;

    // Earlier exchanges give follow-ups their context; the server validates and trims them.
    const history = messages
      .filter((message) => !message.failed)
      .map(({ role, text }) => ({ role, text }));

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    setProgress([]);

    let steps: Step[] = [];
    const startedAt = Date.now();
    let reply: Message;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history }),
      });
      if (!res.ok || !res.body) throw new Error(`server responded ${res.status}`);

      // The server streams one JSON event per line; the last line is "done" or "error".
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let last: StreamEvent | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          last = JSON.parse(line) as StreamEvent;
          steps = applyEvent(steps, last, Date.now());
          setProgress(steps);
        }
      }

      if (last?.type === "done") {
        reply = { role: "assistant", text: last.answer, steps, summary: summarize(steps, last.ms) };
      } else {
        const reason =
          last?.type === "error"
            ? `${last.message} (request ${last.requestId})`
            : `the response ended unexpectedly (request ${res.headers.get("X-Request-Id")})`;
        throw new Error(reason);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply = {
        role: "assistant",
        text: `Something went wrong: ${message}`,
        failed: true,
        steps: finishSteps(steps, Date.now()),
        summary: `Stopped after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      };
    }

    setMessages((prev) => [...prev, reply]);
    setBusy(false);
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Rogo Research</h1>
          <p>Ask a question about a company in our coverage universe.</p>
        </div>
        <button
          className="new-conversation"
          onClick={() => setMessages([])}
          disabled={busy || messages.length === 0}
        >
          New conversation
        </button>
      </header>

      <div className="transcript">
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, i) =>
          message.role === "assistant" ? (
            <div key={i} className="bubble assistant markdown">
              {message.steps && message.steps.length > 0 && (
                <details className="trace">
                  <summary>{message.summary}</summary>
                  <StepList steps={message.steps} />
                </details>
              )}
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCitations]}>
                {message.text}
              </Markdown>
            </div>
          ) : (
            <div key={i} className="bubble user">
              {message.text}
            </div>
          ),
        )}

        {busy && (
          <div className="bubble assistant pending">
            {progress.length === 0 ? "Starting research…" : <StepList steps={progress} />}
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a research question…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
