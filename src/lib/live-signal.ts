// Paczka 60: sygnał w chwili zmiany (Supabase Realtime) zamiast odpytywania co kilkanaście sekund.
// Baza po każdej zmianie wysyła krótki sygnał bez danych na tajny kanał właściciela (migracja 0038); strona i mostek na Macu słuchają go
// i dopiero wtedy pytają Task Hub. Klucz publiczny Supabase (SUPABASE_PUBLISHABLE_KEY albo SUPABASE_ANON_KEY) jest jawny z założenia:
// tabele mają RLS bez polityk (migracja 0017), więc ten klucz nie czyta danych; daje tylko połączenie z kanałem, którego nazwę zna właściciel.
// Bez klucza albo adresu: null, wszystko działa jak dotąd (odpytywanie).
import { sql } from "./db";

export type LiveConfig = { url: string; key: string; topic: string };

// adres Realtime: SUPABASE_URL albo wyliczony z DATABASE_URL (pooler: użytkownik postgres.<ref>; bezpośrednio: db.<ref>.supabase.co)
export function supabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const direct = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(direct)) return direct;
  try {
    const u = new URL(env.DATABASE_URL ?? "");
    const ref = /^postgres\.([a-z0-9]{10,})$/.exec(decodeURIComponent(u.username))?.[1] ?? /^db\.([a-z0-9]{10,})\.supabase\.co$/.exec(u.hostname)?.[1];
    return ref ? `https://${ref}.supabase.co` : null;
  } catch { return null; }
}
export const realtimeSocket = (url: string, key: string) => `${url.replace(/^https:/, "wss:")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;

const topics = new Map<string, string>();
export async function liveConfig(ownerId: string, env: Record<string, string | undefined> = process.env): Promise<LiveConfig | null> {
  const key = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const url = supabaseUrl(env);
  if (!key || !url) return null;
  let topic = topics.get(ownerId);
  if (!topic) {
    try {
      // najpierw sam odczyt: zapis w users to też sygnał, więc kanał zakładamy tylko raz
      const [r] = await sql()`select live_topic from users where id = ${ownerId}`;
      topic = (r?.liveTopic as string | null) ?? undefined;
      if (!topic) {
        const [w] = await sql()`update users set live_topic = coalesce(live_topic, 'th-' || replace(gen_random_uuid()::text, '-', '')) where id = ${ownerId} returning live_topic`;
        topic = (w?.liveTopic as string | undefined) ?? undefined;
      }
    } catch { return null; }   // baza bez migracji 0038
    if (!topic) return null;
    topics.set(ownerId, topic);
  }
  return { url, key, topic };
}
