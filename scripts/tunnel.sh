#!/usr/bin/env bash
# Lane 04: public HTTPS for strangers' laptops/phones (mic needs HTTPS).
# Starts two cloudflared quick tunnels (client + server), then `wasp start` with matching URLs.
# Usage: scripts/tunnel.sh [clientPort=3000] [serverPort=3001]
set -euo pipefail
CP=${1:-3000}; SP=${2:-3001}
LOG=$(mktemp -d)
cloudflared tunnel --no-autoupdate --url "http://localhost:$CP" >"$LOG/client.log" 2>&1 & C_PID=$!
cloudflared tunnel --no-autoupdate --url "http://localhost:$SP" >"$LOG/server.log" 2>&1 & S_PID=$!
trap 'kill $C_PID $S_PID 2>/dev/null || true' EXIT
url() { for _ in $(seq 1 60); do u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" | head -1 || true); [ -n "$u" ] && { echo "$u"; return; }; sleep 1; done; echo "tunnel failed, see $1" >&2; exit 1; }
CLIENT_URL=$(url "$LOG/client.log"); SERVER_URL=$(url "$LOG/server.log")
echo "Client (share this): $CLIENT_URL"
echo "Server:              $SERVER_URL"
echo "$CLIENT_URL" > "$LOG/../oarlock-public-url.txt" 2>/dev/null || true
wasp start --client-port "$CP" --server-port "$SP" --client-url "$CLIENT_URL" --server-url "$SERVER_URL"
