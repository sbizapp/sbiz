/**
 * Node-only compatibility shim for Worker modules that import Cloudflare runtime APIs.
 * Tests in this suite exercise request gating and never call the SMTP socket API.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:sockets") {
    return {
      url: "data:text/javascript,export%20function%20connect()%7Bthrow%20new%20Error('Cloudflare%20socket%20API%20is%20not%20available%20in%20Node%20tests')%7D",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
