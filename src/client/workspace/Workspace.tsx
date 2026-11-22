// Lane 01 owns this file. The OA workspace: statement | editor + tests | interviewer + assistant.
import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { InterviewerWidget } from "../voice/InterviewerWidget";
import { flush, getCode, log, setLatestCode, stopTimeline } from "../timeline/bus";
import type { Assessment, TestResult } from "../../shared/types";
import { errorMessage, submitCode, type PublicProblem } from "./client";
import { Markdown } from "./Markdown";
import { isFromAi, trackAiCode } from "./pasteDetect";
import { runTests } from "./runner";
import { clearSaved, saveCode } from "./persist";
import { TestResults } from "./TestResults";
import { Timer } from "./Timer";
import { POLICY_LABEL } from "./format";

type Ed = Parameters<OnMount>[0];
type Mon = Parameters<OnMount>[1];

const SNAPSHOT_DEBOUNCE_MS = 3000;
const GOODBYE_MAX_MS = 25_000;

export function Workspace(props: {
  assessment: Assessment;
  problem: PublicProblem;
  sessionId: string;
  candidateName: string;
  startedAt: string;
  initialCode: string;
  voiceOk: boolean;
}) {
  const { assessment, problem, sessionId, candidateName } = props;
  const navigate = useNavigate();
  const editorRef = useRef<Ed | null>(null);
  const monacoRef = useRef<Mon | null>(null);
  const lastSnapshot = useRef(props.initialCode);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(new Date(props.startedAt).getTime() + assessment.durationMin * 60_000);

  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<TestResult | null>(null);
  const [submitted, setSubmitted] = useState<TestResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const showsInterviewer = assessment.voice && props.voiceOk;

  const minutesLeft = useCallback(() => Math.max(0, (deadline.current - Date.now()) / 60_000), []);
  const currentCode = () => editorRef.current?.getValue() ?? getCode() ?? props.initialCode;

  useEffect(() => trackAiCode(), []);

  /** Log a `code` snapshot now if the code changed since the last one. */
  const snapshot = useCallback(() => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = null;
    const code = currentCode();
    if (code !== lastSnapshot.current) {
      lastSnapshot.current = code;
      log("code", { code });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (value: string | undefined) => {
    const code = value ?? "";
    setLatestCode(code);
    saveCode(sessionId, code);
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(snapshot, SNAPSHOT_DEBOUNCE_MS);
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setLatestCode(editor.getValue());
    editor.onDidPaste((e) => {
      const text = editor.getModel()?.getValueInRange(e.range) ?? "";
      if (text.trim()) log("paste", { text, fromAi: isFromAi(text) });
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runVisible());
    editor.focus();
  };

  /** AssistantPanel → "Insert into editor". */
  const onInsert = useCallback((snippet: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    const text = snippet.endsWith("\n") ? snippet : snippet + "\n";
    const sel = editor.getSelection();
    const defines = (s: string) => new RegExp(`(function\\s+${problem.functionName}\\s*\\()|((const|let|var)\\s+${problem.functionName}\\s*=)`).test(s);
    let range;
    let msg: string;
    if (sel && !sel.isEmpty()) {
      range = sel;
      msg = "Replaced your selection with the AI's code.";
    } else if (defines(snippet) && defines(model.getValue())) {
      range = model.getFullModelRange();
      msg = `Replaced your ${problem.functionName} with the AI's version. Ctrl/Cmd+Z to undo.`;
    } else {
      const pos = editor.getPosition() ?? model.getFullModelRange().getEndPosition();
      range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
      msg = "Inserted the AI's code at your cursor.";
    }
    editor.pushUndoStop();
    editor.executeEdits("ai-insert", [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
    log("insert", { code: snippet });
    snapshot();
    setNotice(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem.functionName]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function runVisible() {
    if (running || submittingRef.current) return;
    setRunning(true);
    snapshot();
    const result = await runTests(currentCode(), problem, problem.visibleTests);
    log("test_run", { result });
    setLastRun(result);
    setRunning(false);
  }

  async function submit(reason: "submitted" | "time_up") {
    if (submittingRef.current) return;
    if (reason === "submitted" && !window.confirm("Submit your solution? Hidden tests will run and the session ends.")) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    snapshot();
    const code = currentCode();
    await flush();
    try {
      const { result } = await submitCode(sessionId, code, assessment.id);
      log("submit", { code, result });
      log("session_end", { reason });
      await flush();
      stopTimeline();
      clearSaved(assessment.id, sessionId);
      setSubmitted(result);
      if (!showsInterviewer) navigate(`/report/${sessionId}`);
    } catch (err) {
      setError(`Submit failed: ${await errorMessage(err)}. Try again.`);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // After submit with voice on: let the interviewer say goodbye, then go to the report.
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => navigate(`/report/${sessionId}`), GOODBYE_MAX_MS);
    return () => clearTimeout(t);
  }, [submitted, navigate, sessionId]);
  const onInterviewEnd = useCallback(() => {
    if (submittingRef.current) navigate(`/report/${sessionId}`);
  }, [navigate, sessionId]);

  const widgetAssessment = props.voiceOk ? assessment : { ...assessment, voice: false };

  return (
    <div className="ws">
      <header className="ws-top">
        <div className="ws-top-left">
          <span className="brand">Overwatch</span>
          <span className="ws-sep" />
          <span className="ws-title">{assessment.title || problem.title}</span>
          <span className="pill pill-muted">{POLICY_LABEL[assessment.aiPolicy]}</span>
        </div>
        <Timer deadline={deadline.current} onExpire={() => void submit("time_up")} />
        <div className="ws-top-right">
          <span className="ws-candidate">{candidateName}</span>
          <button className="btn" onClick={() => void runVisible()} disabled={running || submitting} title="Run visible tests (Ctrl/Cmd+Enter)">
            {running ? "Running…" : "Run tests"}
          </button>
          <button className="btn btn-primary" onClick={() => void submit("submitted")} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </header>

      <div className="ws-body">
        <section className="ws-statement">
          <Markdown source={problem.statementMd} />
          <h3 className="ws-tests-h">Visible tests</h3>
          <ul className="ws-tests-list">
            {problem.visibleTests.map((t) => <li key={t.name}>{t.name}</li>)}
          </ul>
          <p className="muted small">Hidden tests also run when you submit.</p>
        </section>

        <section className="ws-center">
          <div className="ws-editor">
            <Editor
              defaultLanguage="javascript"
              defaultValue={props.initialCode}
              theme="vs-dark"
              onChange={onChange}
              onMount={onMount}
              loading={<div className="editor-loading">Loading editor…</div>}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                tabSize: 2,
                wordWrap: "on",
                automaticLayout: true,
                padding: { top: 12 },
                fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
              }}
            />
            {notice && <div className="toast">{notice}</div>}
          </div>
          <TestResults running={running} result={lastRun} />
          {error && <div className="error ws-error">{error}</div>}
        </section>

        <aside className="ws-right">
          <div className="ws-interviewer">
            <InterviewerWidget
              sessionId={sessionId}
              assessment={widgetAssessment}
              problem={problem}
              candidateName={candidateName}
              minutesLeft={minutesLeft}
              onEnd={onInterviewEnd}
            />
          </div>
          <div className="ws-assistant">
            <AssistantPanel sessionId={sessionId} policy={assessment.aiPolicy} problemId={problem.id} onInsert={onInsert} />
          </div>
        </aside>
      </div>

      {submitted && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>Submitted</h2>
            <p>
              <strong>{submitted.passed}/{submitted.total}</strong> tests passed (visible + hidden).
            </p>
            <p className="muted">Your interviewer is wrapping up. Your report is being prepared.</p>
            <button className="btn btn-primary" onClick={() => navigate(`/report/${sessionId}`)}>View report</button>
          </div>
        </div>
      )}
    </div>
  );
}
