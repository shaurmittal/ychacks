"""Prove Fiber setup: healthCheck + free credit-balance check. Never prints the key."""
import os
from dotenv import load_dotenv
from fiberai import AuthenticatedClient
from fiberai.api.utility import health_check

load_dotenv()
key = os.environ.get("FIBER_API_KEY")
if not key:
    raise SystemExit("FIBER_API_KEY not set")
client = AuthenticatedClient(base_url="https://api.fiber.ai", token=key)
r = health_check.sync_detailed(client=client)
print("healthCheck:", r.status_code, r.content.decode()[:500])
r2 = client.get_httpx_client().get("/v1/get-org-credits", headers={"x-api-key": key})
print("getOrgCredits:", r2.status_code, r2.text[:500])
