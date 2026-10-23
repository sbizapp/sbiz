/**
 * SBiz.app — Health module
 * Module ID: HEALTH
 * Purpose: Expose a minimal runtime health endpoint.
 */

/* [HEALTH][BACKEND][START]
 * Responsibility: Respond to GET /health only.
 */
export function handleHealth(request) {
  if (request.method !== "GET") return null;

  return new Response(
    JSON.stringify({
      status: "ok",
      service: "sbiz",
      phase: "mod01",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
/* [HEALTH][BACKEND][END] */
