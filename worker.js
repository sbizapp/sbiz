/**
 * SBiz.app — Worker entry point
 * Purpose: Connect Cloudflare Worker HTTP and scheduled events to the application.
 */
import { routeRequest } from "./src/router.js";
import { cleanupMod01 } from "./src/modules/mod01.js";
import { verifyCloudflareAccess } from "./src/shared/cloudflare-access.js";

/* [WORKER][ENTRY][START] */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const protectedPath = path === "/admin" || path.startsWith("/admin/") ||
        path === "/api/v1/admin" || path.startsWith("/api/v1/admin/");

      // Never trust an incoming internal header; it is only set after JWT verification below.
      const headers = new Headers(request.headers);
      headers.delete("x-sbiz-verified-access-email");
      request = new Request(request, { headers });

      if (protectedPath) {
        const access = await verifyCloudflareAccess(request, env);
        if (!access.ok) {
          return new Response(JSON.stringify({ error: access.error }), {
            status: access.status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }
        const verifiedHeaders = new Headers(request.headers);
        verifiedHeaders.set("x-sbiz-verified-access-email", access.claims.email);
        request = new Request(request, { headers: verifiedHeaders });
      }

      return await routeRequest(request, env, ctx);
    } catch {
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupMod01(env));
  },
};
/* [WORKER][ENTRY][END] */
