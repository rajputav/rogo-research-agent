# Notes

Focus: **answer quality and grounding** (an analyst has to be able to trust and check every number) and **latency / perceived latency**. Each change is its own commit on `improvements`; commit messages carry the detail.

## How I chose

- Added logging first (per-model-call time, tokens, stop reason, plus the draft vs. the editor's rewrite), then ran the five README questions and checked every figure in the answers against `data.ts` and the documents.
- What that showed:
  - The editor pass cost 25–40% of response time and 42–62% of input tokens, and it never fixed anything. It introduced one error ("FCF nearly doubled" for a 1.61x rise) and stripped precision and period labels.
  - Every numeric error came from the model doing math (CAGR, "accelerating", "more than doubled", "more than Initech's FY2021 revenue"). Figures copied straight from the data were right.
  - Answers mixed management's narrative with the data, without citing either. Unsourced claims ("moat", "gap is widening", "~2% FX drag") were stated as fact.

## Changes (in commit order)

1. **Run tool calls in parallel**: `Promise.all` over a turn's tool calls. Four lookups take ~0.8s instead of ~2.5s. Results stay in order, and each call catches its own errors.
2. **Observability**: each model call logs its time, tokens and stop reason, with a per-request summary line. Later (7), every line is tagged with a request id.
3. **Removed the editor pass**: a second model rewriting the answer with a style-only brief is a second author nobody checks. The model that saw the sources now writes the answer. Presentation guidance moved into the system prompt.
4. **Precomputed metrics** (`src/metrics.ts`): YoY growth, margins, and CAGR (full span and 3-year) are computed in code and attached to `getFinancials` results as `derived`, with unreported years excluded. The raw tool shape is unchanged. Deterministic math goes to code; judgment stays with the model. This is where the first tests came from.
5. **Grounding rules and inline citations** (system prompt):
   - cite every figure: `[Financials: TICKER FY]`, `[Profile: TICKER]`, `[DOC-ID]`
   - quote `derived` figures instead of calculating
   - check documents on growth and quality questions, and report both sides when documents and financials disagree
   - give a period for every figure
   - surface `warnings` and unfiled years
   - mark interpretation as "My read:"
   - state criteria for subjective questions
   - flag ambiguous names
6. **UI**:
   - Answers render as markdown (tables), with citations shown as source tags (a small rehype plugin).
   - Progress streams live (NDJSON over `fetch`, since `EventSource` is GET-only): steps like "Pulling Initech financials" show a running timer, then collapse into "Researched in 13.2s · 6 lookups", which expands to the full trace.
7. **Tool failures**:
   - Failures go back with `is_error: true` and a recovery hint. Unknown names suggest matches ("GLBX" → "Globex Inc"); ambiguous ones ("Acme") list both and tell the model to state its assumption; over-long document queries say to use 6 or fewer keywords.
   - Fixed a silent failure: an unknown company filter on `searchDocuments` returned `[]`, which reads as "no documents".
   - Unexpected exceptions aren't shown to the model.
8. **Request ids**: every log line is prefixed with a short id, so `grep <id>` gives one request's full trace. The id is returned to the UI and included in error messages.
9. **Prompt caching**: an explicit cache breakpoint on the system prompt, which also covers the tool definitions (~1.9k tokens, identical on every call), plus top-level automatic caching of the growing transcript. Cache read/write tokens are logged per call. Numbers below.
10. **Conversation memory** (text-only history) and a **New conversation** button:
    - The UI sends earlier questions and answers with each question, leaving out failed replies.
    - The server (`src/history.ts`) keeps complete Q&A exchanges only. Above 6 exchanges it drops the oldest in batches of 3, so the start of the history (and with it the cache prefix) stays the same for several turns rather than shifting every turn.
    - New prompt rule: earlier answers are context, not sources. Re-fetch before citing a figure again, or memory would bring back uncited numbers.
    - This makes the clarifying questions from (7) usable: "How fast is Acme growing?" → "Acme Corp" → "How does that compare to Globex?" works, and each turn re-fetches what it cites.
11. **Stream the answer text**: model calls use `messages.stream`, and text deltas go over the same NDJSON stream and render live. On Sonnet 5, the first answer text arrived at 3–5s instead of 13–19s.
12. **Switched the default model to `claude-sonnet-5-5`** (same price as Sonnet 5):
    - Better judgment on the same five questions:
      - flags the GLBX 1.9% (management) vs 1.1% (financials) gap unprompted
      - labels Umbrella's 9.6% as total, not organic, growth
      - offers like-for-like periods
      - marks guesses as guesses
    - Totals are 10.6–15.5s (Sonnet 5: 12.3–30.5s).
    - Added explicit handling for `stop_reason: "refusal"` (5.5 declines in more categories), which would otherwise have shown the "ran out of research steps" message.
    - Trade-off: it thinks before writing, so first answer text arrives at 9–12s, then streams in about 1s. Next step is to measure `output_config.effort: "medium"`, the recommended setting for multistep tool use. I didn't add server-side refusal fallbacks: they only retry cyber / frontier-LLM declines, which a company-research tool shouldn't hit.

## Results (five README questions, one run each)

| | Before | After |
|---|---|---|
| Response time | 21–42s | 13–18s (32s for GLBX vs ITCH, which now also checks documents) |
| Input tokens / request | 11–26k | 10–16k |
| Model calls / request | 3–4 | 2–3 |
| Numeric errors found | 6 | 1 copying error ("1.4%" for a derived 1.1%) |

- Answers now cite their sources, and every cited figure I checked matched its source.
- The agent flagged a real conflict on its own: Umbrella's earnings call says operating margin was 7.4% (down 20bps), while the financials show 8.4% (up).
- The tradeoff: citations make answers longer, so the slowest question got slower than right after the editor was removed (13s → 32s). For an analyst tool I think that's worth it.
- Tests: `npm test`, 23 tests covering metrics, tool errors, history trimming, citation rendering and progress steps. The agent loop itself isn't unit-tested (see below).

### Prompt caching: the calculation

Effective input cost = uncached ×1 + cache writes ×1.25 + cache reads ×0.1 (5-minute TTL), in tokens, over the same five questions:

| Question | Calls | No caching | Prefix + tail (shipped) | Prefix only (computed) |
|---|---|---|---|---|
| Acme vs Globex | 2 | 10.1k | 10.4k (+3%) | 6.7k |
| Umbrella risks | 3 | 7.6k | 2.4k (−69%) | 2.7k |
| Initech transition | 3 | 11.2k | 4.7k (−58%) | 5.9k |
| Fastest grower | 2 | 13.9k | 13.0k (−6%) | 10.5k |
| GLBX vs ITCH | 3 | 16.8k | 9.1k (−46%) | 11.8k |
| **Total** | | **59.5k** | **39.5k (−34%)** | **37.5k (−37%)** |

- Writing the tail costs 0.25x extra; reading it saves 0.9x. It pays off when there's more than a ~28% chance the next call reads it.
- Within a request, every call but the last gets read by the next one. The last call's write never is (on "fastest grower" that's 10k tokens of tool results), which is why 2-call questions break even or lose.
- **Why tail caching stays despite that:** with memory, each request's first call caches `[system + history + question]`, and the next turn starts with exactly that prefix. In the three-turn Acme conversation, turn 3's first call read 2,946 cached tokens, which is turn 2's prefix.
- **Correction to my first reasoning:** I initially expected memory to make the last call's write useful too. With text-only history it doesn't: the next turn sends the answer as text, not the tool calls and results, so the prefixes diverge after the question. That write is still wasted. Only full-transcript history would reuse it.
- Latency is essentially unchanged. Time is dominated by output (the 10–23s answer-writing call), and the cached prefixes (2–10k tokens) are small.

