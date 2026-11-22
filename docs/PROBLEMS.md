# OA problems (JavaScript)

Two problems where AI gets a first draft right quickly but edge cases separate people who verify from people who paste. Put them in `src/shared/problems.ts`.

## 1. `mergeBookings` — Meeting room bookings (easy-medium, practice default)
Given an array of bookings `{start: "HH:MM", end: "HH:MM", room: string}`, return, per room, the merged busy intervals sorted by start, as `{ [room]: [["HH:MM","HH:MM"], ...] }`. Back-to-back bookings (end == next start) merge. Ignore bookings where `end <= start`. Rooms with only invalid bookings are omitted.
- Visible tests (4): basic overlap; back-to-back; two rooms; unsorted input.
- Hidden tests (6): empty array → `{}`; invalid booking ignored; room with only invalid bookings omitted; fully nested interval; identical duplicates; times like "09:05" vs "9:05" (input is always zero-padded; test that string comparison of padded times works but minutes math does too).

## 2. `knightWays` — Knight's corner walk (medium, DP / DFS + memo)
`knightWays(k)`: number of ways a knight can go from a1 to h8 on an 8×8 board in exactly `k` moves (squares may repeat), modulo 1,000,000,007; `k < 0` → 0. Fewest moves is 6 (108 ways); odd `k` → 0. Plain DFS passes small `k`; hidden tests go up to `k = 1000`, so it needs DP over (moves, square). Expected values were generated with an independent DP.

## Test runner rules
- Client (`runner.worker.ts`): build the function with `new Function(code + "\nreturn " + functionName)` inside a Web Worker; Deep-equal results. Kill the worker after 2 s → failure "timeout".
- Server (`grader.ts`): same logic with `node:vm` (`timeout: 2000`) for hidden tests on submit. Hidden test names/inputs never go to the client; the client only sees counts and generic failure messages ("hidden test 3 failed").
- Starter code: function signature + JSDoc only.
