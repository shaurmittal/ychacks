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

const kw = (name: string, k: number, expected: number): TestCase => ({ name, args: [k], expected });

const knightWays: Problem = {
  id: "knight-ways",
  title: "Knight's corner walk",
  functionName: "knightWays",
  statementMd: `# Knight's corner walk

A knight starts on the **bottom-left corner (a1)** of a standard **8×8 chessboard**.
Return the number of different ways it can reach the **top-right corner (h8)** in **exactly \`k\` moves**.

## Rules
- A knight moves in an L: two squares in one direction and one square perpendicular (up to 8 options).
- It must stay on the board on every move.
- Squares may be revisited, including the start and the target: only the position **after the last move** has to be h8.
- Two ways are different if their sequences of squares differ.
- The answer can be huge: return it **modulo 1,000,000,007**.
- If \`k < 0\`, return \`0\`.

## Examples
\`\`\`js
knightWays(6);  // → 108   (6 is the fewest moves that works)
knightWays(7);  // → 0
knightWays(0);  // → 0     (a1 is not h8)
\`\`\`

\`k\` can be as large as 1000, so plain recursion over every path will be far too slow.
`,
  starterCode: `/**
 * Ways for a knight to go from a1 to h8 on an 8x8 board in exactly k moves.
 *
 * @param {number} k  number of moves (may be 0, may be up to 1000; negative -> 0)
 * @returns {number}  the count modulo 1_000_000_007
 */
function knightWays(k) {
  // your code here
}
`,
  visibleTests: [
    kw("fewest moves (k = 6)", 6, 108),
    kw("odd k is impossible", 7, 0),
    kw("zero moves", 0, 0),
    kw("k = 8", 8, 5124),
  ],
  hiddenTests: [
    kw("too few moves", 4, 0),
    kw("k = 10", 10, 198364),
    kw("k = 12", 12, 7316404),
    kw("needs modulo (k = 20)", 20, 359473177),
    kw("k = 30", 30, 272218004),
    kw("k = 50", 50, 425822642),
    kw("k = 100", 100, 474009958),
    kw("negative k", -1, 0),
    kw("performance: k = 1000", 1000, 288675524),
  ],
};

export const problems: Problem[] = [mergeBookings, knightWays];

export function getProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
export function publicProblem(p: Problem): Omit<Problem, "hiddenTests"> {
  const { hiddenTests: _hidden, ...rest } = p;
  return rest;
}
