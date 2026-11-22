// Lane 04 owns this file. Server-side grading in node:vm (2 s timeout per test).
import vm from "node:vm";
import type { Problem, TestCase, TestResult } from "../shared/types";

export type GradeOutcome = {
  result: TestResult; // visible + hidden combined (what the candidate sees; hidden failures are generic)
  visible: { passed: number; total: number };
  hidden: { passed: number; total: number };
};

const PERF_LIMIT_MS = 200;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const isLimiter = (p: Pick<Problem, "id" | "functionName">) =>
  p.id === "rateLimiter" || p.functionName === "createLimiter";

// Runs entirely inside the VM so the timeout covers the candidate's code, and returns JSON
// so results compare cleanly across realms.
function harness(code: string, functionName: string, limiter: boolean): string {
  const call = limiter
    ? `const [limit, windowMs, calls] = __args;
       const lim = __fn(limit, windowMs);
       out = calls.map(([u, t]) => lim.allow(u, t));`
    : `out = __fn(...__args);`;
  return `(() => {
    const __fn = (function () { ${code}
      ;return typeof ${functionName} !== "undefined" ? ${functionName} : undefined; })();
    if (typeof __fn !== "function") throw new Error("${functionName} is not defined");
    const __args = JSON.parse(__argsJson);
    let out;
    const __t0 = Date.now();
    ${call}
    return JSON.stringify({ out: out === undefined ? null : out, ms: Date.now() - __t0 });
  })()`;
}

function runOne(code: string, p: Pick<Problem, "id" | "functionName">, t: TestCase): { ok: boolean; message: string } {
  const ctx = vm.createContext({ __argsJson: JSON.stringify(t.args) });
  try {
    const raw = vm.runInContext(harness(code, p.functionName, isLimiter(p)), ctx, { timeout: 2000 }) as string;
    const { out, ms } = JSON.parse(raw) as { out: unknown; ms: number };
    if (/perf|10k|performance/i.test(t.name) && ms > PERF_LIMIT_MS) {
      return { ok: false, message: `too slow (${ms} ms > ${PERF_LIMIT_MS} ms)` };
    }
    if (!deepEqual(out, t.expected)) {
      return { ok: false, message: `expected ${JSON.stringify(t.expected)}, got ${JSON.stringify(out)}` };
    }
    return { ok: true, message: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: /timed out/i.test(msg) ? "timeout" : msg };
  }
}

export function grade(code: string, problem: Problem): GradeOutcome {
  const t0 = Date.now();
  const failures: TestResult["failures"] = [];
  let vPass = 0;
  let hPass = 0;
  for (const t of problem.visibleTests) {
    const r = runOne(code, problem, t);
    if (r.ok) vPass++;
    else failures.push({ name: t.name, message: r.message });
  }
  problem.hiddenTests.forEach((t, i) => {
    const r = runOne(code, problem, t);
    if (r.ok) hPass++;
    // Never leak hidden names, inputs or expected values.
    else failures.push({ name: `hidden test ${i + 1}`, message: `hidden test ${i + 1} failed` });
  });
  const vTotal = problem.visibleTests.length;
  const hTotal = problem.hiddenTests.length;
  return {
    result: { passed: vPass + hPass, total: vTotal + hTotal, failures, ms: Date.now() - t0, hidden: true },
    visible: { passed: vPass, total: vTotal },
    hidden: { passed: hPass, total: hTotal },
  };
}
