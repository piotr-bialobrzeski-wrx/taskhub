// Etap 0, utwardzenie serwera: tylko adresy http(s) na ekranie, bezpieczne /api/files, krótkie /api/health,
// lista adresów zwrotnych OAuth, TLS do bazy i migracje tylko przy produkcji. Część z bazą pomijana bez TEST_DATABASE_URL.
import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isHttpUrl, isLocalPath, isMediaUrl, safeHref } from "@/lib/safeurl";
import { externalLink } from "@/lib/links";
import { Markdown } from "@/lib/markdown";
import { BlockView } from "@/components/BlockRenderer";
import { PublishCard } from "@/components/PublishCard";
import { fileHeaders } from "@/app/api/files/headers";
import { isAllowedRedirect } from "@/lib/oauth";
import { migrationSkip, sslFor, sslOptions } from "@/lib/db";
import type { Block } from "@/lib/schema";
import { step, task } from "./helpers";

const DB = !!process.env.TEST_DATABASE_URL;
const ID = "0b8f3c2e-1d4a-4c6b-9e7f-2a5d8c1b3e4f";

// ciasteczko sesji dla trasy /api/files: test podstawia je zamiast przeglądarki
const jar = vi.hoisted(() => ({ session: null as string | null }));
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  cookies: async () => ({ get: (n: string) => (n === "th_session" && jar.session ? { name: n, value: jar.session } : undefined) }),
}));

describe("adresy: tylko http(s)", () => {
  it("isHttpUrl przepuszcza http i https, nic więcej", () => {
    for (const u of ["https://a.pl", "http://localhost:3000/x", " https://app.clickup.com/t/1 "]) expect(isHttpUrl(u)).toBe(true);
    for (const u of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "file:///etc/passwd", "taskhub://connect?url=x&token=y", "httpx://a.pl", "mailto:a@b.pl", "//a.pl", "/api/files/x", "", null, undefined, 42, "https://", "h".repeat(5000)])
      expect(isHttpUrl(u)).toBe(false);
  });
  it("safeHref: http(s), pliki Task Hub i kotwice; reszta bez linku", () => {
    expect(safeHref("https://a.pl/x")).toBe("https://a.pl/x");
    expect(safeHref(`/api/files/${ID}`)).toBe(`/api/files/${ID}`);
    expect(safeHref("#zm-1")).toBe("#zm-1");
    for (const u of ["javascript:alert(1)", " javascript:alert(1)", "taskhub://connect?url=https://zly.example&token=x", "file:///Users/p/.ssh/id_ed25519", "/api/files/../../etc", "/settings", "vbscript:x", null, undefined, ""])
      expect(safeHref(u)).toBeUndefined();
  });
  it("media mogą wskazywać plik Task Hub; podgląd zmian może być ścieżką na dysku (tylko jako tekst)", () => {
    expect(isMediaUrl(`/api/files/${ID}`)).toBe(true);
    expect(isMediaUrl("https://x/y.png")).toBe(true);
    expect(isMediaUrl("file:///x.png")).toBe(false);
    expect(isLocalPath("file:///Users/p/dist/index.html")).toBe(true);
    expect(isLocalPath("/Users/p/dist/index.html")).toBe(true);
    expect(isLocalPath("https://a.pl")).toBe(false);
  });
  it("externalLink nie przepuszcza schematów podobnych do http", () => {
    const app = "https://taskhub-lac.vercel.app";
    expect(externalLink("httpx://a.pl/x", app)).toBeUndefined();
    expect(externalLink("javascript:alert(1)", app)).toBeUndefined();
    expect(externalLink("https://a.pl/x", app)).toBe("https://a.pl/x");
  });
});

