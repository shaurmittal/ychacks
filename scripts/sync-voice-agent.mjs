#!/usr/bin/env node
// Lane 03: push the system prompt + first message from docs/VOICE_INTERVIEWER.md to the ElevenLabs agent,
// so the doc stays the single source of truth.
// Usage: node --env-file=.env scripts/sync-voice-agent.mjs [--dry-run]
// Needs ELEVENLABS_API_KEY (server-side secret; never ship it to the client).
import { readFileSync } from "node:fs";

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || "agent_3701m826pmy4ebbsqrmqmjcvq3vd";
const doc = readFileSync(new URL("../docs/VOICE_INTERVIEWER.md", import.meta.url), "utf8");
const block = (heading) => {
  const m = doc.match(new RegExp(`## ${heading}\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  if (!m) throw new Error(`Section "${heading}" not found in docs/VOICE_INTERVIEWER.md`);
  return m[1].trim();
};
const prompt = block("System prompt");
const firstMessage = block("First message");

if (process.argv.includes("--dry-run")) {
  console.log(`prompt: ${prompt.length} chars\nfirst message: ${firstMessage}`);
  process.exit(0);
}
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error("ELEVENLABS_API_KEY is not set (try: node --env-file=.env scripts/sync-voice-agent.mjs)"); process.exit(1); }

const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
  method: "PATCH",
  headers: { "xi-api-key": key, "content-type": "application/json" },
  body: JSON.stringify({ conversation_config: { agent: { first_message: firstMessage, prompt: { prompt } } } }),
});
if (!res.ok) { console.error(`PATCH failed: ${res.status} ${await res.text()}`); process.exit(1); }
const agent = await res.json();
const live = agent.conversation_config?.agent;
const ok = live?.prompt?.prompt?.trim() === prompt && live?.first_message?.trim() === firstMessage;
console.log(ok ? `Synced ${AGENT_ID} (prompt ${prompt.length} chars).` : "PATCH returned but the live prompt differs: check the dashboard.");
process.exit(ok ? 0 : 1);
