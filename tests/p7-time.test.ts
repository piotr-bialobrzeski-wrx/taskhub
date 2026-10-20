// Paczka 7, punkt 1: czas Claude'a liczy się sam (start_step albo znacznik biegu → zamknięcie), czas Piotra tylko z jego kroków; kto zamknął krok.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("czas Claude'a i czas Piotra", async () => {
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
  // bieg pracy mostka v2: token biegu, którym Claude Code woła MCP
  const workRun = async () => {
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");   // poprzedni test mógł zostawić bieg
    const b = await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json(); expect(b.token).toMatch(/^th_/); return b as { token: string; run: { id: string } };
  };
  const endRun = async (id: string) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify({ outcome: "done" }) }), { params: Promise.resolve({ id }) });
  const step = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  const ago = (col: string, table: string, id: string, min: number) => sql().unsafe(`update ${table} set ${col} = now() - interval '${min} minutes' where id = '${id}'`);

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("start_step → complete_step: czas od startu, zamknął agent, bieg ma znacznik; krok Piotra: jego minuty, zamknął Piotr", async () => {
    const t = await repo.createTask(owner, { title: "Czas biegu", steps: [{ title: "Sprawdź logi", tool: "code" }, { title: "Zadzwoń do Ani", tool: "manual", estMin: 15 }] });
    const [code, manual] = t.steps.map((s) => s.id);
    const b = await workRun();
    expect(await call(b.token, "start_step", { stepId: code })).toBe("Krok w toku.");
    expect((await step(t.id, code)).agentStartedAt).not.toBeNull();
    await ago("agent_started_at", "steps", code, 4);
    await ago("started_at", "bridge_runs", b.run.id, 5);   // bieg trwa od 5 min, krok zaczęty 4 min temu
    expect(await call(b.token, "complete_step", { stepId: code, summary: "ok" })).toContain("Krok zapisany");
    const c = await step(t.id, code);
    expect(c).toMatchObject({ status: "done", doneBy: "agent", agentStartedAt: null, spentSec: 0 });
    expect(c.agentSec).toBeGreaterThanOrEqual(235); expect(c.agentSec).toBeLessThanOrEqual(245);
    expect((await repo.getBridgeRun(owner, b.run.id))?.markAt).not.toBeNull();
    expect(await call(b.token, "complete_step", { stepId: manual, summary: "zadzwoniłem", spentMin: 20 })).toContain("Krok zapisany");
    expect(await step(t.id, manual)).toMatchObject({ status: "done", doneBy: "owner", spentSec: 1200, agentSec: 0 });
    expect((await repo.listSamples(owner)).find((x) => x.tool === "manual")).toMatchObject({ spentMin: 20, who: "owner" });
    await endRun(b.run.id);
  });
  it("bez start_step: od znacznika biegu; start sprzed biegu liczy się od startu biegu; oddanie liczy tylko od start_step", async () => {
    const t = await repo.createTask(owner, { title: "Znacznik biegu", steps: [{ title: "A", tool: "code" }, { title: "B", tool: "code" }, { title: "C", tool: "code" }, { title: "D", tool: "code" }] });
    const [a, bb, c, d] = t.steps.map((s) => s.id);
    const b = await workRun();
    await ago("mark_at", "bridge_runs", b.run.id, 6);
    expect(await call(b.token, "complete_step", { stepId: a, summary: "ok" })).toContain("Krok zapisany");
    const sa = await step(t.id, a);
    expect(sa.agentSec).toBeGreaterThanOrEqual(355); expect(sa.agentSec).toBeLessThanOrEqual(365);
    // start_step sprzed tego biegu (zostawiony krok z poprzedniego biegu): liczy się od startu biegu, nie od tamtego startu
    await ago("agent_started_at", "steps", bb, 120);
    await ago("started_at", "bridge_runs", b.run.id, 3);
    expect(await call(b.token, "complete_step", { stepId: bb, summary: "ok" })).toContain("Krok zapisany");
    const sb = await step(t.id, bb);
    expect(sb.agentSec).toBeGreaterThanOrEqual(175); expect(sb.agentSec).toBeLessThanOrEqual(185);
    // leave_step: od start_step tak, od znacznika biegu nie
    expect(await call(b.token, "start_step", { stepId: c })).toBe("Krok w toku.");
    await ago("agent_started_at", "steps", c, 2);
    await ago("mark_at", "bridge_runs", b.run.id, 9);
    expect(await call(b.token, "leave_step", { stepId: c, reason: "brak dostępu" })).toBe("Krok oddany.");
    const sc = await step(t.id, c);
    expect(sc.status).toBe("todo"); expect(sc.agentStartedAt).toBeNull();
    expect(sc.agentSec).toBeGreaterThanOrEqual(115); expect(sc.agentSec).toBeLessThanOrEqual(125);
    await ago("mark_at", "bridge_runs", b.run.id, 9);
    expect(await call(b.token, "leave_step", { stepId: d, reason: "brak narzędzia" })).toBe("Krok oddany.");
    expect((await step(t.id, d)).agentSec).toBe(0);
    await endRun(b.run.id);
  });
  it("szkic z set_blocks: czas od znacznika biegu dolicza się, a zgody nie ma; wysyłka przez bieg wysyłki zamyka jako agent, zgoda Piotra jako owner", async () => {
    const t = await repo.createTask(owner, { title: "Szkic i wysyłka", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const sid = t.steps[0].id;
    const b = await workRun();
    await ago("mark_at", "bridge_runs", b.run.id, 3);
    const draft: Block = { type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "Hej", status: "proposed" };
    expect(await call(b.token, "set_blocks", { stepId: sid, blocks: [draft] })).toContain("czeka na zatwierdzenie");
    let s = await step(t.id, sid);
    expect(s.status).toBe("draft"); expect(s.approvedAt).toBeNull();
    expect(s.agentSec).toBeGreaterThanOrEqual(175); expect(s.agentSec).toBeLessThanOrEqual(185);
    await endRun(b.run.id);
    expect(await repo.approveDraft(owner, sid)).toBe(true);
    expect(await repo.markSendStarted(owner, sid)).toBe(true);
    await ago("send_started_at", "steps", sid, 1);
    expect(await repo.completeSend(owner, sid, { summary: "poszło" })).toBe(true);
    s = await step(t.id, sid);
    expect(s.doneBy).toBe("agent"); expect(s.agentSec).toBeGreaterThanOrEqual(230);
    // szkic, który nigdzie nie idzie: zgoda Piotra go kończy i to Piotr jest wykonawcą
    const t2 = await repo.createTask(owner, { title: "Notatka", steps: [{ title: "Zapisz notatkę", tool: "claude", needsApproval: true }] });
    const nid = t2.steps[0].id;
    await repo.updateStep(nid, { status: "draft", blocks: [{ type: "draft", target: { app: "claude", action: "send" }, body: "Notatka", status: "proposed" }] });
    expect(await repo.approveDraft(owner, nid)).toBe(true);
    expect(await repo.markSendStarted(owner, nid)).toBe(true);
    expect(await repo.completeSend(owner, nid, { summary: "ok" }, "owner")).toBe(true);
    expect(await step(t2.id, nid)).toMatchObject({ status: "done", doneBy: "owner", agentSec: 0 });
    // klient bez biegu i bez start_step: czas tylko z spentMin agenta
    const t3 = await repo.createTask(owner, { title: "Klient", steps: [{ title: "Policz", tool: "code" }] });
    expect(await call(client, "complete_step", { stepId: t3.steps[0].id, summary: "ok", spentMin: 7 })).toContain("Krok zapisany");
    expect(await step(t3.id, t3.steps[0].id)).toMatchObject({ doneBy: "agent", agentSec: 420, spentSec: 0 });
  });
});
