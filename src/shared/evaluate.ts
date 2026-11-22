// Lane 01 owns this file. Shared test-evaluation logic for the client Web Worker
// (runner.worker.ts) and the server grader (grader.ts, node:vm). No test data here.
import type { TestCase } from "./types";

/** Per-test time limit for tests named "performance…" (ms). */
export const PERF_LIMIT_MS = 200;
export const RUN_TIMEOUT_MS = 2000;

/** Run one test case against the candidate's exported function. Returns the actual value. */
export function runCase(fn: unknown, functionName: string, test: TestCase): unknown {
  if (typeof fn !== "function") throw new Error(`${functionName} is not defined as a function`);
  const args = clone(test.args);
  if (functionName === "createLimiter") {
    const [limit, windowMs, calls] = args as [number, number, [string, number][]];
    const limiter = fn(limit, windowMs) as { allow?: unknown } | undefined;
    if (!limiter || typeof limiter.allow !== "function") throw new Error("createLimiter must return an object with an allow(userId, nowMs) method");
    const allow = limiter.allow.bind(limiter) as (u: string, t: number) => unknown;
    return calls.map(([u, t]) => allow(u, t));
  }
  return fn(...args);
}

/** Run a test and produce a pass/fail with a human-readable message. */
export function checkCase(fn: unknown, functionName: string, test: TestCase): { ok: boolean; message: string } {
  const t0 = now();
  let actual: unknown;
  try {
    actual = runCase(fn, functionName, test);
  } catch (err) {
    return { ok: false, message: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  const ms = now() - t0;
  if (!deepEqual(actual, test.expected)) {
    return { ok: false, message: `expected ${preview(test.expected)}, got ${preview(actual)}` };
  }
  if (test.name.startsWith("performance") && ms > PERF_LIMIT_MS) {
    return { ok: false, message: `too slow: ${Math.round(ms)} ms (limit ${PERF_LIMIT_MS} ms)` };
  }
  return { ok: true, message: "" };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function preview(v: unknown, max = 160): string {
  let s: string;
  try {
    s = v === undefined ? "undefined" : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
