// Ochrona logowania: zapis każdej próby hasła (IP, przeglądarka, kraj z Vercela), limit nieudanych prób i nocna blokada.
// Nieudane próby z jednego IP: 5 na 15 min. Wszystkie nieudane: 30 na godzinę (rozproszone zgadywanie z wielu IP).
// Blokada nocna (LOCK_UNTIL): do tej chwili nikt nie zaloguje się hasłem, nawet poprawnym; tokeny konektorów i mostka działają dalej.
import { headers } from "next/headers";
import { sql } from "./db";

export const IP_LIMIT = 5, IP_WINDOW_MIN = 15;
export const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_MIN = 60;
// nocna blokada na prośbę Piotra (2026-10-19 22:07 UTC) do 07:00 czasu warszawskiego; TASKHUB_LOCK_UNTIL nadpisuje (pusty = brak)
const DEFAULT_LOCK_UNTIL = "2026-10-20T05:00:00Z";

export type Kind = "web" | "oauth";
export type Verdict = { ok: true } | { ok: false; reason: "lock" | "rate"; until: Date };

export function lockUntil(now = new Date()): Date | null {
  const raw = process.env.TASKHUB_LOCK_UNTIL ?? DEFAULT_LOCK_UNTIL;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) && d > now ? d : null;
}

export async function client() {
  const h = await headers();
  const ip = (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim() || null;
  return { ip, ua: (h.get("user-agent") ?? "").slice(0, 300) || null, country: h.get("x-vercel-ip-country") };
}

// czy wolno teraz sprawdzić hasło (przed porównaniem, żeby zgadujący nie dostawał odpowiedzi)
export async function mayTry(ip: string | null, now = new Date()): Promise<Verdict> {
  const lock = lockUntil(now);
  if (lock) return { ok: false, reason: "lock", until: lock };
  const [g] = await sql()`select count(*)::int as n, min(at) as first from login_events
    where not ok and at > ${new Date(now.getTime() - GLOBAL_WINDOW_MIN * 60_000)}`;
  if ((g.n as number) >= GLOBAL_LIMIT) return { ok: false, reason: "rate", until: new Date(new Date(g.first as string).getTime() + GLOBAL_WINDOW_MIN * 60_000) };
  if (ip) {
    const [r] = await sql()`select count(*)::int as n, min(at) as first from login_events
      where not ok and ip = ${ip} and at > ${new Date(now.getTime() - IP_WINDOW_MIN * 60_000)}`;
    if ((r.n as number) >= IP_LIMIT) return { ok: false, reason: "rate", until: new Date(new Date(r.first as string).getTime() + IP_WINDOW_MIN * 60_000) };
  }
  return { ok: true };
}

export async function record(kind: Kind, ok: boolean, c: { ip: string | null; ua: string | null; country: string | null }, note?: string) {
  await sql()`insert into login_events (kind, ok, ip, ua, country, note) values (${kind}, ${ok}, ${c.ip}, ${c.ua}, ${c.country}, ${note ?? null})`;
}

// godzina dla komunikatu, czas warszawski
export const hhmm = (d: Date) => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });

// komunikat pod polem hasła (?e=…&t=HH:MM)
export function guardMessage(e: unknown, t: unknown): string | null {
  const at = typeof t === "string" && /^\d{2}:\d{2}$/.test(t) ? t : null;
  if (e === "1") return "Złe hasło.";
  if (e === "lock") return at ? `Logowanie jest wstrzymane do ${at} (ochrona na noc).` : "Logowanie jest chwilowo wstrzymane.";
  if (e === "rate") return at ? `Za dużo nieudanych prób. Spróbuj po ${at}.` : "Za dużo nieudanych prób. Spróbuj później.";
  return null;
}
