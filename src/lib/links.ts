// Linki kroków: tylko prawdziwe adresy zewnętrzne. Agent bywa wpisywał adres samej aplikacji, przez co „Otwórz w…” otwierało Task Hub.
import { isHttpUrl } from "./safeurl";

export function externalLink(link: string | undefined | null, appOrigin: string): string | undefined {
  if (!link || !isHttpUrl(link)) return undefined;   // tylko http(s): bez httpx:, file:, taskhub: i podobnych
  try {
    const u = new URL(link.trim());
    if (u.origin === new URL(appOrigin).origin) return undefined;
    return link.trim();
  } catch { return undefined; }
}
