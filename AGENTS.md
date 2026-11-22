# Oarlock — agent guide (shared by every coding agent in Codevisor)

**Oarlock is an AI interviewer for the AI era.** Companies run their first-round online assessment (OA) on Oarlock. Candidates solve a coding problem **with an AI assistant allowed** (under a company-set policy), while a **voice interviewer** (ElevenLabs) sits on the call: it watches their code and AI usage live, asks pointed follow-up questions, answers clarifying questions, and keeps time. At the end Oarlock writes a **report** judging problem solving, **how well they used AI**, code quality and communication.

Built at the **YC Startups × ElevenLabs Hackathon, Sun Nov 22, 2026, UWaterloo E7**. Theme: **"an AI coworker we would actually hire"**: companies hire Oarlock as their first-round interviewer. Bonus points for **real strangers using it** (students take a practice OA). Hacking ends **15:00 sharp**. Team of 4, each driving one agent in **Codevisor**, each in its own git worktree.

If you are one of those agents: read `docs/ARCHITECTURE.md` (contracts, ownership, merge times) and your lane brief in `agents/` first.

## Docs
| File | What it holds |
| --- | --- |
| `docs/SPEC.md` | Product, features, priorities, cut order |
| `docs/ARCHITECTURE.md` | Pages, data model, endpoints, module contracts, ownership, merges |
| `docs/PROBLEMS.md` | The 2 OA problems, starter code, test cases, test runner rules |
| `docs/ASSISTANT.md` | AI assistant panel, policies, logging, AI-code-share detection |
| `docs/VOICE_INTERVIEWER.md` | ElevenLabs agent: prompt, live updates, client tools, question rules |
| `docs/REPORT.md` | Metrics (computed in code) + report prompt and schema |
| `docs/DEMO.md` | Judging, demo script, strangers, video, Codevisor evidence |
| `docs/SETUP.md` | Keys, env, HTTPS, deploy |

## Hard rules
1. **~2h45m total.** Scope is fixed in `SPEC.md`. **Gate at 13:45:** solve a problem with the AI → interviewer asks ≥ 2 relevant questions by voice → report generated. Nothing else matters until that works.
2. **Never fake it.** No canned interviewer questions, no hardcoded reports. Metrics are computed from the real timeline.
3. **Log everything to the timeline** (`TimelineEvent`): code snapshots, prompts, AI replies, inserts/pastes, test runs, voice turns, flags. The report is only as good as the timeline.
4. **Secrets server-side only** (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`). The ElevenLabs agent is public; the browser needs only its ID.
5. **JavaScript only** for candidate code today. Tests run in a Web Worker with a 2 s timeout.
6. **Stay in your lane** (ownership table in `docs/ARCHITECTURE.md`). Fresh repo created after 11:00.

## Stack (decided)
- **Wasp 0.26** (React + Node), `main.wasp.ts` with `@wasp.sh/spec`, **Node >= 24.22.1**. The old `main.wasp` DSL is retired: **fetch `https://wasp.sh/llms.txt` before writing Wasp config or route params.** No database: in-memory store persisted to `data/db.json`.
- **Editor:** `@monaco-editor/react`.
- **AI assistant UI:** `@assistant-ui/react` (partner tool) with a custom adapter calling our `/api/assist`. Check its docs for the current local-runtime/adapter API.
- **Assistant model:** `claude-haiku-5-5` (fast). **Report model:** `claude-sonnet-5-5` (quality). Via `@anthropic-ai/sdk`.
- **Voice interviewer:** ElevenLabs Agents, `@elevenlabs/react` (`useConversation`, client tools, `sendContextualUpdate`, `sendUserMessage`).
- **Hosting:** cloudflared tunnel or Maritime (partner prize, ≤ 30 min attempt).

## Commands
```bash
wasp start   # client :3000, server :3001
```

## Conventions
TypeScript, small files, shared types in `src/shared/types.ts`. Clean, professional UI (this is a product companies would pay for): dark editor, light chrome, clear timer. Never show hidden test contents to the candidate.
