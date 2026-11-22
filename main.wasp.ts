import { api, apiNamespace, app, page, route } from "@wasp.sh/spec";
import { LandingPage } from "./src/client/pages/LandingPage" with { type: "ref" };
import { TakePage } from "./src/client/pages/TakePage" with { type: "ref" };
import { ReportPage } from "./src/client/pages/ReportPage" with { type: "ref" };
import { CompanyPage } from "./src/client/pages/CompanyPage" with { type: "ref" };
import { AssessmentSessionsPage } from "./src/client/pages/AssessmentSessionsPage" with { type: "ref" };
import { listAssessments, createAssessment, getAssessment, listAssessmentSessions } from "./src/server/assessments" with { type: "ref" };
import { createSession, postEvents, submitSession, getSession } from "./src/server/sessions" with { type: "ref" };
import { apiMiddleware } from "./src/server/middleware" with { type: "ref" };
import { assist } from "./src/server/assist" with { type: "ref" };

export default app({
  name: "oarlock",
  wasp: { version: "^0.26.1" },
  title: "Oarlock",
  head: ["<link rel='icon' href='/favicon.ico' />"],
  spec: [
    route("LandingRoute", "/", page(LandingPage)),
    route("TakeRoute", "/take/:assessmentId", page(TakePage)),
    route("ReportRoute", "/report/:sessionId", page(ReportPage)),
    route("CompanyRoute", "/company", page(CompanyPage)),
    route("AssessmentSessionsRoute", "/company/:assessmentId", page(AssessmentSessionsPage)),

    // Default middleware enables CORS (needed for tunnels / separate client origin).
    apiNamespace("/api", { middlewareConfigFn: apiMiddleware }),
    api("GET", "/api/assessments", listAssessments),
    api("POST", "/api/assessments", createAssessment),
    api("GET", "/api/assessments/:id", getAssessment),
    api("GET", "/api/assessments/:id/sessions", listAssessmentSessions),
    api("POST", "/api/sessions", createSession),
    api("POST", "/api/sessions/:id/events", postEvents),
    api("POST", "/api/sessions/:id/submit", submitSession),
    api("GET", "/api/sessions/:id", getSession),
    api("POST", "/api/assist", assist),
  ],
});
