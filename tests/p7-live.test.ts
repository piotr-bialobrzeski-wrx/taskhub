// Paczka 7, punkt 3: ślad biegu w bazie. Serwer MCP zapisuje przy każdym wywołaniu krok „teraz” i kroki, których bieg dotknął (świecą na kanwie),
// udana zmiana kroku stawia kropkę (agent_at) do pierwszego otwarcia; bieg wysyłki i token klienta nie zostawiają śladu w biegu.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("ślad biegu: krok „teraz”, dotknięte kroki, kropka", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", tok = "", client = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const draft = (body = "Hej"): Block => ({ type: "draft", target: { app: "slack", action: "send", where: "#dev" }, body, status: "proposed" });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const postRun = async (body: Record<string, unknown>) => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify(body) }));
  const patch = async (id: string, body: Record<string, unknown>) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const workRun = async () => {
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");
    const b = await (await postRun({ bridge: "mini", v: 2, kind: "work" })).json(); expect(b.token).toMatch(/^th_/); return b as { token: string; run: { id: string } };
  };
  const theRun = async (id: string) => (await repo.getBridgeRun(owner, id))!;
  const step = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;

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

  it("bieg pracy v2: start_step ustawia krok „teraz”, complete_step go zdejmuje i zostawia ślad z pierwszym dotknięciem; set_blocks szkicu dotyka krok i stawia kropkę", async () => {
    const t = await repo.createTask(owner, { title: "Ślad biegu", steps: [{ title: "Sprawdź logi", tool: "code" }, { title: "Napisz na Slacku", tool: "slack", needsApproval: true }, { title: "Zbędny", tool: "code" }] });
    const [s1, s2, s3] = t.steps.map((s) => s.id);
    const b = await workRun();
    expect((await theRun(b.run.id)).steps).toEqual({});
    expect(await call(b.token, "start_step", { stepId: s1 })).toBe("Krok w toku.");
    let r = await theRun(b.run.id);
    expect(r).toMatchObject({ stepId: s1, taskId: t.id });
    expect(r.steps?.[s1]).toMatchObject({ what: "zaczął krok" });
    const first = r.steps![s1].first;
    expect(await call(b.token, "complete_step", { stepId: s1, summary: "ok" })).toContain("Krok zapisany");
    r = await theRun(b.run.id);
    expect(r.stepId).toBeNull(); expect(r.taskId).toBe(t.id);   // krok się skończył, zadanie zostaje
    expect(r.steps?.[s1]).toMatchObject({ first, what: "zrobił krok" });
    expect(r.steps![s1].at >= first).toBe(true);
    expect((await step(t.id, s1)).agentAt).not.toBeNull();
    // szkic: dotknięcie „napisał szkic” i kropka; krok „teraz” = ten krok
    expect(await call(b.token, "set_blocks", { stepId: s2, blocks: [draft()] })).toContain("czeka na zatwierdzenie");
    r = await theRun(b.run.id);
    expect(r.stepId).toBe(s2);
    expect(Object.keys(r.steps ?? {}).sort()).toEqual([s1, s2].sort());
    expect(r.steps?.[s2]).toMatchObject({ what: "napisał szkic" });
    const d = await step(t.id, s2);
    expect(d.status).toBe("draft"); expect(d.agentAt).not.toBeNull(); expect(d.openedAt).toBeNull();
    // odmówiony set_blocks (dwa szkice): krok „teraz” tak, ale bez śladu i bez kropki
    expect(await call(b.token, "set_blocks", { stepId: s3, blocks: [draft("A"), draft("B")] })).toContain("Nie zapisałem");
    r = await theRun(b.run.id);
    expect(r.stepId).toBe(s3); expect(r.steps?.[s3]).toBeUndefined();
    expect((await step(t.id, s3)).agentAt).toBeNull();
    // reply_chat ze stepId: krok „teraz” bez zmian; dymek dostaje inne dotknięte kroki tego zadania
    expect(await call(b.token, "reply_chat", { taskId: t.id, text: "Logi sprawdzone, szkic czeka.", stepId: s1 })).toContain("Odpowiedź zapisana");
    r = await theRun(b.run.id);
    expect(r).toMatchObject({ stepId: s3, taskId: t.id });
    expect((await repo.listChat(owner, t.id)).at(-1)?.actions).toMatchObject({ stepId: s1, steps: [s2] });
    // notatka biegu z Maca („leave_step: id”) nie wiąże już biegu z krokiem: to robi serwer MCP
    expect((await patch(b.run.id, { note: `leave_step: ${s2}` })).status).toBe(200);
    r = await theRun(b.run.id);
    expect(r.stepId).toBe(s3); expect(r.note).toBe(`leave_step: ${s2}`);
    // stary mostek v1 woła MCP tokenem mostka: jego wywołania liczą się do otwartego biegu pracy
    const t2 = await repo.createTask(owner, { title: "Drugie zadanie", steps: [{ title: "A", tool: "code" }] });
    expect(await call(tok, "get_task", { taskId: t2.id })).toContain("Drugie zadanie");
    r = await theRun(b.run.id);
    expect(r).toMatchObject({ taskId: t2.id, stepId: null });   // krok z innego zadania odpada
    expect(Object.keys(r.steps ?? {}).sort()).toEqual([s1, s2].sort());
    expect((await patch(b.run.id, { outcome: "done" })).status).toBe(200);
  });

  it("bieg wysyłki nie zostawia śladu ani kropki; token klienta stawia kropkę bez biegu; otwarcie kroku gasi kropkę tylko, gdy świeci", async () => {
    const t = await repo.createTask(owner, { title: "Wysyłka bez śladu", steps: [{ title: "Wyślij na Slacku", tool: "slack", needsApproval: true }, { title: "Notatka", tool: "claude" }] });
    const [s1, s2] = t.steps.map((s) => s.id);
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");   // jeden otwarty bieg na właściciela
    await repo.updateStep(s1, { status: "draft", blocks: [draft()] });
    expect(await repo.approveDraft(owner, s1)).toBe(true);
    const r1 = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r1.status).toBe(200);
    const s = (await r1.json()) as { token: string; run: { id: string } };
    expect(await call(s.token, "add_facts", { stepId: s1, facts: [{ label: "Kanał", value: "#dev" }] })).not.toContain("nie jest tu dostępne");
    expect((await theRun(s.run.id)).steps).toEqual({});
    expect((await step(t.id, s1)).agentAt).toBeNull();
    expect((await patch(s.run.id, { outcome: "done", sent: { summary: "poszło" } })).status).toBe(200);
    // klient (Claude w chmurze, automat): zmiana kroku stawia kropkę, biegu nie ma
    expect(await call(client, "set_blocks", { stepId: s2, blocks: [{ type: "text", body: "Notatka z rozmowy" }] })).toBe("Panel zapisany.");
    expect((await repo.bridgeStatus(owner, 0)).run).toBeNull();
    let n = await step(t.id, s2);
    expect(n.agentAt).not.toBeNull(); expect(n.openedAt).toBeNull();
    // Piotr otwiera krok: opened_at; drugie otwarcie bez nowej zmiany nic nie zapisuje; po kolejnej zmianie agenta zapisuje znów
    await actions.openedStep(t.id, s2);
    n = await step(t.id, s2);
    const o1 = n.openedAt!; expect(o1 >= n.agentAt!).toBe(true);
    await actions.openedStep(t.id, s2);
    expect((await step(t.id, s2)).openedAt).toBe(o1);
    await repo.markAgentSteps([s2]);
    await repo.stepOpened(owner, t.id, s2);
    expect((await step(t.id, s2)).openedAt! > o1).toBe(true);
  });
});
