# Lane 03 — Voice interviewer (ElevenLabs)

**Own:** `src/client/voice/**`, `docs/VOICE_INTERVIEWER.md` (it doesn't exist yet in the repo; write it), the ElevenLabs agent config.
**Read:** `docs/SPEC.md` P0 4, `docs/ARCHITECTURE.md`, `docs/DEMO.md` (the demo moment is the interviewer catching an untested AI insert), the `@elevenlabs/react` docs (`useConversation`, `clientTools`, `sendContextualUpdate`, `sendUserMessage`, `dynamicVariables`).

## Context
A teammate is creating the public ElevenLabs agent in the dashboard right now; its ID goes in `.env.client` as `REACT_APP_ELEVENLABS_AGENT_ID`. Write `docs/VOICE_INTERVIEWER.md` early (system prompt, first message, dynamic variables, client tools, question rules) so that teammate can paste it into the dashboard. Commit and push it as soon as it's ready.

## Deliver
`InterviewerWidget` (same props as the stub):
- Starts the conversation when mounted (the session has started and mic permission is granted), passing dynamic variables: candidate name, problem title + statement, AI policy, duration.
- Behaviour per SPEC: greets, explains the format in 2 sentences, answers clarifying questions, **asks follow-up questions triggered by real events**, gives a 5-minute warning, closes politely on submit / time-up (`onEnd`).
- Subscribe to the timeline bus (`subscribe` from `src/client/timeline/bus.ts`) and turn real events into context: `insert` / AI-sourced `paste` (send the inserted code), repeated failing `test_run`s, `submit`, long silence (no events for ~2 min), 5 minutes left (`minutesLeft()`). Use `sendContextualUpdate` for passive context and `sendUserMessage` / a trigger when it should ask a question now. Questions must be about the candidate's actual code. **Never canned questions.** Throttle so it doesn't interrupt more than about once every 60–90 s.
- Client tools for the agent, e.g. `get_current_code` (returns `getCode()`), `get_recent_events`, `flag_observation {note, severity}` → `log("flag", …)`. Document them in VOICE_INTERVIEWER.md.
- Log every transcript line: `interviewer_said {text}` / `candidate_said {text}`.
- Small UI: status (connecting / listening / speaking), mute, a live caption of the last interviewer line, and an error state with retry if the mic or the agent fails.
