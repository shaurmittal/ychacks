# Lane briefs

Every lane works in its own git worktree on its own branch, `lane/0X-<name>`. Commit small and often, and push your branch. **Don't merge to `main` yourself.** Lane 04 runs merge 1 at 13:20 in the order 04 → 01 → 02 → 03.

Shared facts for all lanes:
- The scaffold is on `main` and every contract in `docs/ARCHITECTURE.md` already has a stub. Keep exported names and signatures unchanged, because other lanes import them.
- Wasp 0.26 uses a TS spec (`main.wasp.ts`). Read https://wasp.sh/llms-0.26.txt before touching it. API handlers get `(req, res, context)`. Type them with the generated types, e.g. `import type { ListAssessments } from "wasp/server/api"` (the type name is the export name with a capital first letter; it is generated while `wasp start` runs). The client calls APIs with `import { api } from "wasp/client/api"` (a ky instance).
- Client env: `import { env } from "wasp/client"` → `env.REACT_APP_ELEVENLABS_AGENT_ID`. Server env: `import { env } from "wasp/server"` or `process.env`.
- Ports: Wasp uses 3000 (client) and 3001 (server) unless they're taken. On the main dev machine port 3000 is taken, so you get client 3001 and server 3002. Read the `wasp start` output.
- Parallel worktrees: Wasp 0.26 supports them, but give each its own ports (`wasp start --client-port … --server-port …`) so they don't collide.
- Run `wasp install` once in a fresh worktree before `wasp start`.
- The 13:45 gate: solve a problem with the AI → the interviewer asks ≥ 2 relevant questions by voice → a report is generated. Prioritise whatever unblocks that.
