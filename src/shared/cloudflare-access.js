/**
 * Verify Cloudflare Access JWTs at the Worker boundary.
 *
 * Required Worker vars:
 *   CF_ACCESS_TEAM_DOMAIN = "<team-name>.cloudflareaccess.com"
 *   CF_ACCESS_AUD = the Access application's AUD tag
 *
 * Fail closed if config, token, signing key, or claims are invalid.
 */
let cachedJwks = null;
let cachedJwksAt = 0;
const JWKS_TTL_MS = 5 * 60 * 1000;

const decodeBase64Url = value => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function accessConfig(env) {
  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) || !audience) return null;
  return { teamDomain, audience, issuer: "https://" + teamDomain };
}

async function loadJwks(teamDomain, forceRefresh = false) {
  if (!forceRefresh && cachedJwks && Date.now() - cachedJwksAt < JWKS_TTL_MS) return cachedJwks;
  const response = await fetch("https://" + teamDomain + "/cdn-cgi/access/certs", {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Cloudflare Access signing keys unavailable");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("Invalid Cloudflare Access signing-key response");
  cachedJwks = body.keys;
  cachedJwksAt = Date.now();
  return cachedJwks;
}

async function verifySignature(parts, teamDomain) {
  const header = decodeJsonPart(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  let keys = await loadJwks(teamDomain);
  let jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.use !== "enc");
  if (!jwk) {
    keys = await loadJwks(teamDomain, true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.use !== "enc");
  }
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
}

export async function verifyCloudflareAccess(request, env) {
  const config = accessConfig(env);
  if (!config) return { ok: false, status: 503, error: "CLOUDFLARE_ACCESS_NOT_CONFIGURED" };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, error: "CLOUDFLARE_ACCESS_REQUIRED" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };

  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header.alg !== "RS256" || !(await verifySignature(parts, config.teamDomain))) {
      return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };
    }
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== config.issuer ||
      !audiences.includes(config.audience) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
      typeof claims.email !== "string" ||
      !claims.email.includes("@")
    ) {
      return { ok: false, status: 401, error: "INVALID_ACCESS_TOKEN" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, status: 503, error: "ACCESS_VERIFICATION_UNAVAILABLE" };
  }
}
