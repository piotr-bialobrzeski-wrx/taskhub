// OAuth 2.1 dla konektorów MCP (aplikacja Claude, ChatGPT, Claude Code): klient rejestruje się sam (RFC 7591)
// albo podaje jako client_id adres swojego dokumentu tożsamości (CIMD, "Claude's published identity"),
// Piotr daje zgodę na stronie /oauth/authorize, klient wymienia kod na token (PKCE S256, RFC 7636).
// Token dostępu to zwykły token MCP z api_tokens, więc widać go i można go unieważnić w Ustawieniach.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql } from "./db";
import { createApiToken } from "./repo";

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const oauthErrorResponse = (e: unknown) => e instanceof OAuthError
  ? jsonResponse({ error: e.code, error_description: e.message }, e.status)
  : jsonResponse({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);

export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version" };
export const jsonResponse = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });
export const corsPreflight = () => new Response(null, { status: 204, headers: CORS });

// Publiczny adres aplikacji z nagłówków żądania (Vercel ustawia x-forwarded-*), żeby metadane zgadzały się z adresem, którego używa klient.
export function originOf(req: Request): string {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host).split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

export const SCOPE = "tasks";
export const serverMetadata = (o: string) => ({
  issuer: o,
  authorization_endpoint: `${o}/oauth/authorize`,
  token_endpoint: `${o}/api/oauth/token`,
  registration_endpoint: `${o}/api/oauth/register`,
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  client_id_metadata_document_supported: true,
  scopes_supported: [SCOPE],
  service_documentation: `${o}/settings`,
});
export const resourceMetadata = (o: string) => ({
  resource: `${o}/api/mcp`,
  authorization_servers: [o],
  bearer_methods_supported: ["header"],
  scopes_supported: [SCOPE],
  resource_name: "Task Hub",
});
export const wwwAuthenticate = (o: string) => `Bearer realm="task-hub", resource_metadata="${o}/.well-known/oauth-protected-resource"`;

// ---------- klienci ----------
export type OAuthClient = { id: string; name: string; redirectUris: string[]; secretHash: string | null; authMethod: string };
const Registration = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
}).loose();

// Dokąd wolno odesłać kod zgody: znane adresy Claude i ChatGPT, lokalny port Claude Code (/mcp) i adresy z OAUTH_REDIRECT_ALLOW (po przecinku, dokładnie).
// Sprawdzane przy rejestracji i przy dokumencie tożsamości; klienci zapisani wcześniej działają dalej (zgoda sprawdza tylko ich zapisaną listę).
const REDIRECTS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect"]);
export function isAllowedRedirect(u: string, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof u !== "string" || u.length > 2000) return false;
  if (REDIRECTS.has(u)) return true;
  if ((env.OAUTH_REDIRECT_ALLOW ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(u)) return true;
  let x: URL;
  try { x = new URL(u); } catch { return false; }
  if (x.username || x.password || x.hash) return false;
  if (x.protocol === "https:" && x.hostname === "chatgpt.com" && !x.port && /^\/aip\/[^/]+\/.*callback$/.test(x.pathname)) return true;   // akcje GPT: /aip/<id>/oauth/callback
  if (x.protocol === "https:" && x.hostname === "chatgpt.com" && !x.port && !x.search && /^\/connector\/oauth\/[^/]+$/.test(x.pathname)) return true;   // konektor ChatGPT: adres zwrotny na konektor (bez iss z RFC 9207)
  return x.protocol === "http:" && (x.hostname === "localhost" || x.hostname === "127.0.0.1");
}

