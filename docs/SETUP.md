# Setup

## Now (in parallel with the scaffold)
- [ ] Node >= 24.22.1, Wasp CLI (`npm i -g @wasp.sh/wasp-cli@latest`), `cloudflared`.
- [ ] ElevenLabs: credits + API key; create the interviewer agent from `VOICE_INTERVIEWER.md` (public), add the 3 client tools, note the agent ID.
- [ ] Anthropic API key.
- [ ] Earbuds with mic for the noisy hall.

## Env
`.env.server`:
```
ANTHROPIC_API_KEY=
ASSIST_MODEL=claude-haiku-5-5
REPORT_MODEL=claude-sonnet-5-5
```
`.env.client`:
```
REACT_APP_ELEVENLABS_AGENT_ID=
```
(Check Wasp's client env var prefix and access in its docs.)

## Twin (Expected Parrot, lane 05)
Optional. Add `EXPECTED_PARROT_API_KEY`, `TWIN_MODEL=gpt-4.1-mini`, `TWIN_MODEL_SERVICE=openai`, `TWIN_URL=http://127.0.0.1:8765` to `.env.server`, then run `cd twin-py && .venv/bin/python -m twin serve --env-file ../.env.server` next to `wasp start`. See `twin-py/README.md`.

## HTTPS for other people's laptops/phones (mic needs it)
```bash
wasp start
cloudflared tunnel --url http://localhost:3001   # server
cloudflared tunnel --url http://localhost:3000   # client
```
Point the client at the server tunnel (Wasp client API URL env var), allow tunnel hosts in Vite (`server.allowedHosts: true`), set the server's allowed client URL for CORS (check Wasp docs). Don't restart tunnels during judging.

## Deploy (optional, ≤ 30 min)
Server to Maritime (partner prize) or any HTTPS host; client static build anywhere. Keep `data/db.json` on the server.
