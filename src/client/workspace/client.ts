// Lane 01 owns this file. API calls for the take flow.
import { api } from "wasp/client/api";
import type { Assessment, Problem, Session, TestResult } from "../../shared/types";

export type PublicProblem = Omit<Problem, "hiddenTests">;

export function fetchAssessment(id: string): Promise<{ assessment: Assessment; problem: PublicProblem }> {
  return api.get(`api/assessments/${encodeURIComponent(id)}`).json();
}

export function createSession(assessmentId: string, candidateName: string): Promise<Session> {
  return api.post("api/sessions", { json: { assessmentId, candidateName } }).json();
}

// assessmentId is unused now (it fed the removed dev mock); kept so callers don't change.
export function submitCode(sessionId: string, code: string, _assessmentId: string): Promise<{ result: TestResult }> {
  return api.post(`api/sessions/${encodeURIComponent(sessionId)}/submit`, { json: { code }, timeout: 20_000 }).json();
}

/** Human-readable error for the UI. */
export async function errorMessage(err: unknown): Promise<string> {
  const res = (err as { response?: Response }).response;
  if (res) {
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      if (body.error || body.message) return String(body.error ?? body.message);
    } catch {
      /* not JSON */
    }
    return `Server error ${res.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}
