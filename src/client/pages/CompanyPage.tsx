// Lane 04 owns this file. /company — assessments list + create.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "wasp/client/api";
import type { AiPolicy, Assessment } from "../../shared/types";
import { Shell } from "../report/ui";

const POLICY_LABEL: Record<AiPolicy, string> = {
  full: "Full help (AI may write code)",
  no_solutions: "No full solutions",
  hints: "Hints only",
};

const takeUrl = (id: string) => `${window.location.origin}/take/${id}`;

export function CompanyPage() {
  const [list, setList] = useState<Assessment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ company: "", title: "", problemId: "", aiPolicy: "full" as AiPolicy, durationMin: 25, voice: true });

  const load = () => api.get("api/assessments").json<Assessment[]>().then((l) => { setList(l); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  // The client never loads problems.ts (it holds hidden tests); derive the problem list from the seeded practice assessments.
  const problems = useMemo(() => {
    const m = new Map<string, string>();
    list.filter((a) => a.practice).forEach((a) => m.set(a.problemId, a.title));
    return [...m.entries()].map(([id, title]) => ({ id, title }));
  }, [list]);
  useEffect(() => { if (!form.problemId && problems[0]) setForm((f) => ({ ...f, problemId: problems[0].id })); }, [problems]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const a = await api.post("api/assessments", { json: { ...form, practice: false } }).json<Assessment>();
      setList((l) => [...l, a]);
      setForm((f) => ({ ...f, title: "" }));
      copy(a.id);
    } catch {
      setErr("Couldn't create the assessment.");
    } finally { setSaving(false); }
  };

  const copy = (id: string) => {
    navigator.clipboard?.writeText(takeUrl(id)).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  };

  const companyList = list.filter((a) => !a.practice);
  const practiceList = list.filter((a) => a.practice);

  return (
    <Shell>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Assessments</h1>
      <p className="ol-muted" style={{ marginTop: 0 }}>Create an AI-allowed first-round OA, share the link, and read ranked reports.</p>

      <div className="ol-grid2" style={{ alignItems: "start", gridTemplateColumns: "1.3fr 1fr" }}>
        <div>
          <AssessmentTable title="Your assessments" items={companyList} empty={loaded ? "No assessments yet. Create one on the right." : "Loading…"} copied={copied} onCopy={copy} />
          <div style={{ height: 16 }} />
          <AssessmentTable title="Practice (public)" items={practiceList} empty="—" copied={copied} onCopy={copy} />
        </div>

        <form className="ol-card" onSubmit={create} style={{ marginTop: 0, display: "grid", gap: 14 }}>
          <div className="ol-section-title" style={{ margin: 0 }}>New assessment</div>
          <div><label className="ol-label">Company</label><input className="ol-input" required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." /></div>
          <div><label className="ol-label">Role / title</label><input className="ol-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Backend Engineer, first round" /></div>
          <div><label className="ol-label">Problem</label>
            <select className="ol-select" value={form.problemId} onChange={(e) => setForm({ ...form, problemId: e.target.value })}>
              {problems.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div><label className="ol-label">AI policy</label>
            <select className="ol-select" value={form.aiPolicy} onChange={(e) => setForm({ ...form, aiPolicy: e.target.value as AiPolicy })}>
              {(Object.keys(POLICY_LABEL) as AiPolicy[]).map((p) => <option key={p} value={p}>{POLICY_LABEL[p]}</option>)}
            </select>
          </div>
          <div className="ol-row" style={{ alignItems: "end" }}>
            <div style={{ flex: 1 }}><label className="ol-label">Duration (min)</label><input className="ol-input" type="number" min={5} max={120} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} /></div>
            <label className="ol-row ol-small" style={{ gap: 8, height: 38, flex: 1 }}>
              <input type="checkbox" checked={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.checked })} /> Voice interviewer
            </label>
          </div>
          {err && <div className="ol-small" style={{ color: "var(--bad)" }}>{err}</div>}
          <button className="ol-btn" disabled={saving || !form.problemId}>{saving ? "Creating…" : "Create & copy link"}</button>
        </form>
      </div>
    </Shell>
  );
}

function AssessmentTable({ title, items, empty, copied, onCopy }: { title: string; items: Assessment[]; empty: string; copied: string | null; onCopy: (id: string) => void }) {
  return (
    <div className="ol-card" style={{ marginTop: 0, padding: 0 }}>
      <div className="ol-section-title" style={{ padding: "18px 18px 0" }}>{title}</div>
      {items.length === 0 ? <p className="ol-muted" style={{ padding: "0 18px 12px" }}>{empty}</p> : (
        <table className="ol-table">
          <thead><tr><th>Assessment</th><th>Policy</th><th>Time</th><th /></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/company/${a.id}`}><strong>{a.title}</strong></Link><div className="ol-muted ol-small">{a.company}</div></td>
                <td className="ol-small">{POLICY_LABEL[a.aiPolicy]}</td>
                <td className="ol-small">{a.durationMin}m{a.voice ? " · voice" : ""}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ol-btn ol-btn-ghost" type="button" onClick={() => onCopy(a.id)} style={{ height: 32 }}>{copied === a.id ? "Copied ✓" : "Copy link"}</button>{" "}
                  <Link to={`/company/${a.id}`} className="ol-btn ol-btn-ghost" style={{ height: 32 }}>Candidates</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
