// Lane 03: turns real timeline events into agent context + throttled "ask now" triggers.
// Pure logic (no React, no ElevenLabs) so it can be unit tested with a fake clock.
import type { TestResult, TimelineEvent } from "../../shared/types";
import { EVENT_PREFIX, clip, codeBlock, currentCodeBlock, describeResult, mmss } from "./format";

export const QUESTION_GAP_MS = 75_000; // min gap between triggered questions
export const INSERT_DELAY_MS = 15_000; // give them a moment to test after inserting
export const SILENCE_MS = 120_000;
export const CANDIDATE_TALK_GRACE_MS = 8_000;
export const CODE_SNAPSHOT_GAP_MS = 60_000;
const STALE_MS = 180_000;
const BIG_PASTE_CHARS = 120;

export type BrainDeps = {
  now: () => number;
  sendContext: (text: string) => void;
  sendTrigger: (text: string) => void;
  getCode: () => string;
  minutesLeft: () => number;
  agentSpeaking: () => boolean;
  onClosing: (reason: "submit" | "time") => void;
};

type TriggerKind = "close" | "warn5" | "insert" | "fails" | "silence";
const PRIORITY: Record<TriggerKind, number> = { close: 4, warn5: 3, insert: 2, fails: 2, silence: 1 };
type Pending = { kind: TriggerKind; createdAt: number; build: () => string };

export class InterviewerBrain {
  private start: number;
  private lastQuestionAt = -Infinity;
  private lastActivityAt: number;
  private lastCandidateSpeechAt = -Infinity;
  private lastCodeSent = "";
  private lastCodeSentAt = -Infinity;
  private insert: { at: number; code: string; source: string; tested: boolean; queued: boolean } | null = null;
  private consecutiveFails = 0;
  private pending: Pending | null = null;
  private warned5 = false;
  private closed = false;
  private closeReason: "submit" | "time" = "submit";
  triggersSent = 0;

  constructor(private d: BrainDeps) {
    this.start = d.now();
    this.lastActivityAt = this.start;
  }

  private elapsed() { return mmss(this.d.now() - this.start); }
  private left() { return Math.max(0, Math.round(this.d.minutesLeft())); }

  private enqueue(p: Omit<Pending, "createdAt">) {
    if (this.closed && p.kind !== "close") return;
    if (this.pending && PRIORITY[this.pending.kind] > PRIORITY[p.kind]) return;
    this.pending = { ...p, createdAt: this.d.now() };
  }

  /** The agent asked something on its own: counts toward the throttle. */
  noteAgentSaid(text: string) {
    if (text.trim().endsWith("?")) this.lastQuestionAt = this.d.now();
  }

  noteCandidateSpoke() {
    const now = this.d.now();
    this.lastCandidateSpeechAt = now;
    this.lastActivityAt = now;
  }

  handleEvent(e: TimelineEvent) {
    if (this.closed) return;
    const d = e.data as Record<string, any>;
    const now = this.d.now();
    switch (e.kind) {
      case "code":
        this.lastActivityAt = now;
        return;
      case "prompt":
        this.lastActivityAt = now;
        this.d.sendContext(`At ${this.elapsed()} the candidate asked the AI assistant: "${clip(String(d.text ?? ""), 500)}"`);
        return;
      case "ai_reply": {
        const n = (d.codeBlocks as string[] | undefined)?.length ?? 0;
        this.d.sendContext(`The AI assistant replied with ${n} code block(s). Reply begins: "${clip(String(d.text ?? ""), 300)}"`);
        return;
      }
      case "insert":
        this.onInsert(String(d.code ?? ""), "inserted AI-generated code from the assistant");
        return;
      case "paste": {
        const text = String(d.text ?? "");
        if (d.fromAi) this.onInsert(text, "pasted code copied from the AI assistant's reply");
        else if (text.length >= BIG_PASTE_CHARS) this.onInsert(text, "pasted a block of code from outside the editor (not from the built-in assistant)");
        else { this.lastActivityAt = now; this.d.sendContext(`The candidate pasted a short snippet: ${clip(text, 200)}`); }
        return;
      }
      case "test_run":
        this.onTestRun(d.result as TestResult | undefined);
        return;
      case "submit":
        this.d.sendContext(`The candidate submitted at ${this.elapsed()}. ${d.result ? describeResult(d.result as TestResult) : ""}`);
        this.close("submit", d.result as TestResult | undefined);
        return;
      default:
        return;
    }
  }

  private onInsert(code: string, source: string) {
    const now = this.d.now();
    this.lastActivityAt = now;
    this.d.sendContext(`At ${this.elapsed()} the candidate ${source}:\n${codeBlock(code, 2500)}`);
    this.insert = { at: now, code, source, tested: false, queued: false };
  }

