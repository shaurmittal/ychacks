# OA problems (JavaScript)

Two problems where AI gets a first draft right quickly but edge cases separate people who verify from people who paste. Put them in `src/shared/problems.ts`.

## 1. `mergeBookings` — Meeting room bookings (easy-medium, practice default)
Given an array of bookings `{start: "HH:MM", end: "HH:MM", room: string}`, return, per room, the merged busy intervals sorted by start, as `{ [room]: [["HH:MM","HH:MM"], ...] }`. Back-to-back bookings (end == next start) merge. Ignore bookings where `end <= start`. Rooms with only invalid bookings are omitted.
- Visible tests (4): basic overlap; back-to-back; two rooms; unsorted input.
- Hidden tests (6): empty array → `{}`; invalid booking ignored; room with only invalid bookings omitted; fully nested interval; identical duplicates; times like "09:05" vs "9:05" (input is always zero-padded; test that string comparison of padded times works but minutes math does too).

## 2. `rateLimiter` — Sliding-window API limiter (medium)
Implement `createLimiter(limit, windowMs)` returning `{ allow(userId, nowMs) => boolean }`. A user may make at most `limit` allowed requests in any window of `windowMs` ms (sliding, not fixed buckets). Denied requests don't count. Timestamps for a user are non-decreasing.
- Visible tests (4): under limit; hits limit; window slides; two users independent.
- Hidden tests (6): exactly at window boundary (request at `t0 + windowMs` is allowed — window is `(now - windowMs, now]`); denied requests don't count; limit 0 → always false; burst then long gap; many users; 10k requests performance (< 200 ms).

## Test runner rules
- Client (`runner.worker.ts`): build the function with `new Function(code + "\nreturn " + functionName)` inside a Web Worker; for `rateLimiter` tests, each test is a small script of calls (`args` = `[limit, windowMs, [[user, t], ...]]`, `expected` = array of booleans). Deep-equal results. Kill the worker after 2 s → failure "timeout".
- Server (`grader.ts`): same logic with `node:vm` (`timeout: 2000`) for hidden tests on submit. Hidden test names/inputs never go to the client; the client only sees counts and generic failure messages ("hidden test 3 failed").
- Starter code: function signature + JSDoc only.
