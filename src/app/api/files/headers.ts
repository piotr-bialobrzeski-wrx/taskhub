// Nagłówki pliku załącznika: w przeglądarce otwierają się tylko obrazki rastrowe, zwykły tekst i PDF; HTML, SVG i cała reszta idą do pobrania,
// a CSP z sandbox nie pozwala uruchomić w pliku żadnego skryptu na adresie Task Hub (np. kliknięcia „Zatwierdź” za Piotra).
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "application/pdf"]);
export const FILE_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

export function fileHeaders(mime: string | null, name: string | null): Record<string, string> {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  const inline = INLINE_TYPES.has(base);
  // RFC 5987: w filename* bez apostrofów, nawiasów i gwiazdki
  const fname = encodeURIComponent(name || "plik").replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return {
    "content-type": !inline ? "application/octet-stream" : base === "text/plain" ? "text/plain; charset=utf-8" : base,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${fname}`,
    "content-security-policy": FILE_CSP,
    "x-content-type-options": "nosniff",
    // treść pliku pod danym adresem się nie zmienia (nowa wersja = nowy załącznik), więc przeglądarka trzyma go rok i nie pyta ponownie
    "cache-control": "private, max-age=31536000, immutable",
  };
}
