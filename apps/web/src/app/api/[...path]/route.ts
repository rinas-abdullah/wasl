/**
 * Same-origin proxy: the browser only talks to this origin; requests are forwarded to the API
 * at RUNTIME (API_INTERNAL_URL), so the HttpOnly session cookie stays first-party and the same
 * image works on any host. Streams responses (Server-Sent Events included).
 */
export const dynamic = "force-dynamic";

const FORWARD_REQ = ["cookie", "content-type", "x-csrf-token", "idempotency-key", "user-agent", "accept", "x-request-id"];
const FORWARD_RES = ["content-type", "content-disposition", "cache-control", "idempotent-replay", "x-accel-buffering"];

function apiBase() {
  const raw = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  if (/^https?:\/\//.test(raw)) return raw.replace(/\/$/, "");
  return /:\d+$/.test(raw) ? `http://${raw}` : `https://${raw}`; // host:port → internal; bare host → public HTTPS
}

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const target = `${apiBase()}/api/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const res = await fetch(target, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: "manual", cache: "no-store" });
  const out = new Headers();
  for (const h of FORWARD_RES) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
