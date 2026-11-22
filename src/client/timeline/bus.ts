// Lane 01 owns this file. In-browser timeline bus: every event is kept in memory,
// pushed to live subscribers, and batched to POST /api/sessions/:id/events every 2 s.
import { config } from "wasp/client";
import { api } from "wasp/client/api";
import type { TimelineEvent, TimelineKind } from "../../shared/types";

const FLUSH_MS = 2000;

let sessionId = "";
let latestCode = "";
const events: TimelineEvent[] = [];
let queue: TimelineEvent[] = [];
const listeners = new Set<(e: TimelineEvent) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

export function initTimeline(id: string): void {
  sessionId = id;
  // Events logged before init (shouldn't happen, but don't lose them) get the session id now.
  queue.forEach((e) => (e.sessionId = id));
  events.forEach((e) => (e.sessionId ||= id));
  if (!timer) {
    timer = setInterval(() => void flush(), FLUSH_MS);
    window.addEventListener("pagehide", beaconFlush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") beaconFlush();
    });
  }
}

export function log(kind: TimelineKind, data: Record<string, unknown>): void {
  const e: TimelineEvent = { sessionId, at: new Date().toISOString(), kind, data };
  if ((kind === "code" || kind === "submit") && typeof data.code === "string") latestCode = data.code;
  events.push(e);
  queue.push(e);
  listeners.forEach((fn) => {
    try {
      fn(e);
    } catch (err) {
      console.error("[timeline] subscriber failed", err);
    }
  });
}

export function subscribe(fn: (e: TimelineEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCode(): string {
  return latestCode;
}

export function recent(n = 20): TimelineEvent[] {
  return events.slice(-n);
}

/** Lane 01 extra: keep getCode() current on every keystroke without logging a `code` event. */
export function setLatestCode(code: string): void {
  latestCode = code;
}

/** Lane 01 extra: send everything queued now (awaitable, used before submit/navigation). */
export async function flush(): Promise<void> {
  if (inflight) await inflight;
  if (!sessionId || queue.length === 0) return;
  if (sessionId.startsWith("dev-")) {
    queue = []; // dev mock session (API not merged yet): nothing to send to
    return;
  }
  const batch = queue;
  queue = [];
  inflight = api
    .post(`api/sessions/${encodeURIComponent(sessionId)}/events`, { json: batch })
    .then(() => undefined)
    .catch((err: unknown) => {
      const status = (err as { response?: Response }).response?.status ?? 0;
      // 4xx (bad session etc.) won't fix itself; keep retrying network errors and 5xx.
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        console.error(`[timeline] server rejected ${batch.length} events (${status}), dropping them`, err);
        return;
      }
      console.warn("[timeline] flush failed, will retry", err);
      queue = batch.concat(queue);
    })
    .finally(() => {
      inflight = null;
    });
  await inflight;
}

/** Stop the periodic flush (after the session ends). */
export function stopTimeline(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener("pagehide", beaconFlush);
}

function beaconFlush(): void {
  if (!sessionId || queue.length === 0 || sessionId.startsWith("dev-")) return;
  const url = `${config.apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/events`;
  const body = new Blob([JSON.stringify(queue)], { type: "application/json" });
  // sendBeacon with JSON blob triggers CORS preflight cross-origin; fall back to keepalive fetch.
  try {
    void fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
    queue = [];
  } catch {
    if (navigator.sendBeacon?.(url, body)) queue = [];
  }
}
