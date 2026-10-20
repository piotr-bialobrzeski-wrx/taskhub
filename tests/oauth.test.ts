// OAuth dla konektorów: metadane, rejestracja klienta, kod zgody, wymiana na token (PKCE). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { originOf, serverMetadata, resourceMetadata, challengeOf, wwwAuthenticate, isCimdUrl, loadCimd } from "@/lib/oauth";

const DB = !!process.env.TEST_DATABASE_URL;

describe("oauth: metadane", () => {
  it("adres z nagłówków proxy (Vercel) albo z żądania", () => {
    expect(originOf(new Request("http://localhost:3000/api/mcp"))).toBe("http://localhost:3000");
    expect(originOf(new Request("http://x/api/mcp", { headers: { host: "taskhub.vercel.app" } }))).toBe("https://taskhub.vercel.app");
    expect(originOf(new Request("http://x/api/mcp", { headers: { "x-forwarded-host": "moja.app", "x-forwarded-proto": "https" } }))).toBe("https://moja.app");
  });
  it("serwer i zasób wskazują na siebie nawzajem", () => {
    const o = "https://moja.app";
    const s = serverMetadata(o), r = resourceMetadata(o);
    expect(s.issuer).toBe(o);
    expect(r.authorization_servers).toEqual([o]);
    expect(r.resource).toBe(o + "/api/mcp");
    expect(s.code_challenge_methods_supported).toEqual(["S256"]);
    expect(wwwAuthenticate(o)).toContain(o + "/.well-known/oauth-protected-resource");
  });
  it("client_id jako adres dokumentu tożsamości: tylko https z ścieżką, bez IP i localhost", () => {
    expect(isCimdUrl("https://claude.ai/.well-known/oauth/client-metadata.json")).toBe(true);
    expect(isCimdUrl("https://claude.ai")).toBe(false);
    expect(isCimdUrl("http://claude.ai/x.json")).toBe(false);
    expect(isCimdUrl("https://10.0.0.1/x.json")).toBe(false);
    expect(isCimdUrl("https://localhost/x.json")).toBe(false);
    expect(isCimdUrl("thc_abc")).toBe(false);
  });
  it("dokument tożsamości: błąd HTTP i zły JSON odrzucone", async () => {
    const f = (body: string, status = 200) => (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(loadCimd("https://x.app/c.json", f("nie json"))).rejects.toMatchObject({ code: "invalid_client" });
    await expect(loadCimd("https://x.app/c.json", f("{}", 404))).rejects.toMatchObject({ code: "invalid_client" });
    expect(await loadCimd("https://x.app/c.json", f('{"a":1}'))).toEqual({ a: 1 });
  });
  it("PKCE S256 jak w RFC 7636", () => {
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe.skipIf(!DB)("oauth: pełny przebieg", async () => {
  const oauth = await import("@/lib/oauth");
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("rejestracja, zgoda, kod, token działa w MCP, kod jednorazowy, zły verifier odrzucony", async () => {
    const owner = (await repo.ensureOwner()).id;
    const reg = await oauth.registerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" });
    expect(reg.client_id.startsWith("thc_")).toBe(true);
    expect("client_secret" in reg).toBe(false);

    await expect(oauth.registerClient({ redirect_uris: ["http://zly.example/cb"] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    // https to za mało: kod zgody leci tylko do Claude, ChatGPT, localhost i adresów z OAUTH_REDIRECT_ALLOW
    await expect(oauth.registerClient({ redirect_uris: ["https://zly.example/cb"] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    await expect(oauth.registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.ai.zly.example/api/mcp/auth_callback"] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    expect((await oauth.registerClient({ client_name: "Claude Code", redirect_uris: ["http://localhost:53682/callback"] })).redirect_uris).toEqual(["http://localhost:53682/callback"]);

    const verifier = "v".repeat(50), challenge = createHash("sha256").update(verifier).digest("base64url");
    const q = { client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "abc" };
    const { client, req } = await oauth.checkAuthRequest(q);
    expect(client.name).toBe("Claude");
    await expect(oauth.checkAuthRequest({ ...q, redirect_uri: "https://claude.ai/inne" })).rejects.toMatchObject({ code: "invalid_request" });

    const code = await oauth.issueCode(owner, req);
    await expect(oauth.exchangeCode({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: req.redirect_uri, code_verifier: "x".repeat(50) })).rejects.toMatchObject({ code: "invalid_grant" });

    const code2 = await oauth.issueCode(owner, req);
    const tok = await oauth.exchangeCode({ grant_type: "authorization_code", code: code2, client_id: reg.client_id, redirect_uri: req.redirect_uri, code_verifier: verifier });
    expect(tok.token_type).toBe("Bearer");
    expect(await repo.ownerForToken(tok.access_token)).toBe(owner);
    expect((await repo.listApiTokens(owner)).some((t) => t.name === "Claude (konektor)")).toBe(true);

    await expect(oauth.exchangeCode({ grant_type: "authorization_code", code: code2, client_id: reg.client_id, code_verifier: verifier })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("klient z dokumentem tożsamości przechodzi zgodę i wymianę kodu", async () => {
    const owner = (await repo.ensureOwner()).id;
    const url = "https://claude.example/.well-known/oauth/client-metadata.json", cb = "https://claude.ai/api/mcp/auth_callback";
    await expect(oauth.registerCimdClient(url, { client_id: "https://inny.example/x.json", redirect_uris: [cb] })).rejects.toMatchObject({ code: "invalid_client" });
    // dokument bez żadnego dozwolonego adresu: nie ma klienta; z kilkoma: zostają tylko dozwolone
    await expect(oauth.registerCimdClient(url, { client_id: url, redirect_uris: ["https://claude.example/cb"] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    const c = await oauth.registerCimdClient(url, { client_id: url, client_name: "Claude", redirect_uris: [cb, "https://claude.example/cb"], token_endpoint_auth_method: "none" });
    expect(c.id).toBe(url);
    expect(c.redirectUris).toEqual([cb]);
    expect((await oauth.getClient(url))?.name).toBe("Claude");
    const verifier = "c".repeat(50);
    await expect(oauth.checkAuthRequest({ client_id: url, redirect_uri: "https://claude.example/cb", response_type: "code", code_challenge: challengeOf(verifier) })).rejects.toMatchObject({ code: "invalid_request" });
    const { req } = await oauth.checkAuthRequest({ client_id: url, redirect_uri: cb, response_type: "code", code_challenge: challengeOf(verifier) });
    const code = await oauth.issueCode(owner, req);
    const tok = await oauth.exchangeCode({ grant_type: "authorization_code", code, client_id: url, redirect_uri: cb, code_verifier: verifier });
    expect(await repo.ownerForToken(tok.access_token)).toBe(owner);
  });

  it("klient zarejestrowany przed listą dozwolonych adresów działa dalej", async () => {
    const id = "thc_stary_" + Date.now(), cb = "https://stary.example/cb";
    await sql()`insert into oauth_clients (id, name, redirect_uris, secret_hash, auth_method, metadata) values (${id}, ${"Stary"}, ${sql().json([cb])}, null, 'none', ${sql().json({})})`;
    const { client } = await oauth.checkAuthRequest({ client_id: id, redirect_uri: cb, response_type: "code", code_challenge: challengeOf("s".repeat(50)) });
    expect(client.name).toBe("Stary");
  });

  it("OAUTH_REDIRECT_ALLOW dopuszcza dokładnie podane adresy", async () => {
    process.env.OAUTH_REDIRECT_ALLOW = "https://moj.example/cb, https://drugi.example/oauth";
    try {
      expect((await oauth.registerClient({ redirect_uris: ["https://moj.example/cb"] })).redirect_uris).toEqual(["https://moj.example/cb"]);
      await expect(oauth.registerClient({ redirect_uris: ["https://moj.example/cb2"] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    } finally { delete process.env.OAUTH_REDIRECT_ALLOW; }
  });

  it("klient z sekretem musi go podać", async () => {
    const owner = (await repo.ensureOwner()).id;
    const reg = await oauth.registerClient({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "client_secret_post" });
    expect(reg.client_secret).toBeTruthy();
    const verifier = "w".repeat(50);
    const req = (await oauth.checkAuthRequest({ client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], response_type: "code", code_challenge: challengeOf(verifier) })).req;
    const code = await oauth.issueCode(owner, req);
    await expect(oauth.exchangeCode({ grant_type: "authorization_code", code, client_id: reg.client_id, code_verifier: verifier })).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("konektor ChatGPT z adresem zwrotnym na konektor (/connector/oauth/<id>) się rejestruje, inne adresy chatgpt.com nie", async () => {
    const cb = "https://chatgpt.com/connector/oauth/abc_123";
    expect((await oauth.registerClient({ client_name: "ChatGPT", redirect_uris: [cb], token_endpoint_auth_method: "client_secret_post" })).redirect_uris).toEqual([cb]);
    const url = "https://chatgpt.com/oauth/abc/client.json";
    expect((await oauth.registerCimdClient(url, { client_id: url, client_name: "ChatGPT", redirect_uris: [cb], token_endpoint_auth_method: "none" })).redirectUris).toEqual([cb]);
    for (const bad of [cb + "?next=https://zly.example", cb + "/x", "https://chatgpt.com.zly.example/connector/oauth/abc", "https://zly.example/connector/oauth/abc", "https://chatgpt.com:8443/connector/oauth/abc", "http://chatgpt.com/connector/oauth/abc"]) {
      expect(oauth.isAllowedRedirect(bad)).toBe(false);
      await expect(oauth.registerClient({ redirect_uris: [bad] })).rejects.toMatchObject({ code: "invalid_redirect_uri" });
    }
  });
});
