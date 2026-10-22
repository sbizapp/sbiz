/**
 * SBiz.app — Worker bootstrap
 *
 * Purpose: verify that the initial Cloudflare Worker can be deployed and reached.
 * This is infrastructure smoke-test code only; it is not a product API.
 * No database writes, public asset access, authentication, or product features.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "ok",
        service: "sbiz-app",
        phase: "bootstrap",
      });
    }

    return json({ error: "Not Found" }, 404);
  },
};
