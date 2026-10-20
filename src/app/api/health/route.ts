// Publiczny test życia: tylko {ok}. Szczegóły błędu bazy (host, użytkownik) i lista kluczy modeli trafiają do logów, nie do odpowiedzi.
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let ok = true;
  try { await sql()`select 1`; } catch (e) { ok = false; console.error("health: baza nie odpowiada:", (e as Error).message); }
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
