// Lane 02 owns this file (assistant-ui panel).
import type { AiPolicy } from "../../shared/types";

export function AssistantPanel(_props: { sessionId: string; policy: AiPolicy; problemId: string; onInsert: (code: string) => void }) {
  return <div>AI assistant (stub)</div>;
}