## Deliberately not done

- **Automatic number verifier** (check every figure in the answer against tool outputs). This is the next step for grounding, but matching units and rounding is fiddly. The remaining errors are this kind: one copying error, plus calling Globex's ~1.9% "organic growth" when the source says total growth.
- **Comparing document claims with data in code**: e.g. putting management's "~1.9%" next to the derived 3-year CAGR (1.1%). The prompt rule gets the model to report both, but not always to point out the gap.
- **Streaming the answer text** (`messages.stream`). The answer-writing call is most of the wait (often 10s+), so this is the biggest remaining perceived-latency win.
- **Cancel on disconnect**: if the browser leaves, the agent runs to completion. That needs an `AbortController` passed through `runAgent`.
- **Full-transcript memory** (design B): keep each turn's tool calls and results on the server, keyed by conversation id. Follow-ups could reuse fetched data instead of re-fetching (~0.8s per lookup), and the last call's cache write would be read on the next turn. The costs: a session store with expiry, much faster token growth (one `getFinancials` result is ~2–3k tokens), and it's the production answer for trust, since the client can currently send fabricated "assistant" turns. Text-only history was enough for now.
- **Summarizing long conversations** rather than dropping old exchanges (or server-side compaction). Six exchanges is plenty for an analyst's session.
- **Agent loop tests / evals**: these need a mocked Anthropic client or a recorded-response harness. For now I checked by hand against `data.ts` across the README questions, which won't scale.
- **Other observations**:
  - The quarterly figures in `data.ts` are a fixed seasonal split of annual revenue, so any quarter-to-quarter claim is meaningless. Worth telling the model, or not exposing the quarterly figures.
  - `MAX_ITERATIONS` is 12 with a canned fallback. I haven't seen it hit.
- **`npm audit`** (4 issues) is untouched: all are in `concurrently`, `vite`/`postcss` (dev-only) and `express`'s `proxy-addr`, on a local-only server. Fixes are available; I'd apply them as a separate change rather than mix dependency upgrades into this work.
