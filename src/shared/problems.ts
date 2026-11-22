// Lane 01 owns this file: the 2 OA problems (see docs/PROBLEMS.md).
// Hidden tests are stripped server-side (publicProblem) before sending to clients.
// Do NOT import this file from client code: it would ship hidden tests in the bundle.
// Test evaluation helpers live in ./evaluate.ts (safe for client + server).
import type { Problem, TestCase } from "./types";

type Booking = { start: string; end: string; room: string };
const b = (room: string, start: string, end: string): Booking => ({ start, end, room });

const mergeBookings: Problem = {
  id: "merge-bookings",
  title: "Meeting room bookings",
  functionName: "mergeBookings",
  statementMd: `# Meeting room bookings

You're building the availability view for an office booking tool. Given a list of bookings, return the **merged busy intervals for each room**.

Each booking looks like:

\`\`\`js
{ start: "HH:MM", end: "HH:MM", room: "Atlas" }
\`\`\`

Return an object mapping each room to its busy intervals, **sorted by start time**:

\`\`\`js
{ Atlas: [["09:00", "10:30"], ["13:00", "14:00"]] }
\`\`\`

## Rules
- Overlapping bookings in the same room merge into one interval.
- **Back-to-back** bookings merge too (one ends exactly when the next starts).
- Ignore invalid bookings where \`end <= start\`.
- Omit rooms that have no valid bookings.
- Times are always zero-padded 24-hour \`"HH:MM"\` strings; return them in the same format.
- Input may be in any order.

## Example
\`\`\`js
mergeBookings([
  { start: "09:00", end: "10:00", room: "Atlas" },
  { start: "09:30", end: "10:30", room: "Atlas" },
  { start: "11:00", end: "12:00", room: "Birch" },
]);
// → { Atlas: [["09:00", "10:30"]], Birch: [["11:00", "12:00"]] }
\`\`\`
`,
  starterCode: `/**
 * Merge meeting-room bookings into busy intervals per room.
 *
 * @param {{ start: string, end: string, room: string }[]} bookings
 *   Times are zero-padded "HH:MM" (24h). Bookings may be unsorted.
 * @returns {Record<string, [string, string][]>}
 *   room -> merged [start, end] intervals, sorted by start.
 *   Back-to-back bookings merge; bookings with end <= start are ignored;
 *   rooms with no valid bookings are omitted.
 */
function mergeBookings(bookings) {
  // your code here
}
`,
  visibleTests: [
    {
      name: "basic overlap",
      args: [[b("Atlas", "09:00", "10:00"), b("Atlas", "09:30", "11:00")]],
      expected: { Atlas: [["09:00", "11:00"]] },
    },
    {
      name: "back-to-back bookings merge",
      args: [[b("Atlas", "09:00", "10:00"), b("Atlas", "10:00", "10:30"), b("Atlas", "11:00", "12:00")]],
      expected: { Atlas: [["09:00", "10:30"], ["11:00", "12:00"]] },
    },
    {
      name: "two rooms",
      args: [[b("Atlas", "09:00", "10:00"), b("Birch", "09:30", "10:30"), b("Atlas", "13:00", "14:00")]],
      expected: { Atlas: [["09:00", "10:00"], ["13:00", "14:00"]], Birch: [["09:30", "10:30"]] },
    },
    {
      name: "unsorted input",
      args: [[b("Atlas", "14:00", "15:00"), b("Atlas", "09:00", "10:00"), b("Atlas", "09:45", "11:00")]],
      expected: { Atlas: [["09:00", "11:00"], ["14:00", "15:00"]] },
    },
  ],
  hiddenTests: [
    { name: "empty input", args: [[]], expected: {} },
    {
      name: "invalid bookings ignored",
      args: [[b("Atlas", "09:00", "10:00"), b("Atlas", "11:00", "10:30"), b("Atlas", "12:00", "12:00")]],
      expected: { Atlas: [["09:00", "10:00"]] },
    },
    {
      name: "room with only invalid bookings omitted",
      args: [[b("Atlas", "09:00", "10:00"), b("Birch", "10:00", "09:00"), b("Birch", "15:00", "15:00")]],
      expected: { Atlas: [["09:00", "10:00"]] },
    },
    {
      name: "fully nested interval",
      args: [[b("Atlas", "09:00", "12:00"), b("Atlas", "10:00", "11:00"), b("Atlas", "11:30", "11:45")]],
      expected: { Atlas: [["09:00", "12:00"]] },
    },
    {
      name: "identical duplicates",
      args: [[b("Atlas", "09:00", "10:00"), b("Atlas", "09:00", "10:00"), b("Birch", "08:00", "08:30"), b("Birch", "08:00", "08:30")]],
      expected: { Atlas: [["09:00", "10:00"]], Birch: [["08:00", "08:30"]] },
    },
    {
      name: "zero-padded minutes across hours",
      args: [[
        b("Atlas", "09:55", "10:05"),
        b("Atlas", "08:05", "09:00"),
        b("Atlas", "08:50", "09:10"),
        b("Atlas", "10:10", "10:20"),
        b("Atlas", "09:10", "09:55"),
        b("Atlas", "23:00", "23:59"),
      ]],
      expected: { Atlas: [["08:05", "10:05"], ["10:10", "10:20"], ["23:00", "23:59"]] },
    },
  ],
};

