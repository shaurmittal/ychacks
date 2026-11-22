// Lane 01 owns this file. Run in a Web Worker (runner.worker.ts) with a 2 s timeout.
import type { TestCase, TestResult } from "../../shared/types";

export async function runTests(_code: string, _problem: { functionName: string }, tests: TestCase[]): Promise<TestResult> {
  return { passed: 0, total: tests.length, failures: [{ name: "stub", message: "runner not implemented" }], ms: 0, hidden: false }; // TODO(lane 01)
}
