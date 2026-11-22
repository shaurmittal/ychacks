// Lane 04 owns this file. In-memory store persisted to data/db.json (debounced write).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AiPolicy, Assessment, Report, Session, TestResult, TimelineEvent } from "../shared/types";
import { problems } from "../shared/problems";

type Db = {
  assessments: Record<string, Assessment>;
  sessions: Record<string, Session>;
  events: Record<string, TimelineEvent[]>;
  reports: Record<string, Report>;
  submissions: Record<string, Submission>;
  reportErrors: Record<string, string>;
  nextEventId: number;
};

export type Submission = {
  at: string; code: string; result: TestResult;
  visible: { passed: number; total: number }; hidden: { passed: number; total: number };
};

// Wasp runs the server from inside .wasp/out/server; keep data next to main.wasp.ts.
function projectRoot(): string {
  const cwd = process.cwd();
  const i = cwd.indexOf(`${path.sep}.wasp${path.sep}`);
  return i >= 0 ? cwd.slice(0, i) : cwd;
}
const DATA_DIR = process.env.OARLOCK_DATA_DIR ?? path.join(projectRoot(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function load(): Db {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Partial<Db>;
    return {
      assessments: raw.assessments ?? {},
      sessions: raw.sessions ?? {},
      events: raw.events ?? {},
      reports: raw.reports ?? {},
      submissions: raw.submissions ?? {},
      reportErrors: raw.reportErrors ?? {},
      nextEventId: raw.nextEventId ?? 1,
    };
  } catch {
    return { assessments: {}, sessions: {}, events: {}, reports: {}, submissions: {}, reportErrors: {}, nextEventId: 1 };
  }
}

const db: Db = load();

let writeTimer: NodeJS.Timeout | null = null;
function persist(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error("[store] persist failed", e);
    }
  }, 500);
}

function seedPractice(): void {
  for (const p of problems) {
    const id = `practice-${p.id}`;
    if (db.assessments[id]) continue;
    db.assessments[id] = {
      id, title: p.title, company: "Oarlock Practice", problemId: p.id,
      aiPolicy: "full", durationMin: 15, voice: true, practice: true,
    };
  }
  persist();
}
seedPractice();

export const newId = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

// Assessments
export function listAssessments(): Assessment[] {
  seedPractice(); // problems.ts may gain entries after a merge / hot reload
  return Object.values(db.assessments);
}
export function getAssessment(id: string): Assessment | undefined {
  if (!db.assessments[id]) seedPractice();
  return db.assessments[id];
}
export function createAssessment(a: Omit<Assessment, "id">): Assessment {
  const created: Assessment = { ...a, id: newId() };
  db.assessments[created.id] = created;
  persist();
  return created;
}

// Sessions
export function createSession(assessmentId: string, candidateName: string): Session {
  const s: Session = { id: newId(), assessmentId, candidateName, startedAt: new Date().toISOString(), reportReady: false };
  db.sessions[s.id] = s;
  db.events[s.id] = [];
  persist();
  return s;
}
export function getSession(id: string): Session | undefined {
  return db.sessions[id];
}
export function updateSession(id: string, patch: Partial<Session>): Session | undefined {
  const s = db.sessions[id];
  if (!s) return undefined;
  Object.assign(s, patch);
  persist();
  return s;
}
export function sessionsForAssessment(assessmentId: string): Session[] {
  return Object.values(db.sessions).filter((s) => s.assessmentId === assessmentId);
}

// Events
export function addEvents(sessionId: string, events: TimelineEvent[]): TimelineEvent[] {
  const list = (db.events[sessionId] ??= []);
  const added = events.map((e) => ({
    sessionId,
    at: typeof e.at === "string" ? e.at : new Date().toISOString(),
    kind: e.kind,
    data: e.data ?? {},
    id: db.nextEventId++,
  }));
  list.push(...added);
  list.sort((a, b) => a.at.localeCompare(b.at) || (a.id ?? 0) - (b.id ?? 0));
  persist();
  return added;
}
export function getEvents(sessionId: string): TimelineEvent[] {
  return db.events[sessionId] ?? [];
}

// Reports
export function getReport(sessionId: string): Report | undefined {
  return db.reports[sessionId];
}
export function saveReport(r: Report): void {
  db.reports[r.sessionId] = r;
  delete db.reportErrors[r.sessionId];
  const s = db.sessions[r.sessionId];
  if (s) s.reportReady = true;
  persist();
}
export function setReportError(sessionId: string, message: string | null): void {
  if (message) db.reportErrors[sessionId] = message;
  else delete db.reportErrors[sessionId];
  persist();
}
export function getReportError(sessionId: string): string | undefined {
  return db.reportErrors[sessionId];
}

// Submissions (server-graded, includes hidden-test counts)
export function saveSubmission(sessionId: string, sub: Submission): void {
  db.submissions[sessionId] = sub;
  persist();
}
export function getSubmission(sessionId: string): Submission | undefined {
  return db.submissions[sessionId];
}

/** The AI policy the company set for this session's assessment (server-side source of truth). */
export function policyForSession(sessionId: string): AiPolicy | undefined {
  const s = db.sessions[sessionId];
  return s ? db.assessments[s.assessmentId]?.aiPolicy : undefined;
}
/** The problem this session is for (so the client can't swap problems either). */
export function problemIdForSession(sessionId: string): string | undefined {
  const s = db.sessions[sessionId];
  return s ? db.assessments[s.assessmentId]?.problemId : undefined;
}
