// Publiczny test życia: tylko {ok}. Szczegóły błędu bazy (host, użytkownik) i lista kluczy modeli trafiają do logów, nie do odpowiedzi.
// ?live=1 (paczka 60): czy działa sygnał zmian. Tylko kody i krótki komunikat Supabase, bez adresu, klucza i nazwy kanału.
import { request } from "node:https";
import { sql } from "@/lib/db";
import { supabaseUrl } from "@/lib/live-signal";

export const dynamic = "force-dynamic";

function handshake(url: string): Promise<{ status: number; msg: string }> {
  return new Promise((done) => {
    const r = request(url, { headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" }, timeout: 5000 });
    r.on("upgrade", (res, socket) => { socket.destroy(); done({ status: res.statusCode ?? 101, msg: "" }); });
    r.on("response", (res) => { let b = ""; res.on("data", (c) => { if (b.length < 300) b += String(c); }); res.on("end", () => done({ status: res.statusCode ?? 0, msg: b.replace(/\s+/g, " ").slice(0, 160) })); });
    r.on("timeout", () => { r.destroy(); done({ status: 0, msg: "timeout" }); });
    r.on("error", (e) => done({ status: 0, msg: e.message.slice(0, 120) }));
    r.end();
  });
}

async function liveCheck() {
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const url = supabaseUrl();
  const kind = !key ? "brak" : key.startsWith("sb_publishable_") ? "publishable" : key.startsWith("sb_secret_") ? "SEKRETNY (zły)" : key.startsWith("ey") ? "anon (jwt)" : "inny";
  let send = false;
  try { const [r] = await sql()`select to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null as ok`; send = !!r?.ok; } catch { /* bez bazy */ }
  if (!key || !url) return { key: kind, url: !!url, send };
  const h = await handshake(`${url}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`);
  return { key: kind, url: true, send, ...h };
}

export async function GET(req: Request) {
  let ok = true;
  try { await sql()`select 1`; } catch (e) { ok = false; console.error("health: baza nie odpowiada:", (e as Error).message); }
  const live = new URL(req.url).searchParams.get("live") === "1" ? await liveCheck() : undefined;
  return Response.json(live ? { ok, live } : { ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
