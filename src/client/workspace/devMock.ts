// Lane 01 owns this file. DEV-ONLY fallback while the server endpoints return 501.
// Only ever loaded through `import.meta.env.DEV && import("./devMock")` in client.ts.
import { getProblem, publicProblem } from "../../shared/problems";
import type { Assessment, Session, TestResult } from "../../shared/types";
import { runTests } from "./runner";

function assessmentFor(id: string): Assessment {
  const problemId = id.replace(/^practice-/, "");
  const p = getProblem(problemId) ?? getProblem("merge-bookings")!;
  return { id, title: p.title, company: "Oarlock Practice", problemId: p.id, aiPolicy: "full", durationMin: 15, voice: true, practice: true };
}

export async function mockAssessment(id: string) {
  const assessment = assessmentFor(id);
  return { assessment, problem: publicProblem(getProblem(assessment.problemId)!) };
}

export async function mockSession(assessmentId: string, candidateName: string): Promise<Session> {
  return { id: `dev-${Math.random().toString(36).slice(2, 10)}`, assessmentId, candidateName, startedAt: new Date().toISOString(), reportReady: false };
}

export async function mockSubmit(assessmentId: string, code: string): Promise<{ result: TestResult }> {
  const p = getProblem(assessmentFor(assessmentId).problemId)!;
  const r = await runTests(code, p, [...p.visibleTests, ...p.hiddenTests]);
  return { result: { ...r, hidden: true } };
}
