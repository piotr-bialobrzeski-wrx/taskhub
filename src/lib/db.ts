// Jedno połączenie z Postgresem (Supabase albo lokalny). Driver "postgres" działa w Node i na Vercel.
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __taskhubSql: ReturnType<typeof postgres> | undefined;
}

export function sql() {
  if (!globalThis.__taskhubSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Brak DATABASE_URL w zmiennych środowiska");
    globalThis.__taskhubSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      prepare: false,            // pooler Supabase (PgBouncer, tryb transaction) nie lubi prepared statements
      transform: postgres.camel, // kolumny snake_case -> camelCase w wynikach
      onnotice: () => {},
    });
  }
  return globalThis.__taskhubSql;
}
