// Logowanie jednego użytkownika: hasło z env, ciasteczko podpisane sekretem. Klienci MCP używają tokenów (api_tokens).
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "th_session";

function secret(): string {
  const s = process.env.TASKHUB_SECRET;
  if (!s || s.length < 16) throw new Error("TASKHUB_SECRET musi mieć co najmniej 16 znaków");
  return s;
}
export function sessionValue(): string {
  return createHmac("sha256", secret()).update("owner:" + (process.env.TASKHUB_OWNER_EMAIL ?? "")).digest("hex");
}
export function checkPassword(pw: string): boolean {
  const want = process.env.TASKHUB_PASSWORD ?? "";
  if (!want) return false;
  const a = Buffer.from(pw), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function isSignedIn(): Promise<boolean> {
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!c) return false;
  const a = Buffer.from(c), b = Buffer.from(sessionValue());
  return a.length === b.length && timingSafeEqual(a, b);
}
