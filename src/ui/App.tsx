import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCitations } from "./citations.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
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

  async function send(question: string) {
    if (!question.trim() || busy) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer ?? data.error },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Something went wrong: ${String(err)}` },
      ]);
    }

    setBusy(false);
  }

  return (
    <div className="app">
      <header>
        <h1>Rogo Research</h1>
        <p>Ask a question about a company in our coverage universe.</p>
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

        {busy && <div className="bubble assistant pending">Thinking…</div>}
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
