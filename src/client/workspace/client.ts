// Lane 01 owns this file. API calls for the take flow. Until lane 04's endpoints are
// merged they return 501; in dev only, fall back to a local mock so the flow is testable.
import { api } from "wasp/client/api";
import type { Assessment, Problem, Session, TestResult } from "../../shared/types";

export type PublicProblem = Omit<Problem, "hiddenTests">;

async function withDevMock<T>(real: () => Promise<T>, mock: (m: typeof import("./devMock")) => Promise<T>): Promise<T> {
  try {
    return await real();
  } catch (err) {
    const status = (err as { response?: Response }).response?.status;
    if (import.meta.env.DEV && status === 501) {
      console.warn("[oarlock] API not implemented yet (501), using dev mock");
      return mock(await import("./devMock"));
    }
    throw err;
  }
}

export function fetchAssessment(id: string): Promise<{ assessment: Assessment; problem: PublicProblem }> {
  return withDevMock(
    () => api.get(`api/assessments/${encodeURIComponent(id)}`).json(),
    (m) => m.mockAssessment(id),
  );
}

export function createSession(assessmentId: string, candidateName: string): Promise<Session> {
  return withDevMock(
    () => api.post("api/sessions", { json: { assessmentId, candidateName } }).json(),
    (m) => m.mockSession(assessmentId, candidateName),
  );
}

export function submitCode(sessionId: string, code: string, assessmentId: string): Promise<{ result: TestResult }> {
  return withDevMock(
    () => api.post(`api/sessions/${encodeURIComponent(sessionId)}/submit`, { json: { code }, timeout: 20_000 }).json(),
    (m) => m.mockSubmit(assessmentId, code),
  );
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
