// Mostek zgłasza listę serwerów MCP, które widzi Claude Code na komputerze Piotra: rejestr połączeń wie, co agent może zrobić
// z tego komputera, bez żadnych tokenów cudzych usług (tylko nazwy, adresy i stan). Wołane po starcie mostka i co kilka godzin.
import * as repo from "@/lib/repo";
import { authBridge } from "@/lib/bridge";

export const dynamic = "force-dynamic";

type Body = { host?: string; servers?: { name?: string; url?: string | null; command?: string | null; transport?: string | null; ok?: boolean; status?: string | null }[] };

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return Response.json({ error: "Oczekuję JSON: { host, servers: [{ name, url, transport, ok, status }] }" }, { status: 400 }); }
  if (!Array.isArray(body.servers)) return Response.json({ error: "Brak listy servers." }, { status: 400 });
  const servers = body.servers.filter((s) => typeof s.name === "string" && s.name.trim()).slice(0, 100).map((s) => ({
    name: String(s.name).trim().slice(0, 80), url: typeof s.url === "string" ? s.url.replace(/[?#].*$/, "").slice(0, 500) : null,   // bez parametrów adresu: tam bywają klucze
    command: typeof s.command === "string" ? s.command.slice(0, 200) : null, transport: typeof s.transport === "string" ? s.transport.slice(0, 20) : null,
    ok: s.ok !== false, status: typeof s.status === "string" ? s.status.slice(0, 120) : null,
  }));
  const host = (typeof body.host === "string" && body.host.trim()) || a.name;
  const r = await repo.upsertBridgeConnections(a.ownerId, host, servers);
  return Response.json({ ok: true, host, ...r });
}
