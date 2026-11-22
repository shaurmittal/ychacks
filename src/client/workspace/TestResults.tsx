// Lane 01 owns this file. Result panel under the editor for visible test runs.
import type { TestResult } from "../../shared/types";

export function TestResults({ running, result }: { running: boolean; result: TestResult | null }) {
  return (
    <div className="results">
      <div className="results-head">
        <span>Test results</span>
        {result && !running && (
          <span className={result.passed === result.total ? "badge badge-pass" : "badge badge-fail"}>
            {result.passed}/{result.total} passed · {Math.round(result.ms)} ms
          </span>
        )}
        {running && <span className="badge">Running…</span>}
      </div>
      <div className="results-body">
        {!result && !running && <div className="muted small">Run tests to check your code against the visible tests (Ctrl/Cmd+Enter).</div>}
        {result && result.failures.length === 0 && <div className="pass-line">All visible tests pass. Hidden tests run when you submit.</div>}
        {result?.failures.map((f) => (
          <div className="fail" key={f.name}>
            <div className="fail-name">✕ {f.name}</div>
            <div className="fail-msg">{f.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
