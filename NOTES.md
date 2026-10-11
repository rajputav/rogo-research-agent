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
- Tests: `npm test`, 19 tests covering metrics, tool errors, citation rendering and progress steps. The agent loop itself isn't unit-tested (see below).

## Deliberately not done

- **Automatic number verifier** (check every figure in the answer against tool outputs). This is the next step for grounding, but matching units and rounding is fiddly. The remaining errors are this kind: one copying error, plus calling Globex's ~1.9% "organic growth" when the source says total growth.
- **Comparing document claims with data in code**: e.g. putting management's "~1.9%" next to the derived 3-year CAGR (1.1%). The prompt rule gets the model to report both, but not always to point out the gap.
- **Streaming the answer text** (`messages.stream`). The answer-writing call is most of the wait (often 10s+), so this is the biggest remaining perceived-latency win.
- **Cancel on disconnect**: if the browser leaves, the agent runs to completion. That needs an `AbortController` passed through `runAgent`.
- **Conversation memory**: every question starts fresh, so follow-ups ("what about Acme Robotics?") don't work. That needs history passed from the UI, with token limits.
- **Agent loop tests / evals**: these need a mocked Anthropic client or a recorded-response harness. For now I checked by hand against `data.ts` across the README questions, which won't scale.
- **Other observations**:
  - The quarterly figures in `data.ts` are a fixed seasonal split of annual revenue, so any quarter-to-quarter claim is meaningless. Worth telling the model, or not exposing the quarterly figures.
  - Prompt caching on the system prompt and tool definitions would cut cost on multi-turn runs.
  - `MAX_ITERATIONS` is 12 with a canned fallback. I haven't seen it hit.
- **`npm audit`** (4 issues) is untouched: all are in `concurrently`, `vite`/`postcss` (dev-only) and `express`'s `proxy-addr`, on a local-only server. Fixes are available; I'd apply them as a separate change rather than mix dependency upgrades into this work.
