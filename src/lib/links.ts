// Linki kroków: tylko prawdziwe adresy zewnętrzne. Agent bywa wpisywał adres samej aplikacji, przez co „Otwórz w…” otwierało Task Hub.
export function externalLink(link: string | undefined | null, appOrigin: string): string | undefined {
  if (!link) return undefined;
  try {
    const u = new URL(link);
    if (!u.protocol.startsWith("http")) return undefined;
    if (u.origin === new URL(appOrigin).origin) return undefined;
    return link;
  } catch { return undefined; }
}
