/**
 * SBiz.app — Worker entry point
 * Purpose: Connect Cloudflare Worker HTTP and scheduled events to the application.
 */
import { routeRequest } from "./src/router.js";
import { cleanupMod01 } from "./src/modules/mod01.js";

/* [WORKER][ENTRY][START] */
export default {
  async fetch(request, env, ctx) {
    try {
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
