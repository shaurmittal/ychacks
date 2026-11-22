// Lane 03: animated interviewer face, driven by the real conversation audio.
// One requestAnimationFrame loop writes SVG attributes directly (no React re-render per frame).
// The loop only runs in live states (connecting/listening/speaking/muted); dimmed states render once, statically.
import { useEffect, useRef } from "react";

export type FaceState = "connecting" | "listening" | "speaking" | "muted" | "ended" | "error" | "off";

export type FaceLevels = {
  /** Agent output volume, 0..1 (useConversation().getOutputVolume). */
  output?: () => number;
  /** Candidate mic volume, 0..1 (useConversation().getInputVolume). */
  input?: () => number;
};

const LIVE: FaceState[] = ["connecting", "listening", "speaking", "muted"];
const LABEL: Record<FaceState, string> = {
  connecting: "connecting", listening: "listening", speaking: "speaking", muted: "your mic is muted",
  ended: "call ended", error: "disconnected", off: "voice off",
};

// Mouth geometry (viewBox units). Closed = a calm, slight smile; open = rounder.
const MOUTH_Y = 10.5;
function mouthPath(open: number): string {
  const w = 6.2 - open * 1.4;
  const top = 0.7 - open * 1.6; // upper lip lifts a little
  const bottom = 2.1 + open * 7.5; // jaw drops
  return `M ${-w} ${MOUTH_Y} Q 0 ${MOUTH_Y + top} ${w} ${MOUTH_Y} Q 0 ${MOUTH_Y + bottom} ${-w} ${MOUTH_Y} Z`;
}

const safe = (f?: () => number) => {
  if (!f) return 0;
  try { const v = f(); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; } catch { return 0; }
};

