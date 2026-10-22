/**
 * SBiz.app — Worker entry point
 * Purpose: Connect the Cloudflare Worker runtime to the application router.
 * Product features belong in focused modules, not in this file.
 */

import { routeRequest } from "./src/router.js";

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
};
/* [WORKER][ENTRY][END] */
