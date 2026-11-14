import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { allSubs, configure, send } from "../lib/push.mjs";

// Shared crew data: fishing reports and catches (one blob per entry, so two
// friends posting at once never overwrite each other) plus optional photos.
const entries = () => getStore({ name: "crew-entries", consistency: "strong" });
const photos = () => getStore({ name: "crew-photos", consistency: "strong" });

const MAX_PHOTO_B64 = 1_500_000;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : v === null || v === "" || v === undefined ? null : isFinite(Number(v)) ? Number(v) : null);

function crewOk(req: Request) {
  const code = Netlify.env.get("DRIFTLINE_CREW_CODE");
  if (!code) return true;
  const url = new URL(req.url);
  const got = req.headers.get("x-crew-code") || url.searchParams.get("code") || "";
  return got.trim().toLowerCase() === code.trim().toLowerCase();
}

async function notifyCrew(item: any) {
  if (!configure()) return;
  const river = String(item.river || "").split(" · ")[0] || "the river";
  const title = item.type === "catch"
    ? `${item.angler} caught ${item.length ? `a ${item.length}" ` : "a "}${String(item.species || "fish").toLowerCase()}`
    : `${item.angler} posted a report`;
  const body = item.type === "catch" ? `On ${river}${item.fly ? ` with a ${item.fly}` : ""}.` : `${river}: ${["", "slow", "fair", "good", "great", "epic"][item.rating || 0] || "new report"}. ${String(item.notes || "").slice(0, 90)}`;
  for (const [key, rec] of await allSubs()) {
    if (rec.crew === false) continue;
    if (String(rec.name || "").toLowerCase() === String(item.angler).toLowerCase()) continue;
    await send(key, rec, { title, body, url: "/#crew", tag: "crew-" + item.id });
  }
}

export default async (req: Request, context: any) => {
  const url = new URL(req.url);

  if (url.searchParams.get("ping")) {
    return Response.json({ ok: true, needsCode: !!Netlify.env.get("DRIFTLINE_CREW_CODE"), authed: crewOk(req) });
  }
  if (!crewOk(req)) return Response.json({ error: "That crew code isn't right." }, { status: 401 });

  try {
    const photoId = url.searchParams.get("photo");
    if (req.method === "GET" && photoId) {
      if (!/^[0-9a-z-]+$/.test(photoId)) return new Response("Bad id", { status: 400 });
      const img = await photos().get(photoId, { type: "arrayBuffer" });
      if (img === null) return new Response("Not found", { status: 404 });
      return new Response(img, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=604800" } });
    }

    if (req.method === "GET") {
      const { blobs } = await entries().list({ prefix: "e/" });
      const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 400);
      const items = (await Promise.all(keys.map((k) => entries().get(k, { type: "json" })))).filter(Boolean);
      return Response.json({ items }, { headers: { "cache-control": "no-store" } });
    }

    if (req.method === "POST") {
      let b: any;
      try {
        b = await req.json();
      } catch {
        return Response.json({ error: "Request body must be JSON." }, { status: 400 });
      }
      const type = b.type === "report" ? "report" : b.type === "catch" ? "catch" : b.type === "pin" ? "pin" : null;
      const angler = str(b.angler, 40);
      if (!type || !angler) return Response.json({ error: "A type and your name are required." }, { status: 400 });
      const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 8);
      let hasPhoto = false;
      if (typeof b.photo === "string" && b.photo.length) {
        if (b.photo.length > MAX_PHOTO_B64) return Response.json({ error: "Photo is too large." }, { status: 413 });
        const bytes = Uint8Array.from(atob(b.photo), (c) => c.charCodeAt(0));
        await photos().set(id, bytes.buffer as ArrayBuffer);
        hasPhoto = true;
      }
      const item = {
        id, type, angler, hasPhoto, created: Date.now(),
        date: str(b.date, 10), riverId: str(b.riverId, 60), river: str(b.river, 120),
        species: str(b.species, 40), length: num(b.length), fly: str(b.fly, 80),
        rating: num(b.rating), flies: str(b.flies, 200), notes: str(b.notes, 1500),
        sky: str(b.sky, 12), cfs: num(b.cfs), wtF: num(b.wtF), airF: num(b.airF), pressure: num(b.pressure), moon: str(b.moon, 20),
        lat: num(b.lat), lon: num(b.lon), pinType: str(b.pinType, 20), name: str(b.name, 80),
      };
      await entries().setJSON("e/" + id, item);
      if (type !== "pin") context?.waitUntil?.(notifyCrew(item).catch((e) => console.error("notify failed", e)));
      return Response.json({ item });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      const who = (url.searchParams.get("angler") || "").trim().toLowerCase();
      if (!/^[0-9a-z-]+$/.test(id)) return Response.json({ error: "Bad id." }, { status: 400 });
      const item: any = await entries().get("e/" + id, { type: "json" });
      if (item === null) return Response.json({ ok: true });
      if (String(item.angler).toLowerCase() !== who) return Response.json({ error: "You can only delete your own posts." }, { status: 403 });
      await entries().delete("e/" + id);
      if (item.hasPhoto) await photos().delete(id);
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e) {
    console.error("crew function error", e);
    return Response.json({ error: "Crew storage had a problem. Try again." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/crew",
  method: ["GET", "POST", "DELETE"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
