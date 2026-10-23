import test from "node:test";
import assert from "node:assert/strict";
import { verifyCloudflareAccess } from "../src/shared/cloudflare-access.js";

test("fails closed when Cloudflare Access configuration is missing", async () => {
  const request = new Request("https://sbiz.app/admin");
  const result = await verifyCloudflareAccess(request, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "CLOUDFLARE_ACCESS_NOT_CONFIGURED");
});

test("rejects protected requests without an Access JWT", async () => {
  const request = new Request("https://sbiz.app/api/v1/admin/businesses");
  const env = {
    CF_ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
    CF_ACCESS_AUD: "example-audience",
  };
  const result = await verifyCloudflareAccess(request, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, "CLOUDFLARE_ACCESS_REQUIRED");
});

test("rejects malformed Access configuration rather than trusting the request", async () => {
  const request = new Request("https://sbiz.app/admin", {
    headers: { "cf-access-jwt-assertion": "not-a-jwt" },
  });
  const result = await verifyCloudflareAccess(request, {
    CF_ACCESS_TEAM_DOMAIN: "attacker.example",
    CF_ACCESS_AUD: "example-audience",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error, "CLOUDFLARE_ACCESS_NOT_CONFIGURED");
});
