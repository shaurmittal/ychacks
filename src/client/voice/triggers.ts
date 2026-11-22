// Lane 03: turns real timeline events into agent context + throttled "ask now" triggers.
// Pure logic (no React, no ElevenLabs) so it can be unit tested with a fake clock.
// Silence alone never triggers anything: questions come from code the candidate writes or inserts,
// failing tests, the 5-minute mark, and the close.
import type { TestResult, TimelineEvent } from "../../shared/types";
import { EVENT_PREFIX, clip, codeBlock, currentCodeBlock, describeResult, mmss } from "./format";

export const QUESTION_GAP_MS = 75_000; // min gap between triggered questions
export const INSERT_DELAY_MS = 15_000; // give them a moment to test after inserting
export const CANDIDATE_TALK_GRACE_MS = 8_000;
export const CODE_SNAPSHOT_GAP_MS = 60_000;
export const CODE_SETTLE_MS = 5_000; // code unchanged this long before we ask about it (don't interrupt mid-typing)
export const MIN_NEW_LINES = 4; // meaningful new/changed lines that justify a question…
export const MIN_NEW_LINES_STRUCTURAL = 2; // …or fewer if they include a new function/branch/loop
const STALE_MS = 180_000;
const BIG_PASTE_CHARS = 120;

export type TriggerReason = "insert" | "fails" | "code" | "warn5" | "close" | "twin";

/** Lane 05: a twin question the interviewer should ask (see src/server/twin.ts). */
export type TwinQuestion = { id: string; text: string; type: "free_text" | "single_choice" | "scale"; options?: string[]; scale_min?: number; scale_max?: number };

export type BrainDeps = {
  now: () => number;
  sendContext: (text: string) => void;
  sendTrigger: (text: string) => void;
  /** Called once per trigger actually sent; the widget logs it as an `interviewer_trigger` event. */
  logTrigger: (reason: TriggerReason, summary: string) => void;
  getCode: () => string;
  minutesLeft: () => number;
  agentSpeaking: () => boolean;
  onClosing: (reason: "submit" | "time") => void;
};

const PRIORITY: Record<TriggerReason, number> = { close: 4, warn5: 3, insert: 2, fails: 2, twin: 1, code: 1 };
type Built = { text: string; summary: string };
type Pending = { kind: TriggerReason; createdAt: number; build: () => Built | null };

// ---- code-progress helpers (exported for tests) ----

const TRIVIAL = /^[\s{}()[\];,]*$/;
const COMMENT = /^(\/\/|\/\*|\*)/;
const STRUCTURAL = /\b(function|if|else|for|while|switch|case|do|class)\b|=>/;

export function isTrivialLine(line: string): boolean {
  const t = line.trim();
  return t.length < 3 || TRIVIAL.test(t) || COMMENT.test(t);
}

/** 1-based line numbers in `after` that are new or changed relative to `before` (line LCS, whitespace-insensitive). */
export function changedLines(before: string, after: string): number[] {
  const a = before.split("\n").map((l) => l.trim());
  const b = after.split("\n").map((l) => l.trim());
  const n = a.length, m = b.length;
  // LCS table; code is small (hundreds of lines at most).
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: number[] = [];
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) { i++; j++; }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { out.push(j + 1); j++; }
  }
  return out;
}

/** "7–9, 14" style ranges. */
export function lineRanges(nums: number[]): string {
  const parts: string[] = [];
  for (let k = 0; k < nums.length; ) {
    let e = k;
    while (e + 1 < nums.length && nums[e + 1] === nums[e] + 1) e++;
    parts.push(e === k ? `${nums[k]}` : `${nums[k]}–${nums[e]}`);
    k = e + 1;
  }
  return parts.join(", ");
}

export class InterviewerBrain {
  private start: number;
  private lastQuestionAt = -Infinity;
  private lastCandidateSpeechAt = -Infinity;
  private lastCodeSent = "";
  private lastCodeSentAt = -Infinity;
  private lastSeenCode = "";
  private lastCodeChangeAt = -Infinity;
  private baseline: string | null = null; // code at the time the interviewer last asked something
  private aiLines = new Set<string>(); // trimmed lines that came from AI inserts/pastes (not "written" by the candidate)
  private insert: { at: number; code: string; source: string; tested: boolean; queued: boolean } | null = null;
  private consecutiveFails = 0;
  private pending: Pending | null = null;
  private warned5 = false;
  private closed = false;
  private closeReason: "submit" | "time" = "submit";
  private twinQueue: TwinQuestion[] = [];
  triggersSent = 0;

  constructor(private d: BrainDeps) {
    this.start = d.now();
  }

  private elapsed() { return mmss(this.d.now() - this.start); }
  private left() { return Math.max(0, Math.round(this.d.minutesLeft())); }

