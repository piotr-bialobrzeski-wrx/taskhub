// OAuth dla konektorów: metadane, rejestracja klienta, kod zgody, wymiana na token (PKCE). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { originOf, serverMetadata, resourceMetadata, challengeOf, wwwAuthenticate } from "@/lib/oauth";

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

  it("klient z sekretem musi go podać", async () => {
    const owner = (await repo.ensureOwner()).id;
    const reg = await oauth.registerClient({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "client_secret_post" });
    expect(reg.client_secret).toBeTruthy();
    const verifier = "w".repeat(50);
    const req = (await oauth.checkAuthRequest({ client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], response_type: "code", code_challenge: challengeOf(verifier) })).req;
    const code = await oauth.issueCode(owner, req);
    await expect(oauth.exchangeCode({ grant_type: "authorization_code", code, client_id: reg.client_id, code_verifier: verifier })).rejects.toMatchObject({ code: "invalid_client" });
  });
});
