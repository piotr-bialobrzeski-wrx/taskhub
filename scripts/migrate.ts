// Uruchamia migracje z supabase/migrations po kolei i zapisuje, które już poszły.
// Użycie: DATABASE_URL=... npm run db:migrate   (opcja --skip-vectors pomija 0002, gdy brak pgvector)
// Przy buildzie na Vercelu: --if-configured (bez DATABASE_URL tylko informuje i nie przerywa builda).
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
const ifConfigured = process.argv.includes("--if-configured");
if (!url) {
  if (ifConfigured) { console.log("migracje: brak DATABASE_URL, pomijam"); process.exit(0); }
  console.error("Brak DATABASE_URL"); process.exit(1);
}
const skipVectors = process.argv.includes("--skip-vectors");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });   // prepare:false dla poolera Supabase
const dir = path.join(process.cwd(), "supabase", "migrations");

async function main() {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    if (skipVectors && f.includes("vectors")) { console.log("pomijam", f); continue; }
    const body = readFileSync(path.join(dir, f), "utf8");
    console.log("migracja", f);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${f})`;
      });
    } catch (e) {
      // warstwa wektorowa jest opcjonalna: bez pgvector aplikacja działa na wyszukiwaniu pełnotekstowym
      if (f.includes("vectors")) { console.warn("pomijam", f, "(brak pgvector?):", (e as Error).message); continue; }
      throw e;
    }
  }
  await sql.end();
  console.log("gotowe");
}
main().catch((e) => { console.error(e); process.exit(1); });
