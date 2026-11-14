import type { Config } from "@netlify/functions";
import { subs, keyFor, configure, send } from "../lib/push.mjs";

// Save, update or remove a phone's push subscription and its watch list.
function crewOk(req: Request) {
  const code = Netlify.env.get("DRIFTLINE_CREW_CODE");
  if (!code) return true;
  return (req.headers.get("x-crew-code") || "").trim().toLowerCase() === code.trim().toLowerCase();
}
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

export default async (req: Request) => {
  if (req.method === "GET") return Response.json({ publicKey: Netlify.env.get("VAPID_PUBLIC_KEY") || null });
  if (!crewOk(req)) return Response.json({ error: "Join the crew to turn on alerts." }, { status: 401 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const endpoint = b?.subscription?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return Response.json({ error: "Missing subscription." }, { status: 400 });
  const key = await keyFor(endpoint);

  if (req.method === "DELETE") { await subs().delete(key); return Response.json({ ok: true }); }

  const prev: any = (await subs().get(key, { type: "json" })) || {};
  const watch = (Array.isArray(b.watch) ? b.watch : []).slice(0, 30).map((w: any) => ({
    id: String(w.id || "").slice(0, 60), name: String(w.name || "").slice(0, 80), gauge: /^[0-9]{8,15}$/.test(w.gauge) ? w.gauge : null,
    idealLo: num(w.idealLo), idealHi: num(w.idealHi), hi: num(w.hi),
  })).filter((w: any) => w.id);
  const rec = {
    sub: b.subscription, name: String(b.name || "").slice(0, 40), crew: b.crew !== false, flows: b.flows !== false,
    watch, last: prev.last || {}, updated: Date.now(),
  };
  await subs().setJSON(key, rec);
  if (b.test && configure()) await send(key, rec, { title: "Driftline alerts are on", body: watch.length ? `Watching ${watch.map((w: any) => w.name).join(", ")}.` : "Star a river to get flow alerts for it.", url: "/#home" });
  return Response.json({ ok: true });
};

export const config: Config = {
  path: "/api/push",
  method: ["GET", "POST", "DELETE"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 30 },
};