  private onTestRun(r?: TestResult) {
    this.lastActivityAt = this.d.now();
    if (this.insert) this.insert.tested = true;
    if (!r) return;
    this.d.sendContext(`At ${this.elapsed()} the candidate ran the tests: ${describeResult(r)}`);
    if (r.failures.length > 0 && r.passed < r.total) {
      this.consecutiveFails += 1;
      if (this.consecutiveFails >= 2) {
        const count = this.consecutiveFails;
        const fail = r;
        this.enqueue({
          kind: "fails",
          build: () =>
            `${EVENT_PREFIX} The candidate has now had ${count} test runs in a row with failures. Latest: ${describeResult(fail)}\n` +
            `Their current code (line numbers match their editor):\n${currentCodeBlock(this.d.getCode())}\n` +
            `Ask ONE short question that helps them reason about why a specific failing case fails (point at an input or a line of their code), without telling them the fix. ${this.left()} minutes remain.`,
        });
        this.consecutiveFails = 0;
      }
    } else {
      this.consecutiveFails = 0;
    }
  }

  private close(reason: "submit" | "time", result?: TestResult) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    this.insert = null;
    this.pending = null;
    const what = reason === "submit"
      ? `The candidate just submitted their solution.${result ? ` ${describeResult(result)}` : ""}`
      : "Time is up for the assessment.";
    this.enqueue({
      kind: "close",
      build: () => `${EVENT_PREFIX} ${what} Close the interview now: thank them by name in one or two sentences, say their report is being prepared, and say goodbye. Do not ask any more questions and do not comment on the test results.`,
    });
  }

  /** Call every ~2 s. Emits code snapshots, schedules time/silence/insert triggers, fires the pending one. */
  tick() {
    const now = this.d.now();
    const left = this.d.minutesLeft();

    if (!this.closed && left <= 0) this.close("time");
    if (!this.closed && !this.warned5 && left <= 5 && left > 0) {
      this.warned5 = true;
      this.enqueue({
        kind: "warn5",
        build: () => `${EVENT_PREFIX} About ${Math.max(1, Math.round(this.d.minutesLeft()))} minutes remain. Give the candidate a calm one-sentence time warning and suggest they make sure their tests pass and submit.`,
      });
    }

    if (!this.closed) {
      const code = this.d.getCode();
      if (code && code !== this.lastCodeSent && now - this.lastCodeSentAt >= CODE_SNAPSHOT_GAP_MS) {
        this.lastCodeSent = code;
        this.lastCodeSentAt = now;
        this.d.sendContext(`Code snapshot at ${this.elapsed()} (${this.left()} min left):\n${currentCodeBlock(code)}`);
      }

      const ins = this.insert;
      if (ins && !ins.queued && now - ins.at >= INSERT_DELAY_MS) {
        ins.queued = true;
        this.enqueue({ kind: "insert", build: () => this.insertTrigger(ins) });
      }

      if (!this.pending && now - this.lastActivityAt >= SILENCE_MS && now - this.lastQuestionAt >= QUESTION_GAP_MS) {
        this.lastActivityAt = now; // one check-in per silent stretch
        this.enqueue({
          kind: "silence",
          build: () =>
            `${EVENT_PREFIX} The candidate has been quiet with no edits or test runs for about two minutes. Their current code (line numbers match their editor):\n${currentCodeBlock(this.d.getCode())}\n` +
            `Briefly check in: ask ONE short question about what they're working on or thinking, referencing something specific in their code. ${this.left()} minutes remain.`,
        });
      }
    }

    this.fire(now);
  }

  private insertTrigger(ins: { at: number; code: string; source: string; tested: boolean }) {
    const ago = Math.round((this.d.now() - ins.at) / 1000);
    const head = `${EVENT_PREFIX} ${ago} seconds ago the candidate ${ins.source}:\n${codeBlock(ins.code, 2500)}\n`;
    const current = `Their full current code (line numbers match their editor):\n${currentCodeBlock(this.d.getCode())}\n`;
    if (!ins.tested) {
      return head + current +
        "They have NOT run the tests since. Ask exactly ONE short, specific question about an edge case or a particular line of this inserted code that it might mishandle, to find out whether they understand and verified it. Do not say whether it is correct. If it seems they accepted it blindly, silently call flag_observation with severity concern.";
    }
    return head + current +
      "They ran the tests after inserting it. Ask exactly ONE short question asking them to explain a specific line, condition or design choice in this code, to check they understand what they accepted.";
  }

  private fire(now: number) {
    const p = this.pending;
    if (!p) return;
    if (p.kind !== "close" && p.kind !== "warn5" && now - p.createdAt > STALE_MS) { this.pending = null; return; }
    const bypass = p.kind === "close" || p.kind === "warn5";
    if (!bypass) {
      if (now - this.lastQuestionAt < QUESTION_GAP_MS) return;
      if (now - this.lastCandidateSpeechAt < CANDIDATE_TALK_GRACE_MS) return;
    }
    if (this.d.agentSpeaking() && p.kind !== "close") return;
    this.pending = null;
    this.d.sendTrigger(p.build());
    this.triggersSent += 1;
    if (!bypass) this.lastQuestionAt = now;
    if (p.kind === "close") this.d.onClosing(this.closeReason);
  }

  get isClosed() { return this.closed; }
}
