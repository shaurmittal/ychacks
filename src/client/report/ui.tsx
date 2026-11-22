// Lane 04: shared bits for Landing / Report / Company pages.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Report } from "../../shared/types";
import "./oarlock.css";

export function Shell({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="ol">
      <nav className="ol-nav">
        <Link to="/" className="ol-brand"><span className="ol-brand-mark">⟂</span>Overwatch</Link>
        <div className="ol-nav-links">
          <Link to="/">Practice</Link>
          <Link to="/company">For companies</Link>
        </div>
      </nav>
      <div className={`ol-wrap${narrow ? " ol-narrow" : ""}`}>{children}</div>
    </div>
  );
}

export const REC_LABEL: Record<Report["recommendation"], string> = {
  strong_yes: "Strong yes", yes: "Yes", lean_no: "Lean no", no: "No",
};
export const PRACTICE_LABEL: Record<Report["recommendation"], string> = {
  strong_yes: "Interview-ready", yes: "Interview-ready", lean_no: "Almost there", no: "Keep practising",
};
const REC_TONE: Record<Report["recommendation"], string> = {
  strong_yes: "good", yes: "ok", lean_no: "warn", no: "bad",
};

export function RecChip({ rec, practice }: { rec: Report["recommendation"]; practice: boolean }) {
  return <span className={`ol-chip ol-chip-${REC_TONE[rec]}`}>{practice ? PRACTICE_LABEL[rec] : REC_LABEL[rec]}</span>;
}

export const scoreColor = (v: number) => (v >= 4 ? "var(--good)" : v >= 3 ? "var(--accent)" : v >= 2 ? "var(--warn)" : "var(--bad)");

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="ol-bar-label"><span>{label}</span><span>{value}/5</span></div>
      <div className="ol-bar"><span style={{ width: `${(value / 5) * 100}%`, background: scoreColor(value) }} /></div>
    </div>
  );
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;
