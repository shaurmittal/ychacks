import { defineConfig, type Plugin } from "vite";
import { wasp } from "wasp/client/vite";

// Lane 04: the dev server is tunnelled to strangers, and Vite serves any file under the project root.
// Block server code, hidden tests (problems.ts), the data store and tests; client code never imports these.
const BLOCKED = /(^|\/)(src\/server\/|src\/shared\/problems(\.ts)?$|data\/|\.env|[^/]+\.test\.tsx?$)/;
function blockPrivateFiles(): Plugin {
  return {
    name: "oarlock-block-private-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path = (req.url ?? "").split("?")[0];
        try { path = decodeURIComponent(path); } catch { /* keep raw */ }
        if (BLOCKED.test(path)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [blockPrivateFiles(), wasp()],
  // Allow cloudflared tunnel hosts (mic needs HTTPS on other people's devices).
  server: { allowedHosts: true },
});
