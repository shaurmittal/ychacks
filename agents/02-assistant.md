# Lane 02 — AI assistant panel

**Own:** `src/client/assistant/**`, `src/server/assist.ts`, `src/shared/aiShare.ts`.
**Read:** `docs/ASSISTANT.md` (full spec + system prompt), `docs/ARCHITECTURE.md`.

## Deliver
1. **`POST /api/assist`** (`src/server/assist.ts`, export `assist`, already wired in `main.wasp.ts`): Anthropic SDK, model `process.env.ASSIST_MODEL ?? "claude-haiku-5-5"`, system prompt from ASSISTANT.md with statement (via `getProblem(problemId)` from `src/shared/problems.ts`, which lane 01 is filling in), code truncated to 6 KB, policy. 20 s timeout, non-streaming → `{text}`. Never include hidden tests. Return a clean error JSON when the key is missing.
2. **`AssistantPanel`**: `@assistant-ui/react` thread with a custom adapter (check the current assistant-ui docs for LocalRuntime / ChatModelAdapter), POSTing `{sessionId, policy, problemId, code: getCode(), messages}` from `src/client/timeline/bus.ts`. A policy badge at the top ("AI: full access" / "AI: no full solutions" / "AI: hints only"). Fenced code blocks in replies get an **Insert into editor** button → `props.onInsert(code)` (lane 01 logs `insert`). Log `prompt {text}` on send and `ai_reply {text, codeBlocks}` on reply.
3. **`aiCodeShare`** exactly as specified in ASSISTANT.md. Lane 04's metrics use it.

The panel lives in the right column of a fixed-height workspace, so make it scroll internally. Keep the exported prop signature.
