// Bezpieczne adresy: w danych i na ekranie zostają tylko http(s) (oraz pliki Task Hub /api/files/<uuid>).
// javascript:, data:, file:, taskhub: i inne schematy znikają przy zapisie i nie trafiają do href przy wyświetlaniu.
import type { Block } from "./schema";

const FILES = /^\/api\/files\/[0-9a-f-]{36}$/i;

export function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 4000) return false;
  try {
    const x = new URL(u.trim());
    return (x.protocol === "http:" || x.protocol === "https:") && !!x.hostname;
  } catch { return false; }
}

// plik załącznika z Task Hub (adres względny) albo http(s)
export const isMediaUrl = (u: unknown): u is string => (typeof u === "string" && FILES.test(u.trim())) || isHttpUrl(u);

// adres do href: http(s), pliki Task Hub i kotwice na tej samej stronie; wszystko inne → undefined (pokazujemy sam tekst)
export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  const t = u.trim();
  if (t.startsWith("#") || FILES.test(t)) return t;
  return isHttpUrl(t) ? t : undefined;
}

// file:// albo ścieżka na dysku: tylko jako tekst do skopiowania (podgląd zmian w kodzie), nigdy jako link
export const isLocalPath = (u: unknown): u is string => typeof u === "string" && (/^file:\/\//i.test(u.trim()) || u.trim().startsWith("/"));

// ścieżka pliku na Macu (krok „Plik na Macu”): od / albo ~/, bez znaków sterujących i bez „..”; nigdy nie trafia do href
export function isFilePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  const t = p.trim();
  if (!t || t.length > 500 || !(t.startsWith("/") || t.startsWith("~/"))) return false;
  if (/[\u0000-\u001f\u007f]/.test(t)) return false;
  return !t.split("/").some((seg) => seg === "..");
}
export const fileName = (p: string) => p.trim().replace(/\/+$/, "").split("/").pop() || p.trim();

// czyści adresy we wszystkich klockach przed zapisem, w głąb (źródła faktów, elementy list, linki, wiadomości):
// każde pole „url” spoza http(s) znika; media mogą też wskazywać plik Task Hub, a podgląd zmian w kodzie ścieżkę na dysku.
// Element listy linków albo mediów bez poprawnego adresu wypada w całości (bez adresu nie ma czego pokazać).
function clean(v: unknown, key: string, parentType: string | null): unknown {
  if (Array.isArray(v)) {
    const out = v.map((x) => clean(x, key, parentType));
    if ((parentType === "link" && key === "links") || (parentType === "media" && key === "items"))
      return out.filter((x) => x && typeof x === "object" && typeof (x as { url?: unknown }).url === "string");
    return out;
  }
  if (!v || typeof v !== "object") return v;
  const o: Record<string, unknown> = {};
  const type = typeof (v as { type?: unknown }).type === "string" ? String((v as { type: string }).type) : null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === "url" && typeof x === "string") {
      const ok = parentType === "media" && key === "items" ? isMediaUrl(x) : isHttpUrl(x);
      if (ok) o[k] = x.trim();
      continue;
    }
    if (k === "preview" && type === "changes" && typeof x === "string") {
      if (isHttpUrl(x) || isLocalPath(x)) o[k] = x.trim();
      continue;
    }
    o[k] = clean(x, k, type ?? parentType);
  }
  return o;
}

export function sanitizeBlocks<T extends Block>(blocks: T[]): T[] {
  return blocks.map((b) => clean(b, "", null) as T);
}
