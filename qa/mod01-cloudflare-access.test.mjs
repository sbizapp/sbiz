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

const encoder = new TextEncoder();
const accessTestTeam = "unit-test.cloudflareaccess.com";
const accessTestAudience = "unit-test-audience";
let signingKeysPromise;

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJson(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

async function getSigningKeys() {
  if (!signingKeysPromise) {
    signingKeysPromise = (async () => {
      const pair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      );
      const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
      publicJwk.kid = "sbiz-access-test-key";
      publicJwk.use = "sig";
      publicJwk.alg = "RS256";
      return { privateKey: pair.privateKey, publicJwk };
    })();
  }
  return signingKeysPromise;
}

async function makeAccessToken(claimOverrides = {}, keyOverride = null) {
  const keys = await getSigningKeys();
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "sbiz-access-test-key" });
  const claims = encodeJson({
    iss: "https://" + accessTestTeam,
    aud: accessTestAudience,
    exp: Math.floor(Date.now() / 1000) + 300,
    email: "owner@sbiz.app",
    ...claimOverrides,
  });
  const unsigned = header + "." + claims;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyOverride || keys.privateKey,
    encoder.encode(unsigned),
  );
  return unsigned + "." + base64url(new Uint8Array(signature));
}

async function withMockAccessJwks(run) {
  const keys = await getSigningKeys();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(String(input), "https://" + accessTestTeam + "/cdn-cgi/access/certs");
    return new Response(JSON.stringify({ keys: [keys.publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function accessTestEnv(audience = accessTestAudience) {
  return { CF_ACCESS_TEAM_DOMAIN: accessTestTeam, CF_ACCESS_AUD: audience };
}

test("accepts a correctly signed JWT with matching issuer, audience, expiry and email", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken();
    const result = await verifyCloudflareAccess(
      new Request("https://sbiz.app/admin", { headers: { "cf-access-jwt-assertion": token } }),
      accessTestEnv(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.claims.email, "owner@sbiz.app");
  });
});

test("rejects a correctly signed JWT with the wrong audience", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken();
    const result = await verifyCloudflareAccess(
      new Request("https://sbiz.app/admin", { headers: { "cf-access-jwt-assertion": token } }),
      accessTestEnv("different-audience"),
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "INVALID_ACCESS_TOKEN");
  });
});

test("rejects a correctly signed JWT with the wrong issuer", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken({ iss: "https://attacker.cloudflareaccess.com" });
    const result = await verifyCloudflareAccess(
      new Request("https://sbiz.app/admin", { headers: { "cf-access-jwt-assertion": token } }),
      accessTestEnv(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "INVALID_ACCESS_TOKEN");
  });
});

test("rejects an expired, correctly signed JWT", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const result = await verifyCloudflareAccess(
      new Request("https://sbiz.app/admin", { headers: { "cf-access-jwt-assertion": token } }),
      accessTestEnv(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "INVALID_ACCESS_TOKEN");
  });
});

test("Worker admits a valid Access JWT to the protected admin API", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken();
    const env = {
      ...accessTestEnv(),
      SBIZ_APP_DB: {
        prepare() {
          return {
            bind() {
              return {
                async all() { return { results: [] }; },
              };
            },
          };
        },
      },
    };
    const response = await worker.fetch(
      new Request("https://sbiz.app/api/v1/admin/businesses", {
        headers: { "cf-access-jwt-assertion": token },
      }),
      env,
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { businesses: [] });
  });
});

test("Admin page follows the minimal white UI standard", async () => {
  await withMockAccessJwks(async () => {
    const token = await makeAccessToken();
    const response = await worker.fetch(
      new Request("https://sbiz.app/admin", {
        headers: { "cf-access-jwt-assertion": token },
      }),
      {
        ...accessTestEnv(),
        SBIZ_APP_R2: {
          async get() { return null; },
        },
      },
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /font-family:Roboto,Arial,sans-serif/);
    assert.match(page, /--ui-surface:#fff/);
    assert.match(page, /--ui-border:#e5e7eb/);
    assert.match(page, /--ui-shadow:0 1px 2px rgba\(0,0,0,.05\)/);
    assert.match(page, /background:#fff/);
    assert.match(page, /@media\(max-width:640px\)/);
    assert.match(page, /button,\.button\{[^}]*background:#fff/);
    assert.match(page, /input,select,textarea\{[^}]*background:#fff[^}]*border:1px solid #e5e7eb/);
    assert.match(page, /table\{[^}]*background:#fff/);
    assert.match(page, /th,td\{[^}]*background:#fff/);
    assert.match(page, /color-scheme:light/);
    assert.match(page, /header\{[^}]*background:#fff[^}]*border-bottom:1px solid #e5e7eb/);
    assert.match(page, /\.panel,\.detail\{[^}]*background:#fff[^}]*box-shadow:0 1px 2px rgba\(0,0,0,\.05\)/);
    assert.match(page, /\.panel-head\{[^}]*background:#fff[^}]*border-bottom:1px solid #e5e7eb/);
    assert.match(page, /\.table-wrap\{[^}]*background:#fff/);
    assert.match(page, /input,select,textarea\{[^}]*background:#fff[^}]*border:1px solid #e5e7eb/);
    assert.match(page, /button:hover,\.button:hover,button\.secondary:hover\{[^}]*border-color:#9ca3af/);
    assert.match(page, /button:focus-visible,\.button:focus-visible\{outline:2px solid #9ca3af/);
    assert.doesNotMatch(page, /backdrop-filter|--glass|linear-gradient|prefers-color-scheme:dark/);
    assert.doesNotMatch(page, /background[^;]*url\(["']?\/assets\/background-/);
  });
});

test("all public account pages use the same minimal white typography and surfaces", async () => {
  for (const path of ["/", "/create", "/login", "/verify", "/change-email", "/forgot-password", "/reset-password"]) {
    const response = await worker.fetch(
      new Request("https://sbiz.app" + path),
      {},
      { waitUntil() {} },
    );
    assert.equal(response.status, 200, path + " should render");
    const page = await response.text();
    assert.match(page, /font-family:Roboto,ui-sans-serif,system-ui,sans-serif|font-family:Roboto,Arial,sans-serif/, path + " should use the approved font stack");
    assert.match(page, /background:#fff/, path + " should use a white surface");
    assert.match(page, /border:1px solid #e5e7eb/, path + " should use a light-gray border");
    assert.doesNotMatch(page, /backdrop-filter|linear-gradient|prefers-color-scheme:dark|background[^;]*url\(["']?\/assets\/background-/, path + " should not contain legacy decorative styling");
  }
});
