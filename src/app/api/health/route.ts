import { sql } from "@/lib/db";
import { availableProviders } from "@/lib/ai";

export async function GET() {
  let db = "ok";
  try { await sql()`select 1`; } catch (e) { db = "błąd: " + (e as Error).message; }
  return Response.json({ ok: db === "ok", db, ai: availableProviders(), time: new Date().toISOString() });
}