describe("render: adresy z danych nie trafiają do href", () => {
  const html = (b: Block) => renderToStaticMarkup(<BlockView b={b} />);
  const bad = ["javascript:", "taskhub:", "file:", "data:"];
  const noBad = (h: string) => { for (const x of bad) expect(h).not.toContain(`href="${x}`); for (const x of bad) expect(h).not.toContain(`src="${x}`); };

  it("markdown: linki i obrazki tylko http(s) albo plik Task Hub", () => {
    const h = renderToStaticMarkup(<Markdown text={`[a](taskhub://connect?url=x) [b](file:///etc/passwd) [c](https://a.pl) ![d](/api/files/${ID}) ![e](data:image/png;base64,AA) ![f](javascript:alert(1))`} />);
    noBad(h);
    expect(h).toContain('href="https://a.pl"');
    expect(h).toContain(`src="/api/files/${ID}"`);
  });
  it("klocki: źródło, lista, media, linki; zły adres zostaje samym tekstem", () => {
    const src = { app: "slack", ref: "#dev", url: "taskhub://connect?url=https://zly.example&token=x" };
    const hs = [
      html({ type: "facts", title: "Fakty", facts: [{ label: "A", value: "1", source: src, pinned: false, hidden: false }] } as Block),
      html({ type: "thread", source: src, messages: [{ author: "Ania", text: "hej", mine: false }] } as Block),
      html({ type: "list", items: [{ title: "Plik", url: "file:///etc/passwd", done: false }, { title: "Dobry", url: "https://a.pl", done: false }] } as Block),
      html({ type: "media", items: [{ kind: "image", url: "javascript:alert(1)", name: "x.png" }, { kind: "file", url: "data:text/html,<script>", name: "f.html" }, { kind: "image", url: `/api/files/${ID}`, name: "ok.png" }] } as Block),
      html({ type: "link", links: [{ url: "taskhub://settings", title: "Ustawienia" }, { url: "https://a.pl", title: "A" }] } as Block),
    ];
    for (const h of hs) noBad(h);
    expect(hs[2]).toContain('href="https://a.pl"');
    expect(hs[2]).toContain("Plik");
    expect(hs[3]).toContain(`src="/api/files/${ID}"`);
    expect(hs[4]).toContain("Ustawienia");
  });
  it("SVG z Task Hub nie jest obrazkiem w miejscu, tylko plikiem", () => {
    const h = html({ type: "media", items: [{ kind: "image", url: `/api/files/${ID}`, name: "logo.svg" }] } as Block);
    expect(h).not.toContain("<img");
    expect(h).toContain(`href="/api/files/${ID}"`);
  });
  it("podgląd zmian: http(s) jako link, ścieżka na dysku jako tekst do skopiowania", () => {
    const local = html({ type: "changes", repo: "a/b", preview: "file:///Users/p/dist/index.html", files: [] } as Block);
    expect(local).not.toContain('href="file:');
    expect(local).toContain("<code>file:///Users/p/dist/index.html</code>");
    expect(local).toContain("Kopiuj ścieżkę");
    expect(html({ type: "changes", preview: "https://podglad.example/x", files: [] } as Block)).toContain('href="https://podglad.example/x"');
  });
  it("karta publikacji: wynik i podgląd tylko http(s)", () => {
    const d = { type: "draft" as const, target: { app: "github", action: "push" as const, where: "a/b · main" }, body: "commit", status: "sent" as const };
    const ch = { type: "changes" as const, repo: "a/b", preview: "file:///Users/p/dist/index.html", files: [] };
    const s = step({ status: "done", tool: "github", needsApproval: true, blocks: [d, ch] as Block[] });
    const t = task({ steps: [s] });
    const h = renderToStaticMarkup(<PublishCard t={t} s={s} mode="sent" aiOn={false} ownerName="Piotr" link="javascript:alert(1)" connections={[]} company={null} />);
    noBad(h);
    // po zamknięciu kroku ścieżkę z „Kopiuj ścieżkę” ma blok zmian pod kartą (sprawdzony wyżej), karta jej nie powtarza; przed zamknięciem stoi na karcie, nadal nie jako href
    expect(h).not.toContain("Kopiuj ścieżkę");
    const open = renderToStaticMarkup(<PublishCard t={t} s={step({ status: "draft", tool: "github", needsApproval: true, blocks: [{ ...d, status: "proposed" }, ch] as Block[] })} mode="proposed" aiOn={false} ownerName="Piotr" link={null} connections={[]} company={null} />);
    noBad(open);
    expect(open).toContain("Kopiuj ścieżkę");
    const ok = renderToStaticMarkup(<PublishCard t={t} s={s} mode="sent" aiOn={false} ownerName="Piotr" link="https://github.com/a/b/commit/1" connections={[]} company={null} />);
    expect(ok).toContain('href="https://github.com/a/b/commit/1"');
  });
});

