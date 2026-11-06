// Paczka 55 (decyzja w zadaniu „Weryfikuj czas pracy agenta”): czas Claude'a od startu próby albo od ostatniego zamknięcia kroku w tej próbie;
// kroki rozpoczęte naraz się nie dublują, szkic bez start_step dostaje czas także przy poprawce, kroki jednej sesji w chmurze dzielą jej czas.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("czas Claude'a od startu próby", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", tok = "", client = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const workRun = async () => {
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");
    return (await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json()) as { token: string; run: { id: string } };
  };
  const endRun = async (id: string) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify({ outcome: "done" }) }), { params: Promise.resolve({ id }) });
  const sec = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!.agentSec ?? 0;
  const ago = (col: string, table: string, id: string, min: number) => sql().unsafe(`update ${table} set ${col} = now() - interval '${min} minutes' where id = '${id}'`);
  const near = (v: number, want: number) => { expect(v).toBeGreaterThanOrEqual(want - 5); expect(v).toBeLessThanOrEqual(want + 5); };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    await sql()`update users set cloud_close_at = null where id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("kroki rozpoczęte naraz i zamykane po kolei: każdy od poprzedniego zamknięcia, suma = czas próby", async () => {
    const t = await repo.createTask(owner, { title: "Naraz", steps: [{ title: "A", tool: "code" }, { title: "B", tool: "code" }, { title: "C", tool: "code" }] });
    const [a, b, c] = t.steps.map((s) => s.id);
    const r = await workRun();
    for (const id of [a, b, c]) expect(await call(r.token, "start_step", { stepId: id })).toBe("Krok w toku.");
    await ago("started_at", "bridge_runs", r.run.id, 6);   // próba trwa 6 min, kroki zaczęte razem
    expect(await call(r.token, "complete_step", { stepId: a, summary: "ok" })).toContain("Krok zapisany");
    near(await sec(t.id, a), 360);
    await ago("close_at", "bridge_runs", r.run.id, 2);
    expect(await call(r.token, "complete_step", { stepId: b, summary: "ok" })).toContain("Krok zapisany");
    near(await sec(t.id, b), 120);
    expect(await call(r.token, "complete_step", { stepId: c, summary: "ok" })).toContain("Krok zapisany");
    expect(await sec(t.id, c)).toBeLessThanOrEqual(5);
    await endRun(r.run.id);
  });

  it("szkic bez start_step: pierwsza wersja i poprawka w kolejnej próbie dodają czas; ta sama treść nie dodaje", async () => {
    const t = await repo.createTask(owner, { title: "Szkic w dwóch próbach", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const sid = t.steps[0].id;
    const draft = (body: string): Block => ({ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body, status: "proposed" });
    const r1 = await workRun();
    await ago("started_at", "bridge_runs", r1.run.id, 4);
    expect(await call(r1.token, "set_blocks", { stepId: sid, blocks: [draft("Hej")] })).toContain("czeka na zatwierdzenie");
    near(await sec(t.id, sid), 240);
    await endRun(r1.run.id);
    const r2 = await workRun();
    await ago("started_at", "bridge_runs", r2.run.id, 3);
    expect(await call(r2.token, "set_blocks", { stepId: sid, blocks: [draft("Hej, poprawione")] })).toContain("Panel zapisany");
    near(await sec(t.id, sid), 420);
    await ago("close_at", "bridge_runs", r2.run.id, 2);
    expect(await call(r2.token, "set_blocks", { stepId: sid, blocks: [draft("Hej, poprawione")] })).toContain("Panel zapisany");
    near(await sec(t.id, sid), 420);
    await endRun(r2.run.id);
  });

  it("chmura: kroki wzięte w jednej sesji dzielą jej czas zamiast go dublować", async () => {
    await sql()`update users set cloud_close_at = null where id = ${owner}`;
    const t = await repo.createTask(owner, { title: "Sesja w chmurze", steps: [{ title: "Zleć w projekcie: A", tool: "cloud" }, { title: "Zleć w projekcie: B", tool: "cloud" }] });
    const [a, b] = t.steps.map((s) => s.id);
    for (const id of [a, b]) { expect(await repo.queueCloud(owner, id)).toBe(true); expect(await call(client, "take_cloud_step", { stepId: id })).toContain("Krok w toku"); }
    for (const id of [a, b]) await ago("agent_started_at", "steps", id, 8);
    expect(await call(client, "complete_step", { stepId: a, summary: "ok" })).toContain("Krok zapisany");
    near(await sec(t.id, a), 480);
    await sql()`update users set cloud_close_at = now() - interval '3 minutes' where id = ${owner}`;
    expect(await call(client, "complete_step", { stepId: b, summary: "ok" })).toContain("Krok zapisany");
    near(await sec(t.id, b), 180);
    // krok wzięty po ostatnim zamknięciu (następna sesja) liczy się od wzięcia
    await sql()`update users set cloud_close_at = now() - interval '5 minutes' where id = ${owner}`;
    const t2 = await repo.createTask(owner, { title: "Następna sesja", steps: [{ title: "Zleć w projekcie: C", tool: "cloud" }] });
    const cid = t2.steps[0].id;
    expect(await repo.queueCloud(owner, cid)).toBe(true);
    expect(await call(client, "take_cloud_step", { stepId: cid })).toContain("Krok w toku");
    await ago("agent_started_at", "steps", cid, 1);
    expect(await call(client, "complete_step", { stepId: cid, summary: "ok" })).toContain("Krok zapisany");
    near(await sec(t2.id, cid), 60);
  });
});
