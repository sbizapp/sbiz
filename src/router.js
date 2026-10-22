/**
 * SBiz.app — Application router
 * Module ID: APP-ROUTER
 * Purpose: Dispatch requests to their responsible module.
 */

import { handleHealth } from "./modules/health.js";

const json = (body, status = 404) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

/* [APP-ROUTER][DISPATCH][START]
 * Responsibility: Route requests without embedding feature logic here.
 */
export async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    const response = handleHealth(request);
    return response ?? json({ error: "Method Not Allowed" }, 405);
  }

  return json({ error: "Not Found" }, 404);
}
/* [APP-ROUTER][DISPATCH][END] */