// Reference sliding-window limiter, used only to generate expected output for the performance test.
function referenceLimiter(limit: number, windowMs: number) {
  const hist = new Map<string, number[]>();
  return {
    allow(user: string, now: number): boolean {
      const ts = hist.get(user) ?? [];
      while (ts.length && ts[0] <= now - windowMs) ts.shift();
      hist.set(user, ts);
      if (ts.length >= limit) return false;
      ts.push(now);
      return true;
    },
  };
}

function limiterCase(name: string, limit: number, windowMs: number, calls: [string, number][], expected?: boolean[]): TestCase {
  if (!expected) {
    const lim = referenceLimiter(limit, windowMs);
    expected = calls.map(([u, t]) => lim.allow(u, t));
  }
  return { name, args: [limit, windowMs, calls], expected };
}

const perfCalls: [string, number][] = Array.from({ length: 10_000 }, (_, i) => [`user${i % 7}`, i * 3]);

const rateLimiter: Problem = {
  id: "rate-limiter",
  title: "Sliding-window rate limiter",
  functionName: "createLimiter",
  statementMd: `# Sliding-window rate limiter

Your API gateway needs a per-user rate limiter. Implement \`createLimiter(limit, windowMs)\` which returns an object with one method:

\`\`\`js
allow(userId, nowMs) // → true if the request is allowed, false if denied
\`\`\`

## Rules
- A user may make at most \`limit\` **allowed** requests in any window of \`windowMs\` milliseconds.
- The window is **sliding**, not fixed buckets: a request at \`nowMs\` looks back over \`(nowMs - windowMs, nowMs]\`.
- **Denied requests don't count** toward the limit.
- Each user is limited independently.
- For a given user, \`nowMs\` never decreases between calls.
- It should stay fast with many requests (think 10,000+ calls).

## Example
\`\`\`js
const limiter = createLimiter(2, 1000);
limiter.allow("ada", 0);    // true
limiter.allow("ada", 500);  // true
limiter.allow("ada", 900);  // false (2 allowed requests in the last 1000 ms)
limiter.allow("ada", 1100); // true  (the request at 0 has left the window)
limiter.allow("bob", 1100); // true  (bob has his own limit)
\`\`\`
`,
  starterCode: `/**
 * Create a per-user sliding-window rate limiter.
 *
 * @param {number} limit     Max allowed requests per user in any window.
 * @param {number} windowMs  Window length in milliseconds.
 * @returns {{ allow(userId: string, nowMs: number): boolean }}
 *   allow() returns true if the request is allowed. A request at nowMs
 *   considers allowed requests in (nowMs - windowMs, nowMs].
 *   Denied requests don't count. nowMs is non-decreasing per user.
 */
function createLimiter(limit, windowMs) {
  // your code here
}
`,
  visibleTests: [
    limiterCase("under limit", 3, 1000, [["ada", 0], ["ada", 100], ["ada", 200]], [true, true, true]),
    limiterCase("hits limit", 2, 1000, [["ada", 0], ["ada", 10], ["ada", 20]], [true, true, false]),
    limiterCase(
      "window slides",
      2,
      1000,
      [["ada", 0], ["ada", 500], ["ada", 900], ["ada", 1100], ["ada", 1400], ["ada", 1600]],
      [true, true, false, true, false, true],
    ),
    limiterCase(
      "two users are independent",
      1,
      1000,
      [["ada", 0], ["bob", 0], ["ada", 500], ["bob", 1200], ["ada", 1200]],
      [true, true, false, true, true],
    ),
  ],
  hiddenTests: [
    limiterCase("exact window boundary", 1, 1000, [["ada", 0], ["ada", 999], ["ada", 1000]], [true, false, true]),
    limiterCase(
      "denied requests don't count",
      2,
      1000,
      [["ada", 0], ["ada", 100], ["ada", 200], ["ada", 300], ["ada", 1050], ["ada", 1150]],
      [true, true, false, false, true, true],
    ),
    limiterCase("limit 0 always denies", 0, 1000, [["ada", 0], ["ada", 5000]], [false, false]),
    limiterCase(
      "burst then long gap",
      3,
      1000,
      [["ada", 0], ["ada", 1], ["ada", 2], ["ada", 3], ["ada", 4], ["ada", 100000], ["ada", 100001], ["ada", 100002], ["ada", 100003]],
      [true, true, true, false, false, true, true, true, false],
    ),
    limiterCase(
      "many users",
      1,
      100,
      [["u1", 0], ["u2", 0], ["u3", 0], ["u1", 50], ["u2", 100], ["u3", 150], ["u4", 150], ["u1", 150]],
      [true, true, true, false, true, true, true, true],
    ),
    limiterCase("performance: 10k requests", 40, 1000, perfCalls),
  ],
};

export const problems: Problem[] = [mergeBookings, rateLimiter];

export function getProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
export function publicProblem(p: Problem): Omit<Problem, "hiddenTests"> {
  const { hiddenTests: _hidden, ...rest } = p;
  return rest;
}
