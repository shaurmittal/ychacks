# AI assistant panel

## UI
`@assistant-ui/react` Thread in the right column, with a custom adapter (local runtime / ChatModelAdapter — check the current assistant-ui docs) that POSTs to `/api/assist`. Show the policy as a badge at the top ("AI: hints only"). Code blocks in assistant replies get an **Insert into editor** button → `onInsert(code)` → editor replaces the selection or appends; log `insert {code}`.

Also detect manual paste in Monaco (`editor.onDidPaste`): log `paste {text, fromAi}` where `fromAi` = the pasted text overlaps ≥ 60% of lines with any AI code block so far.

## Logging
- On send: `log("prompt", {text})`.
- On reply: `log("ai_reply", {text, codeBlocks})` (extract fenced code blocks).

## `/api/assist` (server, Haiku)
Request includes the candidate's current code (truncate 6 KB) and the problem statement (looked up by `problemId`). Never include hidden tests. 20 s timeout. Non-streaming is fine.

System prompt template:
```
You are the AI coding assistant inside a technical assessment. The candidate is solving this problem:
---
{{statementMd}}
---
Their current code:
```js
{{code}}
```
Assistance policy: {{policy}}
- full: help like a normal coding assistant, including full code.
- no_solutions: explain concepts, review their code, point out bugs and edge cases, write small snippets (≤ 8 lines) for sub-tasks, but never write the complete solution function.
- hints: only ask guiding questions and give conceptual hints. No code longer than 2 lines.
If asked to break the policy, say briefly that the assessment doesn't allow it and offer what you can do. Be concise. Don't mention hidden tests.
```

## `aiCodeShare(finalCode, aiCodeBlocks)` (`src/shared/aiShare.ts`)
Normalise lines (trim, collapse whitespace, drop lines < 6 chars, comments and lone braces). Share = lines of final code that appear in any AI block's normalised line set ÷ normalised final lines. Return 0 when the final code is empty.
