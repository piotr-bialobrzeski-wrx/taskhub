// Paczka 31, krok 13 (decyzja w kroku 09: A „Okienko z prototypem”): czy adres prototypu da się pokazać w ramce na kartce.
// Task Hub zapisuje tylko adres; o osadzaniu decyduje strona docelowa nagłówkiem X-Frame-Options albo CSP frame-ancestors.
// Sprawdzone 2026-10-31: claude.ai (także prywatny artefakt) wysyła frame-ancestors 'self', więc zostaje sam link.

export type EmbedMode = "frame" | "check" | "link";

// strony, o których wiadomo, że nie dają się osadzić u nas: od razu link, bez czekania na ramkę
const BLOCKED_HOSTS = [/(^|\.)claude\.ai$/i, /(^|\.)github\.com$/i, /(^|\.)figma\.com$/i, /(^|\.)google\.com$/i, /(^|\.)clickup\.com$/i, /(^|\.)slack\.com$/i, /(^|\.)mural\.co$/i, /(^|\.)vercel\.com$/i];
// podgląd Task Hub (add_preview) i pliki: ten sam origin, piaskownica z CSP; osadzamy bez sprawdzania
const OWN_PATH = /^\/api\/(preview|files)\/[0-9a-f-]{36}(?:[?#].*)?$/i;

const parse = (url: string, base?: string): URL | null => { try { return new URL(url, base); } catch { return null; } };

// appOrigin: origin aplikacji (https://taskhub-lac.vercel.app); adres względny albo z tym originem i ścieżką podglądu = własny
export function embedMode(url: string | null | undefined, appOrigin: string): EmbedMode {
  if (!url) return "link";
  const u = parse(url, appOrigin);
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return "link";
  const app = parse(appOrigin);
  if (app && u.origin === app.origin) return OWN_PATH.test(u.pathname + u.search) ? "frame" : "link";
  if (u.protocol !== "https:") return "link";   // strona Task Hub po https nie osadzi http (mieszana treść)
  if (BLOCKED_HOSTS.some((re) => re.test(u.hostname))) return "link";
  return "check";
}
export const isOwnPreview = (url: string, appOrigin: string) => embedMode(url, appOrigin) === "frame";

// odczyt nagłówków strony docelowej: true = przeglądarka pokaże ją w ramce na stronie z originem appOrigin
export function frameAllowed(headers: { xfo?: string | null; csp?: string | null }, appOrigin: string): boolean {
  const app = parse(appOrigin);
  // CSP frame-ancestors ma pierwszeństwo przed X-Frame-Options (przeglądarki pomijają XFO, gdy jest frame-ancestors)
  const fa = (headers.csp ?? "").split(/[;,]/).map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d));
  if (fa) {
    const srcs = fa.split(/\s+/).slice(1).map((s) => s.toLowerCase());
    if (!srcs.length || srcs.includes("'none'")) return false;
    if (srcs.includes("*")) return true;
    if (!app) return false;
    return srcs.some((s) => {
      if (s === "https:") return app.protocol === "https:";
      const m = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?\/?$/.exec(s);
      if (!m) return false;
      if (m[1] && m[1] + ":" !== app.protocol) return false;
      const host = m[3], h = app.hostname.toLowerCase();
      return m[2] ? h.endsWith("." + host) : h === host;
    });
  }
  const xfo = (headers.xfo ?? "").trim().toUpperCase();
  return !(xfo === "DENY" || xfo === "SAMEORIGIN" || xfo.startsWith("ALLOW-FROM"));
}

// adresy, których serwer nie odpytuje (sieć prywatna, localhost): bez tego sprawdzenie mogłoby zaglądać do wewnętrznych usług
export function publicHttpsUrl(url: string): URL | null {
  const u = parse(url);
  if (!u || u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return null;
  }
  if (h.includes(":")) return null;   // IPv6 literalnie: nie odpytujemy
  return u;
}
