// Lane 03 owns this file (ElevenLabs voice interviewer).
import type { Assessment, Problem } from "../../shared/types";

export function InterviewerWidget(_props: { sessionId: string; assessment: Assessment; problem: Omit<Problem, "hiddenTests">; candidateName: string; minutesLeft: () => number; onEnd?: () => void }) {
  return <div>Interviewer (stub)</div>;
}
