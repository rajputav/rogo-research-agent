/**
 * Conversation history sent by the UI: earlier questions and answers, as text only
 * (no tool calls or results). Follow-ups re-fetch any data they cite.
 */

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/** Above this many exchanges, drop older ones in batches of TRIM_BATCH. */
export const MAX_EXCHANGES = 6;
export const TRIM_BATCH = 3;
const MAX_TEXT_CHARS = 20_000;

const isTurn = (value: unknown): value is HistoryTurn => {
  const turn = value as HistoryTurn;
  return (
    typeof turn === "object" &&
    turn !== null &&
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.text === "string" &&
    turn.text.trim() !== ""
  );
};

/**
 * Validates the UI's history and keeps complete question/answer exchanges only.
 *
 * Long conversations are trimmed by whole exchanges, in batches, so the start of the
 * history stays the same for several turns in a row. Trimming one exchange per turn
 * would change the prompt prefix on every request and defeat prompt caching.
 */
export function prepareHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];

  const turns = raw.filter(isTurn);
  const exchanges: [HistoryTurn, HistoryTurn][] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    if (turns[i].role === "user" && turns[i + 1].role === "assistant") {
      exchanges.push([turns[i], turns[i + 1]]);
      i++;
    }
  }

  const overflow = exchanges.length - MAX_EXCHANGES;
  const drop = overflow > 0 ? Math.ceil(overflow / TRIM_BATCH) * TRIM_BATCH : 0;

  return exchanges
    .slice(drop)
    .flat()
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TEXT_CHARS) }));
}