  private enqueue(p: Omit<Pending, "createdAt">) {
    if (this.closed && p.kind !== "close") return;
    if (this.pending && PRIORITY[this.pending.kind] > PRIORITY[p.kind]) return;
    this.pending = { ...p, createdAt: this.d.now() };
  }

  private resetBaseline() { this.baseline = this.d.getCode(); }

  /** Lane 05: queue twin questions; each is asked once, through the normal throttle. */
  setTwinQuestions(qs: TwinQuestion[]) { this.twinQueue = [...qs]; }

  private twinTrigger(): Built | null {
    const q = this.twinQueue.shift();
    if (!q) return null;
    const how = q.type === "single_choice" ? ` For check_answer, map their answer to the closest of: ${q.options!.join(" | ")}.`
      : q.type === "scale" ? ` For check_answer, pass just the number (${q.scale_min}-${q.scale_max}).` : "";
    return {
      summary: `Twin question "${q.id}"`,
      text: `${EVENT_PREFIX} Ask the candidate this question now, briefly and in your own words: "${q.text}" ` +
        `When they answer, call check_answer with question_id "${q.id}" and their answer, then do what it returns.${how} ` +
        `Don't mention predictions. ${this.left()} minutes remain.`,
    };
  }

  /** The agent asked something on its own: counts toward the throttle, and resets "new code since last question". */
  noteAgentSaid(text: string) {
    if (text.trim().endsWith("?")) {
      this.lastQuestionAt = this.d.now();
      this.resetBaseline();
    }
  }

  noteCandidateSpoke() {
    this.lastCandidateSpeechAt = this.d.now();
  }

