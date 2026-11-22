// Lane 01 owns this file. Countdown to the deadline; red under 5 min; fires onExpire once.
import { useEffect, useRef, useState } from "react";
import { formatClock } from "./format";

export function Timer({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const left = deadline - now;
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      expire.current();
    }
  }, [left]);

  const cls = left <= 60_000 ? "timer timer-critical" : left <= 5 * 60_000 ? "timer timer-low" : "timer";
  return (
    <div className={cls} role="timer" aria-label="Time left">
      <span className="timer-dot" />
      {formatClock(left)}
      <span className="timer-label">left</span>
    </div>
  );
}