export function InterviewerFace({ state, levels, size = 80 }: { state: FaceState; levels?: FaceLevels; size?: number }) {
  const mouthRef = useRef<SVGPathElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const browsRef = useRef<SVGGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = LIVE.includes(state);

  useEffect(() => {
    const mouth = mouthRef.current, eyes = eyesRef.current, brows = browsRef.current, head = headRef.current, ring = ringRef.current;
    if (!mouth || !eyes || !brows || !head || !ring) return;
    if (!live) {
      // Static, dimmed rendering; no loop.
      mouth.setAttribute("d", mouthPath(0));
      eyes.setAttribute("transform", "");
      brows.setAttribute("transform", "");
      head.setAttribute("transform", "");
      ring.setAttribute("stroke-width", "1.5");
      ring.style.opacity = "0.5";
      return;
    }

    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let reduced = !!mq?.matches;
    const onMq = () => { reduced = !!mq?.matches; };
    mq?.addEventListener?.("change", onMq);

    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let out = 0, inp = 0;
    let peak = 0.2; // adaptive gain: the SDK volume is a mean of dB-scaled voice-band bins, so its range varies by voice/device
    let nextBlink = last + 1500 + Math.random() * 2500;
    let blinkStart = -1;
    let lastMouth = "", lastRing = "";

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const t = (now - t0) / 1000;

      // Mouth: agent output volume, fast attack / slower release; closed unless the agent is speaking.
      const target = s === "speaking" ? safe(levelsRef.current?.output) : 0;
      const tau = target > out ? 0.035 : 0.09;
      out += (target - out) * (1 - Math.exp(-dt / tau));
      peak = Math.max(out, peak - dt * 0.12, 0.2);
      const floor = Math.min(0.08, peak * 0.3);
      const open = Math.pow(Math.max(0, Math.min(1, (out - floor) / (peak - floor))), 1.15) * 0.95;
      const d = mouthPath(open);
      if (d !== lastMouth) { mouth.setAttribute("d", d); lastMouth = d; }

      // Ring: reacts to the candidate's mic while listening, to the agent's voice while speaking.
      const inTarget = s === "listening" ? safe(levelsRef.current?.input) : 0;
      inp += (inTarget - inp) * (1 - Math.exp(-dt / (inTarget > inp ? 0.05 : 0.2)));
      const lvl = s === "speaking" ? open : s === "listening" ? Math.min(1, inp * 3.5) : 0;
      const rw = (1.6 + lvl * 3.2).toFixed(2);
      const ro = (s === "connecting" || s === "muted" ? 0.9 : 0.45 + lvl * 0.55).toFixed(2);
      const rk = rw + ro;
      if (rk !== lastRing) { ring.setAttribute("stroke-width", rw); ring.style.opacity = ro; lastRing = rk; }

      // Blinks: ~140 ms every 2.5–6.5 s (kept with reduced motion: tiny and natural).
      if (blinkStart < 0 && now >= nextBlink) blinkStart = now;
      let lid = 1;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 140;
        if (p >= 1) { blinkStart = -1; nextBlink = now + 2500 + Math.random() * 4000; }
        else lid = Math.max(0.08, Math.abs(1 - 2 * p));
      }
      eyes.setAttribute("transform", lid === 1 ? "" : `translate(0 -7) scale(1 ${lid.toFixed(3)}) translate(0 7)`);

      // Attentive brows while listening; neutral otherwise.
      brows.setAttribute("transform", s === "listening" ? "translate(0 -0.8)" : "");

      // Idle motion: slow breathing + slight head sway (off with prefers-reduced-motion).
      if (reduced) head.setAttribute("transform", "");
      else {
        const sway = Math.sin(t * 0.9) * 1.3 + (s === "speaking" ? Math.sin(t * 2.3) * 0.6 : 0);
        const breathe = Math.sin(t * 1.6) * 0.45;
        head.setAttribute("transform", `translate(0 ${breathe.toFixed(2)}) rotate(${sway.toFixed(2)} 0 18)`);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); mq?.removeEventListener?.("change", onMq); };
  }, [live]);

  return (
    <div className={`olf olf-${state}`} style={{ width: size, height: size }}>
      <svg viewBox="-50 -50 100 100" width={size} height={size} role="img" aria-label={`Interviewer, ${LABEL[state]}`}>
        <defs>
          <radialGradient id="olf-bg" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </radialGradient>
          <clipPath id="olf-clip"><circle r="45" /></clipPath>
        </defs>
        <circle r="45" fill="url(#olf-bg)" />
        <g clipPath="url(#olf-clip)">
          {/* shoulders + collar */}
          <path d="M -40 52 C -38 32 -22 25 0 25 C 22 25 38 32 40 52 Z" fill="#334155" />
          <path d="M -10 25.5 L 0 39 L 10 25.5 Z" fill="#f8fafc" />
          <path d="M -3 32 L 0 39 L 3 32 L 0 29 Z" fill="#2f5bea" opacity="0.9" />
          <g ref={headRef}>
            <rect x="-5.5" y="12" width="11" height="15" rx="4" fill="#e3d3c4" />
            <ellipse cx="-18.6" cy="-3" rx="3" ry="5" fill="#ecdccd" />
            <ellipse cx="18.6" cy="-3" rx="3" ry="5" fill="#ecdccd" />
            <ellipse cx="0" cy="-4" rx="18.5" ry="21.5" fill="#f1e4d6" />
            {/* hair */}
            <path d="M -19.4 -4 C -21.5 -25 -7 -30.5 2 -29.8 C 14 -29.2 21.2 -21.5 19.5 -4 C 18.6 -11 16.4 -15.5 12.5 -18 C 7 -14 -3 -13.6 -10.5 -17.6 C -15 -15 -18 -10 -19.4 -4 Z" fill="#3a4452" />
            <g ref={browsRef}>
              <path d="M -12 -13.2 Q -8.5 -14.8 -4.6 -13.4" stroke="#3a4452" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M 4.6 -13.4 Q 8.5 -14.8 12 -13.2" stroke="#3a4452" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </g>
            <g ref={eyesRef}>
              <ellipse cx="-8" cy="-7" rx="2.1" ry="2.5" fill="#1f2937" />
              <ellipse cx="8" cy="-7" rx="2.1" ry="2.5" fill="#1f2937" />
              <circle cx="-7.3" cy="-7.9" r="0.6" fill="#fff" opacity="0.85" />
              <circle cx="8.7" cy="-7.9" r="0.6" fill="#fff" opacity="0.85" />
            </g>
            <path d="M -1.6 3.4 Q 0 4.4 1.6 3.4" stroke="#c7ad97" strokeWidth="1" strokeLinecap="round" fill="none" />
            <path ref={mouthRef} d={mouthPath(0)} fill="#8c4b4f" />
          </g>
        </g>
        <circle ref={ringRef} className="olf-ring" r="47" fill="none" strokeWidth="1.6" />
      </svg>
    </div>
  );
}
