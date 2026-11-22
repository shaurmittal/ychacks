// Lane 02 owns this file (assistant-ui panel). Fills its parent's height and scrolls internally.
import { useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import type { AiPolicy } from "../../shared/types";
import { createAssistAdapter, type AssistCtx } from "./adapter";
import { InsertContext, Markdown } from "./Markdown";
import "./assistant.css";

const POLICY_LABEL: Record<AiPolicy, string> = {
  full: "AI: full access",
  no_solutions: "AI: no full solutions",
  hints: "AI: hints only",
};
const POLICY_HELP: Record<AiPolicy, string> = {
  full: "Ask for anything, including full code. How you use it is part of the assessment.",
  no_solutions: "The assistant explains, reviews and writes small snippets, but won't write the full solution.",
  hints: "The assistant only gives hints and guiding questions. No real code.",
};

function AssistantText({ text }: { text: string }) {
  return <Markdown text={text} />;
}
function UserText({ text }: { text: string }) {
  return <span className="oa-user-text">{text}</span>;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="oa-msg oa-msg-user">
      <div className="oa-bubble-user">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="oa-msg oa-msg-ai">
      <div className="oa-ai-label">Assistant</div>
      <MessagePrimitive.Parts components={{ Text: AssistantText }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="oa-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

export function AssistantPanel(props: { sessionId: string; policy: AiPolicy; problemId: string; onInsert: (code: string) => void }) {
  const ctxRef = useRef<AssistCtx>(props);
  ctxRef.current = { sessionId: props.sessionId, policy: props.policy, problemId: props.problemId };
  const insertRef = useRef(props.onInsert);
  insertRef.current = props.onInsert;
  const [busy, setBusy] = useState(false);

  const adapter = useMemo(() => createAssistAdapter(() => ctxRef.current, setBusy), []);
  const runtime = useLocalRuntime(adapter);
  const onInsert = useMemo(() => (code: string) => insertRef.current(code), []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <InsertContext.Provider value={onInsert}>
        <div className="oa-assistant">
          <div className="oa-head">
            <span className="oa-title">AI assistant</span>
            <span className={`oa-badge oa-badge-${props.policy}`} title={POLICY_HELP[props.policy]}>
              {POLICY_LABEL[props.policy]}
            </span>
          </div>
          <ThreadPrimitive.Root className="oa-thread">
            <ThreadPrimitive.Viewport className="oa-viewport">
              <ThreadPrimitive.Empty>
                <div className="oa-empty">
                  <p className="oa-empty-title">Ask the assistant anything about the problem.</p>
                  <p>{POLICY_HELP[props.policy]}</p>
                  <p className="oa-empty-note">It can see your current code. Every prompt is part of your assessment.</p>
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              {busy && (
                <div className="oa-thinking" aria-live="polite">
                  <span /><span /><span />
                </div>
              )}
            </ThreadPrimitive.Viewport>
            <ComposerPrimitive.Root className="oa-composer">
              <ComposerPrimitive.Input
                className="oa-input"
                placeholder="Ask about the problem, your code, a bug…"
                submitMode="enter"
                rows={1}
                autoFocus={false}
              />
              <ComposerPrimitive.Send className="oa-send" disabled={busy}>Send</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </div>
      </InsertContext.Provider>
    </AssistantRuntimeProvider>
  );
}
