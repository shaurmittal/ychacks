// Lane 01 owns this file. Survive a page refresh mid-assessment.
export type SavedSession = { sessionId: string; candidateName: string; startedAt: string; voiceOk: boolean };

const sessKey = (assessmentId: string) => `oarlock:take:${assessmentId}`;
const codeKey = (sessionId: string) => `oarlock:code:${sessionId}`;

export function loadSaved(assessmentId: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(sessKey(assessmentId));
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}
export function saveSession(assessmentId: string, s: SavedSession): void {
  localStorage.setItem(sessKey(assessmentId), JSON.stringify(s));
}
export function loadCode(sessionId: string): string | null {
  return localStorage.getItem(codeKey(sessionId));
}
export function saveCode(sessionId: string, code: string): void {
  try {
    localStorage.setItem(codeKey(sessionId), code);
  } catch {
    /* quota */
  }
}
export function clearSaved(assessmentId: string, sessionId: string): void {
  localStorage.removeItem(sessKey(assessmentId));
  localStorage.removeItem(codeKey(sessionId));
}
