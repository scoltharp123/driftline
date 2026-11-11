import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

// Powers "Ask a Guide" (streamed text) and "Photo ID" (JSON) through
// Netlify AI Gateway. The gateway injects ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL.
const MODEL = "claude-sonnet-5-5";
const MAX_IMAGE_B64 = 4_000_000; // stays under the 6 MB function payload limit

type Msg = { role: "user" | "assistant"; content: string };

// Only people with the crew code can spend AI credits.
function crewOk(req: Request) {
  const code = Netlify.env.get("DRIFTLINE_CREW_CODE");
  if (!code) return true;
  const got = req.headers.get("x-crew-code") || "";
  return got.trim().toLowerCase() === code.trim().toLowerCase();
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const gateway = !!Netlify.env.get("ANTHROPIC_BASE_URL") || !!Netlify.env.get("ANTHROPIC_API_KEY");
  if (req.method === "GET") {
    return Response.json({ ok: gateway && crewOk(req) });
  }
  if (!crewOk(req)) return Response.json({ error: "Enter the crew code to use AI features." }, { status: 401 });
  if (!Netlify.env.get("ANTHROPIC_API_KEY") && !Netlify.env.get("ANTHROPIC_BASE_URL")) {
    return Response.json({ error: "AI isn't turned on for this site yet." }, { status: 503 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const client = new Anthropic();
  const mode = url.searchParams.get("mode");

  if (mode === "json") {
    const prompt = String(body.prompt || "").slice(0, 6000);
    const content: any[] = [];
    if (body.image && typeof body.image === "string") {
      if (body.image.length > MAX_IMAGE_B64) return Response.json({ error: "Photo is too large." }, { status: 413 });
      const mt = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(body.mediaType) ? body.mediaType : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: mt, data: body.image } });
    }
    content.push({ type: "text", text: prompt + "\n\nRespond with a single JSON object and nothing else." });
    try {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content }] });
      const text = msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
      const m = text.match(/\{[\s\S]*\}/);
      return Response.json(m ? JSON.parse(m[0]) : { error: "No answer." });
    } catch (e: any) {
      return Response.json({ error: "Identification failed." }, { status: e?.status === 429 ? 429 : 500 });
    }
  }

  // Streamed chat
  const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Send at least one question." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = client.messages.stream({ model: MODEL, max_tokens: 1200, messages });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && (ev as any).delta?.type === "text_delta") {
            controller.enqueue(encoder.encode((ev as any).delta.text));
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode("\n\n[The guide couldn't finish that answer. Try again.]"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

export const config: Config = {
  path: "/api/ai",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 8 },
};
