// Raport bezpieczeństwa (tylko odczyt, bez sekretów): kto i czym łączył się z Task Hub, żeby sprawdzić, czy wchodził ktoś obcy.
// Tokeny i klienci OAuth, biegi mostków, próby logowania oraz zmiany zrobione w nocy (00–06 w Warszawie), gdy Piotr zwykle śpi.
import { sql } from "./db";

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const host = (u: string) => { try { return new URL(u).host || u; } catch { return u.slice(0, 80); } };

export async function securityReport(ownerId: string, since = "2026-10-14T00:00:00Z") {
  const [tokens, clients, codes, bridges, logins, nightTasks, nightChat, rules] = await Promise.all([
    sql()`select name, kind, created_at, last_used_at, seen_at, meta->>'host' as host, meta->>'version' as version
      from api_tokens where owner_id = ${ownerId} order by created_at`,
    sql()`select id, name, redirect_uris, auth_method, created_at from oauth_clients order by created_at`,
    sql()`select client_id, count(*)::int as n, count(used_at)::int as used, min(created_at) as first, max(created_at) as last
      from oauth_codes where owner_id = ${ownerId} group by client_id`,
    sql()`select bridge, count(*)::int as runs, min(started_at) as first, max(started_at) as last
      from bridge_runs where owner_id = ${ownerId} group by bridge order by first`,
    sql()`select kind, ok, ip, country, left(coalesce(ua, ''), 120) as ua, count(*)::int as n, min(at) as first, max(at) as last
      from login_events group by kind, ok, ip, country, left(coalesce(ua, ''), 120) order by max(at) desc limit 50`,
    sql()`select created_at, left(title, 90) as title from tasks
      where owner_id = ${ownerId} and created_at >= ${since} and extract(hour from created_at at time zone 'Europe/Warsaw') < 6 order by created_at`,
    sql()`select created_at, left(text, 90) as text from chat_messages
      where owner_id = ${ownerId} and role = 'user' and created_at >= ${since} and extract(hour from created_at at time zone 'Europe/Warsaw') < 6 order by created_at`,
    sql()`select changed_at, change, left(title, 80) as title from rule_versions
      where owner_id = ${ownerId} and changed_at >= ${since} order by changed_at desc limit 40`,
  ]);
  return {
    tokens: tokens.map((t) => ({ name: t.name, kind: t.kind, created: iso(t.createdAt), lastUsed: iso(t.lastUsedAt), seen: iso(t.seenAt), host: t.host ?? null, version: t.version ?? null })),
    oauthClients: clients.map((c) => ({ id: String(c.id).slice(0, 80), name: c.name, redirectHosts: [...new Set(((c.redirectUris as string[]) ?? []).map(host))], auth: c.authMethod, created: iso(c.createdAt) })),
    oauthCodes: codes.map((c) => ({ client: String(c.clientId).slice(0, 80), issued: c.n, used: c.used, first: iso(c.first), last: iso(c.last) })),
    bridges: bridges.map((b) => ({ bridge: b.bridge, runs: b.runs, first: iso(b.first), last: iso(b.last) })),
    logins: logins.map((l) => ({ kind: l.kind, ok: l.ok, ip: l.ip, country: l.country, ua: l.ua, n: l.n, first: iso(l.first), last: iso(l.last) })),
    nightTasks: nightTasks.map((t) => ({ at: iso(t.createdAt), title: t.title })),
    nightChat: nightChat.map((m) => ({ at: iso(m.createdAt), text: m.text })),
    ruleChanges: rules.map((r) => ({ at: iso(r.changedAt), change: r.change, title: r.title })),
  };
}
