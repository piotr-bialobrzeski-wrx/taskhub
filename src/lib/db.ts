// Jedno połączenie z Postgresem (Supabase albo lokalny). Driver "postgres" działa w Node i na Vercel.
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __taskhubSql: ReturnType<typeof postgres> | undefined;
}

type SslOption = "require" | { ca: string; rejectUnauthorized: true };

// TLS do bazy: lokalnie (localhost, 127.0.0.1, gniazdo) bez zmian; zdalnie zawsze szyfrowane.
// Z DATABASE_CA_PEM sprawdzamy certyfikat i nazwę hosta (verify-full); bez niego co najmniej "require".
// Opcja ssl w postgres.js wygrywa z sslmode w adresie, więc adres, który sam sprawdza certyfikat (sslmode=verify-full/verify-ca, sslrootcert=system), zostawiamy w spokoju.
export function sslFor(url: string, env: Record<string, string | undefined> = process.env): SslOption | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return "require"; }   // adres nie do odczytania: na pewno nie lokalny, szyfrujemy
  const host = decodeURIComponent(u.hostname).replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;
  const ca = env.DATABASE_CA_PEM?.trim().replace(/\\n/g, "\n");
  if (ca) return { ca, rejectUnauthorized: true };
  const q = u.searchParams;
  if (/^verify-(full|ca)$/.test(q.get("sslmode") ?? "") || q.get("sslrootcert") === "system") return undefined;
  return "require";
}
// do opcji postgres(): klucza ssl nie może być wcale, gdy nic nie ustawiamy (samo `ssl: undefined` wyłącza TLS z adresu)
export const sslOptions = (url: string, env?: Record<string, string | undefined>) => { const ssl = sslFor(url, env); return ssl ? { ssl } : {}; };

// Migracje tylko przy wdrożeniu produkcyjnym: build podglądu na Vercelu (VERCEL=1, VERCEL_ENV inne niż production) ich nie puszcza.
// Zwraca powód pominięcia (skrypt kończy się wtedy sukcesem) albo null, gdy migracje mają iść.
export function migrationSkip(env: Record<string, string | undefined>, ifConfigured: boolean): string | null {
  // tylko jawny podgląd: bez VERCEL_ENV migracje idą jak dotąd (pominięcie na produkcji zostawiłoby kod bez kolumn, których oczekuje)
  if (env.VERCEL === "1" && (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development")) return `build ${env.VERCEL_ENV} na Vercelu, migracje idą tylko przy wdrożeniu produkcyjnym`;
  if (!env.DATABASE_URL && ifConfigured) return "brak DATABASE_URL";
  return null;
}

export function sql() {
  if (!globalThis.__taskhubSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Brak DATABASE_URL w zmiennych środowiska");
    globalThis.__taskhubSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      fetch_types: false,         // bez pytania o typy tablic przy każdym połączeniu (transfer z Supabase); tablice z bazy czytamy jako JSON
      prepare: false,            // pooler Supabase (PgBouncer, tryb transaction) nie lubi prepared statements
      transform: postgres.camel, // kolumny snake_case -> camelCase w wynikach
      onnotice: () => {},
      ...sslOptions(url),
    });
  }
  return globalThis.__taskhubSql;
}
