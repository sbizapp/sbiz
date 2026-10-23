/**
 * SBiz.app — Application router
 * Module ID: APP-ROUTER
 * Purpose: Dispatch requests to their responsible module.
 */
import { handleHealth } from "./modules/health.js";
import { routeMod01 } from "./modules/mod01.js";

const json = (body, status = 404) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
});

/* [APP-ROUTER][DISPATCH][START] */
export async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/assets/background-light.jpg" || url.pathname === "/assets/background-dark.jpg") {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method Not Allowed" }, 405);
    const key = url.pathname.slice(1);
    const object = await env.SBIZ_APP_R2.get(key);
    if (!object) return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
    const headers = new Headers({
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    headers.set("content-type", "image/jpeg");
    headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }
  if (url.pathname === "/health") {
    const response = handleHealth(request);
    return response ?? json({ error: "Method Not Allowed" }, 405);
  }
  const mod01Response = await routeMod01(request, env);
  if (mod01Response) return mod01Response;
  return json({ error: "Not Found" }, 404);
}
/* [APP-ROUTER][DISPATCH][END] */
