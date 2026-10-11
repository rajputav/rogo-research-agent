# Notes

Focus: **answer grounding** (an analyst must be able to trust and check every number) and **latency**. Each change is its own commit; the commit messages have the detail and measurements. The longer write-up is in [`LONG_NOTES.md`](LONG_NOTES.md). How this was built (Claude Code setup) is in [`HARNESS.md`](HARNESS.md).

**How I chose:** I added logging, then ran the five README questions and checked every figure against `data.ts`. The editor pass cost ~30% of response time and ~50% of input tokens and fixed nothing. Every numeric error came from the model doing arithmetic. Answers mixed management's narrative with the data and cited nothing.

## Changes

1. **Parallel tool calls**: one turn's lookups take ~0.8s instead of ~2.5s.
2. **Logging**: per-call time, tokens and cache use; a request id on every line.
3. **Removed the editor pass**: it rewrote the answer without checking anything. It added an error and dropped precision.
4. **Metrics computed in code** (`metrics.ts`): growth, CAGR and margins are attached to `getFinancials`, so the model quotes figures instead of calculating them.
5. **Grounding rules**: an inline citation on every figure; report both sides when documents and financials disagree; a period on every figure; surface warnings and unfiled years; label interpretation.
6. **UI**: markdown answers with citation tags; live progress steps with timers, which collapse into a trace you can expand; the answer streams as it's written.
7. **Tool failures**: returned with `is_error` and a recovery hint ("GLBX" → "Globex Inc", ambiguous "Acme"). Fixed a silent `[]` for an unknown company filter, which read as "no documents".
8. **Prompt caching** and **conversation memory** (text-only history, New conversation button). See below.
9. **Model → `claude-sonnet-5-5`** (same price): better judgment, e.g. it now flags the GLBX 1.9% vs 1.1% gap unprompted. Refusals are now handled explicitly.

## Results (five README questions, one run each)

| | Starter | Now |
|---|---|---|
| Response time | 21–42s | 11–16s (first answer text at 9–12s) |
| Numeric errors found | 6 | none in spot checks |
| Sources | none cited | every figure cited; doc vs data conflicts flagged (e.g. Umbrella margin 7.4% vs 8.4%) |
| Tests | 0 | 23 (metrics, tool errors, history, citations, progress) |

## Prompt caching: cost

Effective input cost = uncached ×1 + writes ×1.25 + reads ×0.1, in tokens (measured on Sonnet 5):

| Question | Calls | No caching | Prefix + tail (shipped) | Prefix only |
|---|---|---|---|---|
| Acme vs Globex | 2 | 10.1k | 10.4k (+3%) | 6.7k |
| Umbrella risks | 3 | 7.6k | 2.4k (−69%) | 2.7k |
| Initech transition | 3 | 11.2k | 4.7k (−58%) | 5.9k |
| Fastest grower | 2 | 13.9k | 13.0k (−6%) | 10.5k |
| GLBX vs ITCH | 3 | 16.8k | 9.1k (−46%) | 11.8k |
| **Total** | | **59.5k** | **39.5k (−34%)** | **37.5k (−37%)** |

- A tail write pays off if the next call reads it, which happens inside the loop. The last call's write is never read, so 2-call questions break even.
- I kept the tail breakpoint for memory: each request's first call caches `[system + history + question]`, and the next turn reads it (2,946 tokens in a 3-turn test). The last call's write stays wasted with text-only history.
- Latency barely changed: the wait is output-bound.

## Memory: text-only vs full transcript

| | Text-only (shipped) | Full transcript on the server |
|---|---|---|
| Server | Stateless | Session store with expiry |
| Context per exchange | ~1k tokens | ~3–10k tokens (tool results) |
| Follow-up data | Re-fetched (tokens; the delay is simulated and runs in parallel) | Already in context |
| Grounding | Cites only this turn's lookups ("earlier answers aren't sources") | Can cite any real lookup in the conversation |
| Caching | History prefix reused; last-call write wasted | Whole transcript reused |
| Trust | Client could forge "assistant" turns | Server-owned history |

Text-only was enough here. Full transcript is the production answer once tools are slow or expensive, or history must be trustworthy.

## Deliberately not done

- **Clickable source links**: citations exist, but you can't open the primary source to check it. This should exist.
- **Number verifier**: check each cited figure against tool outputs in code. Units and rounding make it fiddly.
- **Doc vs data comparison in code**: Sonnet 5.5 flags gaps reliably, but nothing guarantees it.
- **Effort tuning**: try `effort: "medium"` to bring first text below 9–12s.
- **Cancel on disconnect**: a closed tab still runs the agent to completion.
- **Agent loop tests / evals**: checked by hand against `data.ts`, which won't scale.
- **Quarterly data** is a fixed seasonal split of annual revenue; the model shouldn't compare quarters.
- **`npm audit`** (4 issues, dev tooling and a local-only server): fixes are available; they belong in a separate change.
