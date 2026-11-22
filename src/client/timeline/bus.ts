// Lane 01 owns this file. Stub with the final contract; replace with batching POSTs every 2 s.
import type { TimelineEvent, TimelineKind } from "../../shared/types";

let sessionId = "";
let latestCode = "";
const events: TimelineEvent[] = [];
const listeners = new Set<(e: TimelineEvent) => void>();

export function initTimeline(id: string): void { sessionId = id; }
export function log(kind: TimelineKind, data: Record<string, unknown>): void {
  const e: TimelineEvent = { sessionId, at: new Date().toISOString(), kind, data };
  if (kind === "code" && typeof data.code === "string") latestCode = data.code;
  events.push(e);
  listeners.forEach((fn) => fn(e));
  // TODO(lane 01): batch POST /api/sessions/:id/events every 2 s
}
export function subscribe(fn: (e: TimelineEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getCode(): string { return latestCode; }
export function recent(n = 20): TimelineEvent[] { return events.slice(-n); }
