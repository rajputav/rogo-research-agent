# Harness

How this work was done, per the request to include any harness configuration.

- **Tool:** Claude Code (CLI), in this repo.
- **Model:** Claude Opus 5.5 (1M context) for the coding session. The app itself runs on `claude-sonnet-5-5` (see `src/agent.ts`).
- **Configuration:** no project CLAUDE.md, hooks or custom permission rules. Plugins that affected the work:
  - `superpowers`: process skills loaded at session start.
  - `explanatory-output-style`: Claude explained its implementation choices as it went.
  - The built-in `claude-api` skill was used to check SDK usage for prompt caching, streaming and the Sonnet 5.5 migration.