describe("/api/files: nagłówki", () => {
  it("w przeglądarce tylko obrazki rastrowe, tekst i PDF; SVG, HTML i reszta do pobrania", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
      const h = fileHeaders(m, "a");
      expect(h["content-type"]).toBe(m);
      expect(h["content-disposition"]).toMatch(/^inline;/);
    }
    expect(fileHeaders("text/plain", "a.txt")["content-type"]).toBe("text/plain; charset=utf-8");
    for (const m of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/javascript", "IMAGE/SVG+XML", "", null]) {
      const h = fileHeaders(m, "x");
      expect(h["content-type"]).toBe("application/octet-stream");
      expect(h["content-disposition"]).toMatch(/^attachment;/);
    }
  });
  it("zawsze nosniff, CSP z sandbox, prywatna pamięć podręczna, bezpieczna nazwa pliku", () => {
    for (const m of ["image/png", "image/svg+xml", "text/html", "application/pdf"]) {
      const h = fileHeaders(m, "Zrzut (1)'s *.png");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["content-security-policy"]).toBe("sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
      expect(h["cache-control"]).toMatch(/^private/);
      expect(h["content-disposition"]).toContain("filename*=UTF-8''Zrzut%20%281%29%27s%20%2A.png");
    }
  });
});

describe("/api/health", () => {
  it("odpowiada samym {ok}, bez szczegółów bazy i kluczy, bez pamięci podręcznej", async () => {
    const { GET } = await import("@/app/api/health/route");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await GET();
    err.mockRestore();
    const body = await r.json();
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(r.status).toBe(body.ok ? 200 : 503);
    expect(body.ok).toBe(DB);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("OAuth: dokąd wolno odesłać kod zgody", () => {
  it("Claude, ChatGPT i lokalny port Claude Code", () => {
    for (const u of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/aip/g-abc123/oauth/callback", "http://localhost:53682/callback", "http://127.0.0.1:8080/oauth/callback", "http://localhost/cb"])
      expect(isAllowedRedirect(u, {})).toBe(true);
  });
  it("obce adresy, podróbki hostów i inne schematy odrzucone", () => {
    for (const u of ["https://zly.example/cb", "https://claude.ai.zly.example/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/../x", "https://claude.ai/inne",
      "https://claude.ai/api/mcp/auth_callback?x=1", "https://chatgpt.com/inne", "https://chatgpt.com:444/aip/g-1/oauth/callback", "http://chatgpt.com/aip/g-1/oauth/callback",
      "https://localhost:3000/cb", "http://localhost.zly.example/cb", "http://user@localhost/cb", "http://10.0.0.1/cb", "javascript:alert(1)", "taskhub://connect", ""])
      expect(isAllowedRedirect(u, {})).toBe(false);
  });
  it("OAUTH_REDIRECT_ALLOW: dokładne adresy po przecinku", () => {
    const env = { OAUTH_REDIRECT_ALLOW: "https://moj.example/cb, https://drugi.example/oauth" };
    expect(isAllowedRedirect("https://moj.example/cb", env)).toBe(true);
    expect(isAllowedRedirect("https://drugi.example/oauth", env)).toBe(true);
    expect(isAllowedRedirect("https://moj.example/cb/x", env)).toBe(false);
    expect(isAllowedRedirect("https://moj.example/cb", {})).toBe(false);
  });
});

describe("baza: TLS i migracje", () => {
  it("lokalnie bez TLS, zdalnie co najmniej require, z DATABASE_CA_PEM pełna weryfikacja", () => {
    expect(sslFor("postgres://th:th@localhost:5432/taskhub", {})).toBeUndefined();
    expect(sslFor("postgres://th:th@127.0.0.1/taskhub", {})).toBeUndefined();
    expect(sslFor("postgres://th:th@[::1]:5432/taskhub", {})).toBeUndefined();
    const sb = "postgresql://postgres.abc:haslo@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
    expect(sslFor(sb, {})).toBe("require");
    expect(sslFor(sb + "?sslmode=disable", {})).toBe("require");
    expect(sslFor(sb, { DATABASE_CA_PEM: "-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----" })).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----", rejectUnauthorized: true });
    expect(sslFor(sb + "?sslmode=verify-full", {})).toBeUndefined();   // adres sam weryfikuje: opcja ssl by to nadpisała
    expect(sslOptions("postgres://th:th@localhost/x", {})).toEqual({});   // bez klucza ssl, żeby sslmode z adresu działał
    expect(sslOptions(sb, {})).toEqual({ ssl: "require" });
  });
  it("migracje: build podglądu na Vercelu pomija, produkcja i lokalnie idą", () => {
    const url = "postgres://x@db.example/x";
    expect(migrationSkip({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: url }, true)).toMatch(/preview/);
    expect(migrationSkip({ VERCEL: "1", VERCEL_ENV: "development", DATABASE_URL: url }, true)).toMatch(/development/);
    expect(migrationSkip({ VERCEL: "1", DATABASE_URL: url }, true)).toBeNull();   // bez VERCEL_ENV bezpieczniej uruchomić niż pominąć
    expect(migrationSkip({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: url }, true)).toBeNull();
    expect(migrationSkip({ DATABASE_URL: url }, false)).toBeNull();
    expect(migrationSkip({}, true)).toMatch(/DATABASE_URL/);
    expect(migrationSkip({}, false)).toBeNull();   // ręczne uruchomienie bez adresu kończy się błędem w skrypcie
  });
});

describe.skipIf(!DB)("/api/files: trasa z prawdziwym plikiem", async () => {
  const repo = await import("@/lib/repo");
  const { sessionValue } = await import("@/lib/auth");
  const { GET } = await import("@/app/api/files/[id]/route");
  const { sql } = await import("@/lib/db");
  afterAll(async () => { jar.session = null; await sql().end({ timeout: 2 }); });
  const get = (id: string) => GET(new Request(`http://localhost/api/files/${id}`), { params: Promise.resolve({ id }) });

  it("SVG i HTML do pobrania jako octet-stream, PNG w miejscu; zawsze CSP z sandbox; bez sesji 401", async () => {
    const owner = (await repo.ensureOwner()).id;
    const t = await repo.createTask(owner, { title: "Pliki do sprawdzenia" });
    const svg = await repo.addAttachment({ taskId: t.id }, { kind: "image", name: "logo.svg", mime: "image/svg+xml", keep: true, data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    const html = await repo.addAttachment({ taskId: t.id }, { kind: "file", name: "strona.html", mime: "text/html", keep: true, data: Buffer.from("<script>alert(1)</script>") });
    const png = await repo.addAttachment({ taskId: t.id }, { kind: "image", name: "zrzut.png", mime: "image/png", keep: true, data: Buffer.from("89504e470d0a1a0a", "hex") });

    jar.session = null;
    expect((await get(png.id)).status).toBe(401);
    jar.session = sessionValue();
    expect((await get("nie-uuid")).status).toBe(404);
    expect((await get(ID)).status).toBe(404);

    for (const a of [svg, html]) {
      const r = await get(a.id);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/octet-stream");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(r.headers.get("content-security-policy")).toMatch(/^sandbox;/);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
    const r = await get(png.id);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox;/);
    expect(Buffer.from(await r.arrayBuffer()).toString("hex")).toBe("89504e470d0a1a0a");
    await repo.purgeTask(owner, t.id);   // bez śladu w listach innych testów
  });
});