  handleEvent(e: TimelineEvent) {
    if (this.closed) return;
    const d = e.data as Record<string, any>;
    switch (e.kind) {
      case "prompt":
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
        else this.d.sendContext(`The candidate pasted a short snippet: ${clip(text, 200)}`);
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
    this.d.sendContext(`At ${this.elapsed()} the candidate ${source}:\n${codeBlock(code, 2500)}`);
    for (const l of code.split("\n")) if (!isTrivialLine(l)) this.aiLines.add(l.trim());
    this.insert = { at: this.d.now(), code, source, tested: false, queued: false };
  }

  private onTestRun(r?: TestResult) {
    if (this.insert) this.insert.tested = true;
    if (!r) return;
    this.d.sendContext(`At ${this.elapsed()} the candidate ran the tests: ${describeResult(r)}`);
    if (r.failures.length > 0 && r.passed < r.total) {
      this.consecutiveFails += 1;
      if (this.consecutiveFails >= 2) {
        const count = this.consecutiveFails;
        const fail = r;
        const failing = fail.failures.slice(0, 2).map((f) => f.name).join(", ");
        this.enqueue({
          kind: "fails",
          build: () => ({
            summary: `${count} failing test runs in a row (${fail.passed}/${fail.total} passed${failing ? `; failing: ${failing}` : ""})`,
            text:
              `${EVENT_PREFIX} The candidate has now had ${count} test runs in a row with failures. Latest: ${describeResult(fail)}\n` +
              `Their current code (line numbers match their editor):\n${currentCodeBlock(this.d.getCode())}\n` +
              `Ask ONE short question that helps them reason about why a specific failing case fails (point at an input or a line of their code), without telling them the fix. ${this.left()} minutes remain.`,
          }),
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
    const summary = reason === "submit"
      ? `Submitted${result ? ` (${result.passed}/${result.total} passed)` : ""}; closing the interview`
      : "Time up; closing the interview";
    this.enqueue({
      kind: "close",
      build: () => ({
        summary,
        text: `${EVENT_PREFIX} ${what} Close the interview now: thank them by name in one or two sentences, say their report is being prepared, and say goodbye. Do not ask any more questions and do not comment on the test results.`,
      }),
    });
  }

  /** Lines the candidate wrote themselves since the last question (excludes trivial and AI-inserted lines). */
  private writtenSinceBaseline(code: string): number[] {
    if (this.baseline === null) return [];
    const lines = code.split("\n");
    return changedLines(this.baseline, code).filter((n) => {
      const l = lines[n - 1] ?? "";
      return !isTrivialLine(l) && !this.aiLines.has(l.trim());
    });
  }

  private meaningful(code: string, nums: number[]): boolean {
    if (nums.length >= MIN_NEW_LINES) return true;
    const lines = code.split("\n");
    return nums.length >= MIN_NEW_LINES_STRUCTURAL && nums.some((n) => STRUCTURAL.test(lines[n - 1] ?? ""));
  }

  private codeTrigger(): Built | null {
    const code = this.d.getCode();
    const nums = this.writtenSinceBaseline(code);
    if (!this.meaningful(code, nums)) return null; // they deleted it again: nothing to ask
    const lines = code.split("\n");
    const w = String(lines.length).length;
    const snippet = nums.map((n) => `${String(n).padStart(w, " ")}| ${lines[n - 1]}`).join("\n");
    return {
      summary: `Candidate wrote new code at lines ${lineRanges(nums)} (${nums.length} lines)`,
      text:
        `${EVENT_PREFIX} Since the interviewer last asked anything, the candidate wrote new code themselves. New or changed lines (line numbers match their editor):\n${codeBlock(snippet, 2000)}\n` +
        `Their full current code:\n${currentCodeBlock(code)}\n` +
        `Ask exactly ONE short, specific question about these new lines: e.g. an input or edge case they handle or miss, why a condition or data structure is written this way, or what a variable holds at some point. Refer to the line numbers. Don't comment on code they didn't just write, and don't say whether it is correct. ${this.left()} minutes remain.`,
    };
  }

  /** Call every ~1-2 s. Emits code snapshots, schedules time/insert/code triggers, fires the pending one. */
  tick() {
    const now = this.d.now();
    const left = this.d.minutesLeft();

    if (!this.closed && left <= 0) this.close("time");
    if (!this.closed && !this.warned5 && left <= 5 && left > 0) {
      this.warned5 = true;
      this.enqueue({
        kind: "warn5",
        build: () => ({
          summary: `5-minute warning (~${Math.max(1, Math.round(this.d.minutesLeft()))} min left)`,
          text: `${EVENT_PREFIX} About ${Math.max(1, Math.round(this.d.minutesLeft()))} minutes remain. Give the candidate a calm one-sentence time warning and suggest they make sure their tests pass and submit.`,
        }),
      });
    }

    if (!this.closed) {
      const code = this.d.getCode();
      if (code !== this.lastSeenCode) { this.lastSeenCode = code; this.lastCodeChangeAt = now; }
      if (this.baseline === null && code) this.baseline = code; // starter code is not "written"

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

      if (!this.pending && this.twinQueue.length && now - this.lastQuestionAt >= QUESTION_GAP_MS) {
        this.enqueue({ kind: "twin", build: () => this.twinTrigger() });
      }

      if (
        !this.pending &&
        now - this.lastQuestionAt >= QUESTION_GAP_MS &&
        now - this.lastCodeChangeAt >= CODE_SETTLE_MS &&
        this.meaningful(code, this.writtenSinceBaseline(code))
      ) {
        this.enqueue({ kind: "code", build: () => this.codeTrigger() });
      }
    }

    this.fire(now);
  }

  /** Where the inserted snippet sits in the current code, e.g. "lines 4–12". */
  private insertedAt(snippet: string): string {
    const n = snippet.split("\n").length;
    const first = snippet.split("\n").map((l) => l.trim()).find((l) => !isTrivialLine(l));
    if (!first) return `${n} lines`;
    const idx = this.d.getCode().split("\n").findIndex((l) => l.trim() === first);
    return idx < 0 ? `${n} lines` : `lines ${idx + 1}–${idx + n}`;
  }

  private insertTrigger(ins: { at: number; code: string; source: string; tested: boolean }): Built {
    const ago = Math.round((this.d.now() - ins.at) / 1000);
    const head = `${EVENT_PREFIX} ${ago} seconds ago the candidate ${ins.source}:\n${codeBlock(ins.code, 2500)}\n`;
    const current = `Their full current code (line numbers match their editor):\n${currentCodeBlock(this.d.getCode())}\n`;
    const where = this.insertedAt(ins.code);
    if (!ins.tested) {
      return {
        summary: `AI code inserted (${where}), not tested`,
        text: head + current +
          "They have NOT run the tests since. Ask exactly ONE short, specific question about an edge case or a particular line of this inserted code that it might mishandle, to find out whether they understand and verified it. Do not say whether it is correct. If it seems they accepted it blindly, silently call flag_observation with severity concern.",
      };
    }
    return {
      summary: `AI code inserted (${where}), tested since; asked to explain it`,
      text: head + current +
        "They ran the tests after inserting it. Ask exactly ONE short question asking them to explain a specific line, condition or design choice in this code, to check they understand what they accepted.",
    };
  }

  private fire(now: number) {
    const p = this.pending;
    if (!p) return;
    const bypass = p.kind === "close" || p.kind === "warn5";
    if (!bypass && now - p.createdAt > STALE_MS) { this.pending = null; return; }
    if (!bypass) {
      if (now - this.lastQuestionAt < QUESTION_GAP_MS) return;
      if (now - this.lastCandidateSpeechAt < CANDIDATE_TALK_GRACE_MS) return;
    }
    if (this.d.agentSpeaking() && p.kind !== "close") return;
    this.pending = null;
    const built = p.build();
    if (!built) return;
    this.d.sendTrigger(built.text);
    this.d.logTrigger(p.kind, built.summary);
    this.triggersSent += 1;
    if (!bypass) {
      this.lastQuestionAt = now;
      this.resetBaseline();
    }
    if (p.kind === "close") this.d.onClosing(this.closeReason);
  }

  get isClosed() { return this.closed; }
}
