// Placeholder API handler; each lane replaces its exports with real implementations
// typed via the generated types, e.g. `import type { ListAssessments } from "wasp/server/api"`.
type Res = { status: (code: number) => { json: (body: unknown) => void } };
export const notImplemented = (_req: unknown, res: Res, _context: unknown) => {
  res.status(501).json({ error: "not implemented" });
};