export async function registerClient(body: unknown) {
  const p = Registration.safeParse(body);
  if (!p.success) throw new OAuthError("invalid_client_metadata", "Potrzebne redirect_uris (lista adresów).");
  const uris = p.data.redirect_uris;
  const bad = uris.find((u) => !isAllowedRedirect(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Task Hub nie odsyła zgody na ${bad}. Dozwolone są Claude, ChatGPT, localhost i adresy z OAUTH_REDIRECT_ALLOW.`);
  const method = p.data.token_endpoint_auth_method ?? "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) throw new OAuthError("invalid_client_metadata", "Nieobsługiwana metoda uwierzytelnienia klienta.");
  const id = "thc_" + randomBytes(16).toString("base64url");
  const secret = method === "none" ? null : randomBytes(24).toString("base64url");
  const name = (p.data.client_name ?? "").trim().slice(0, 120) || new URL(uris[0]).hostname;
  const meta = Object.fromEntries(Object.entries(p.data).filter(([k]) => ["client_uri", "logo_uri", "software_id", "software_version", "contacts"].includes(k)));
  await sql()`insert into oauth_clients (id, name, redirect_uris, secret_hash, auth_method, metadata)
    values (${id}, ${name}, ${sql().json(uris)}, ${secret ? sha(secret) : null}, ${method}, ${sql().json(meta as never)})`;
  return {
    client_id: id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name, redirect_uris: uris, token_endpoint_auth_method: method, grant_types: ["authorization_code"], response_types: ["code"], scope: SCOPE,
  };
}
export async function getClient(id: string): Promise<OAuthClient | null> {
  const [r] = await sql()`select * from oauth_clients where id = ${id}`;
  const cached = r ? { id: r.id as string, name: r.name as string, redirectUris: r.redirectUris as string[], secretHash: (r.secretHash as string) ?? null, authMethod: r.authMethod as string } : null;
  if (!isCimdUrl(id)) return cached;
  // klient z dokumentem tożsamości: pobieramy dokument przy pierwszym użyciu i odświeżamy raz na dobę; gdy pobranie zawiedzie, zostaje kopia
  const fresh = cached && Date.now() - new Date(r!.createdAt as string).getTime() < 24 * 3600_000;
  if (fresh) return cached;
  try { return await registerCimdClient(id, await loadCimd(id)); } catch (e) { if (cached) return cached; throw e; }
}

// ---------- klienci z dokumentem tożsamości (CIMD): client_id to adres https dokumentu JSON z redirect_uris ----------
export function isCimdUrl(id: string): boolean {
  try { const u = new URL(id); return u.protocol === "https:" && u.pathname.length > 1 && !u.hash && !u.username && !u.password && !/^(\d+\.){3}\d+$/.test(u.hostname) && u.hostname !== "localhost"; } catch { return false; }
}
export async function loadCimd(url: string, fetchFn: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchFn(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new OAuthError("invalid_client", `Dokument tożsamości klienta odpowiedział ${res.status}.`);
  const body = await res.text();
  if (body.length > 64_000) throw new OAuthError("invalid_client", "Dokument tożsamości klienta jest za duży.");
  try { return JSON.parse(body); } catch { throw new OAuthError("invalid_client", "Dokument tożsamości klienta nie jest poprawnym JSON."); }
}
export async function registerCimdClient(url: string, doc: unknown): Promise<OAuthClient> {
  if (!isCimdUrl(url)) throw new OAuthError("invalid_client", "client_id nie jest adresem https dokumentu tożsamości.");
  const p = Registration.extend({ client_id: z.string() }).safeParse(doc);
  if (!p.success) throw new OAuthError("invalid_client", "Dokument tożsamości klienta nie ma client_id i redirect_uris.");
  if (p.data.client_id !== url) throw new OAuthError("invalid_client", "client_id w dokumencie tożsamości różni się od jego adresu.");
  // dokument publikuje klient (np. Claude) i może mieć więcej adresów: zostają tylko dozwolone, bez żadnego dozwolonego nie ma klienta
  const uris = p.data.redirect_uris.filter((u) => isAllowedRedirect(u));
  if (!uris.length) throw new OAuthError("invalid_redirect_uri", `Dokument tożsamości klienta nie podaje adresu, na który Task Hub odsyła zgodę (${p.data.redirect_uris[0]}).`);
  const name = (p.data.client_name ?? "").trim().slice(0, 120) || new URL(url).hostname;
  await sql()`insert into oauth_clients (id, name, redirect_uris, secret_hash, auth_method, metadata, created_at)
    values (${url}, ${name}, ${sql().json(uris)}, null, 'none', ${sql().json({ cimd: true } as never)}, now())
    on conflict (id) do update set name = excluded.name, redirect_uris = excluded.redirect_uris, created_at = now()`;
  return { id: url, name, redirectUris: uris, secretHash: null, authMethod: "none" };
}

// ---------- prośba o zgodę ----------
export const AuthRequest = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  response_type: z.literal("code"),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256").default("S256"),
  state: z.string().max(2000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(2000).optional(),
});
export type AuthRequest = z.infer<typeof AuthRequest>;

// Zwraca klienta i sprawdzone parametry albo błąd, który pokazujemy u siebie (bez przekierowania do obcego adresu).
export async function checkAuthRequest(q: Record<string, string | undefined>): Promise<{ client: OAuthClient; req: AuthRequest }> {
  const p = AuthRequest.safeParse(q);
  if (!p.success) throw new OAuthError("invalid_request", "Niepełna prośba o połączenie: " + p.error.issues.map((i) => i.path.join(".")).join(", "));
  const client = await getClient(p.data.client_id);
  if (!client) throw new OAuthError("invalid_client", "Nieznany klient. Dodaj konektor jeszcze raz.");
  if (!client.redirectUris.includes(p.data.redirect_uri)) throw new OAuthError("invalid_request", "redirect_uri nie zgadza się z rejestracją klienta.");
  return { client, req: p.data };
}

export async function issueCode(ownerId: string, r: AuthRequest, minutes = 10): Promise<string> {
  const code = "thac_" + randomBytes(24).toString("base64url");
  await sql()`delete from oauth_codes where expires_at < now() - interval '1 day'`;
  await sql()`insert into oauth_codes (code_hash, client_id, owner_id, redirect_uri, code_challenge, scope, resource, expires_at)
    values (${sha(code)}, ${r.client_id}, ${ownerId}, ${r.redirect_uri}, ${r.code_challenge}, ${r.scope ?? SCOPE}, ${r.resource ?? null}, ${new Date(Date.now() + minutes * 60_000)})`;
  return code;
}

export const redirectWith = (uri: string, params: Record<string, string | undefined>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};

// ---------- wymiana kodu na token ----------
export type TokenParams = { grant_type?: string; code?: string; redirect_uri?: string; client_id?: string; client_secret?: string; code_verifier?: string };
export async function exchangeCode(p: TokenParams): Promise<{ access_token: string; token_type: "Bearer"; scope: string }> {
  if (p.grant_type !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Obsługiwany jest tylko authorization_code.");
  if (!p.code || !p.code_verifier || !p.client_id) throw new OAuthError("invalid_request", "Potrzebne code, code_verifier i client_id.");
  const client = await getClient(p.client_id);
  if (!client) throw new OAuthError("invalid_client", "Nieznany klient.", 401);
  if (client.secretHash && !(p.client_secret && safeEq(sha(p.client_secret), client.secretHash))) throw new OAuthError("invalid_client", "Zły sekret klienta.", 401);
  const [row] = await sql()`update oauth_codes set used_at = now() where code_hash = ${sha(p.code)} and used_at is null and expires_at > now() returning *`;
  if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Kod nieważny, zużyty albo wydany innemu klientowi.");
  if (p.redirect_uri && p.redirect_uri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri inne niż przy zgodzie.");
  if (!safeEq(challengeOf(p.code_verifier), row.codeChallenge as string)) throw new OAuthError("invalid_grant", "code_verifier nie pasuje do code_challenge.");
  const token = await createApiToken(row.ownerId as string, `${client.name} (konektor)`);
  return { access_token: token, token_type: "Bearer", scope: (row.scope as string) || SCOPE };
}

// Parametry tokenu z formularza, JSON albo nagłówka Basic (client_secret_basic).
export async function tokenParams(req: Request): Promise<TokenParams> {
  const ct = req.headers.get("content-type") ?? "";
  const raw = ct.includes("json") ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(await req.text()));
  const p: TokenParams = {};
  for (const k of ["grant_type", "code", "redirect_uri", "client_id", "client_secret", "code_verifier"] as const) { const v = raw[k]; if (typeof v === "string") p[k] = v; }
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (basic) { const [id, secret] = Buffer.from(basic[1], "base64").toString("utf8").split(":"); if (id) { p.client_id = decodeURIComponent(id); p.client_secret = decodeURIComponent(secret ?? ""); } }
  return p;
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
