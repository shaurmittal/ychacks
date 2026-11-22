import { defineConfig } from "vite";
import { wasp } from "wasp/client/vite";

export default defineConfig({
  plugins: [wasp()],
  // Allow cloudflared tunnel hosts (mic needs HTTPS on other people's devices).
  server: { allowedHosts: true },
});
