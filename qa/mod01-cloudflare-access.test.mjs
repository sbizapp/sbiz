import test from "node:test";
import assert from "node:assert/strict";
import { verifyCloudflareAccess } from "../src/shared/cloudflare-access.js";
import worker from "../worker.js";

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

test("Worker blocks /admin when Access configuration is missing", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/admin"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "CLOUDFLARE_ACCESS_NOT_CONFIGURED");
});

test("Worker blocks admin API requests without an Access JWT", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/api/v1/admin/businesses"),
    {
      CF_ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
      CF_ACCESS_AUD: "example-audience",
    },
    { waitUntil() {} },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "CLOUDFLARE_ACCESS_REQUIRED");
});

test("Worker does not trust a forged internal email header", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/api/v1/admin/businesses", {
      headers: { "x-sbiz-verified-access-email": "admin@sbiz.app" },
    }),
    {
      CF_ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
      CF_ACCESS_AUD: "example-audience",
    },
    { waitUntil() {} },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "CLOUDFLARE_ACCESS_REQUIRED");
});

test("normal login page remains available without Cloudflare Access configuration", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/login"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.match(await response.text(), /Login/);
});

test("normal account creation page remains available without Cloudflare Access configuration", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/create"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.match(await response.text(), /Create your SBiz account/);
});

test("normal login API is not intercepted by the Admin Access gate", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/api/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_CREDENTIALS");
});

test("normal home page remains available without Cloudflare Access configuration", async () => {
  const response = await worker.fetch(
    new Request("https://sbiz.app/"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Create/);
});
