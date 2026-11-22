// Lane 01 owns this file: the 2 OA problems (see docs/PROBLEMS.md). Hidden tests are stripped server-side before sending to clients.
import type { Problem } from "./types";

export const problems: Problem[] = [];

export function getProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
export function publicProblem(p: Problem): Omit<Problem, "hiddenTests"> {
  const { hiddenTests: _hidden, ...rest } = p;
  return rest;
}
