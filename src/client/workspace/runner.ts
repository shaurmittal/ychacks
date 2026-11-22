// Lane 01 owns this file. Run in a Web Worker (runner.worker.ts) with a 2 s timeout.
import { RUN_TIMEOUT_MS } from "../../shared/evaluate";
import type { TestCase, TestResult } from "../../shared/types";

export async function runTests(code: string, problem: { functionName: string }, tests: TestCase[]): Promise<TestResult> {
  const started = performance.now();
  return new Promise<TestResult>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      resolve(allFailed(tests, `could not start test runner: ${String(err)}`, started));
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(allFailed(tests, "timeout", started));
    }, RUN_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<TestResult>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(ev.data);
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      clearTimeout(timer);
      worker.terminate();
      resolve(allFailed(tests, ev.message || "runner error", started));
    };
    worker.postMessage({ code, functionName: problem.functionName, tests });
  });
}

function allFailed(tests: TestCase[], message: string, started: number): TestResult {
  return { passed: 0, total: tests.length, failures: tests.map((t) => ({ name: t.name, message })), ms: Math.round(performance.now() - started), hidden: false };
}
