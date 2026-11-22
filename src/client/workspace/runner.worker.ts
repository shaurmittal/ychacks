// Lane 01 owns this file. Runs candidate code against test cases inside a Web Worker.
// The parent (runner.ts) terminates this worker after 2 s → "timeout".
import { checkCase } from "../../shared/evaluate";
import type { TestCase, TestResult } from "../../shared/types";

type RunRequest = { code: string; functionName: string; tests: TestCase[] };

self.onmessage = (ev: MessageEvent<RunRequest>) => {
  const { code, functionName, tests } = ev.data;
  const t0 = performance.now();
  const failures: TestResult["failures"] = [];
  let passed = 0;
  let fn: unknown;
  try {
    new Function(code); // syntax-check the candidate's code alone, so errors point at their code
    fn = new Function(code + "\n;return typeof " + functionName + " === 'undefined' ? undefined : " + functionName)();
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const result: TestResult = { passed: 0, total: tests.length, failures: tests.map((t) => ({ name: t.name, message: msg })), ms: Math.round(performance.now() - t0), hidden: false };
    (self as unknown as Worker).postMessage(result);
    return;
  }
  for (const t of tests) {
    const r = checkCase(fn, functionName, t);
    if (r.ok) passed++;
    else failures.push({ name: t.name, message: r.message });
  }
  const result: TestResult = { passed, total: tests.length, failures, ms: Math.round(performance.now() - t0), hidden: false };
  (self as unknown as Worker).postMessage(result);
};
