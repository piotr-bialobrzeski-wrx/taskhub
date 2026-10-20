// Paczka 7, punkt 4: linia w rozmowie po wysyłce mówi, co i dokąd poszło; kilka ticketów na jednej liście to osobne kroki.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("cel wysyłki w rozmowie i w szkicach", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", client = "";
  const call = async (tok: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const list = "https://app.clickup.com/9005151854/v/l/li/901217157759";
  const create = (subject: string): Block => ({ type: "draft", target: { app: "clickup", where: "PirxeyOS / Full Backlog", url: list, action: "create" }, subject, body: "Opis", status: "proposed" });
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  it("po wysyłce zatwierdzonego ticketu rozmowa mówi „Utworzyłem w ClickUpie: …”", async () => {
    const t = await repo.createTask(owner, { title: "Story do ClickUp", steps: [{ title: "Utwórz story w ClickUpie", tool: "clickup", needsApproval: true }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", blocks: [create("[US] Podgląd ról")] });
    expect(await repo.approveDraft(owner, sid)).toBe(true);
    expect(await repo.markSendStarted(owner, sid)).toBe(true);
    expect(await repo.completeSend(owner, sid, { summary: "ok", link: "https://app.clickup.com/t/abc" })).toBe(true);
    expect((await repo.listChat(owner, t.id)).at(-1)?.text).toBe("Utworzyłem w ClickUpie: „[US] Podgląd ról” · PirxeyOS / Full Backlog. Zadanie ukończone.");
  });
  it("set_blocks nie zapisze szkicu, którego mostek nie wyśle: nieznane miejsce albo brak konektora na Macu; konto Google do wyboru nie zatrzymuje", async () => {
    const t = await repo.createTask(owner, { title: "Szkice bez konektora", steps: [{ title: "Notatka w Notion", tool: "claude", needsApproval: true }, { title: "Story w ClickUpie", tool: "clickup", needsApproval: true }, { title: "Mail do Ani", tool: "gmail", needsApproval: true }] });
    const [notion, cu, mail] = t.steps.map((s) => s.id);
    const d = (app: string, action = "send"): Block => ({ type: "draft", target: { app, action: action as "send", where: "x" }, body: "Treść", status: "proposed" });
    expect(await call(client, "set_blocks", { stepId: notion, blocks: [d("notion-x")] })).toContain("nie znam miejsca „notion-x”");
    expect(await call(client, "set_blocks", { stepId: cu, blocks: [create("[US] A")] })).toContain("nie ma działającego konektora ClickUp");
    expect((await repo.getTask(owner, t.id))!.steps[1].status).toBe("todo");
    await repo.upsertBridgeConnections(owner, "MacBook", [{ name: "clickup", ok: true }, { name: "google-widelab", ok: true }]);
    expect(await call(client, "set_blocks", { stepId: cu, blocks: [create("[US] A")] })).toContain("czeka na zatwierdzenie");
    expect(await call(client, "set_blocks", { stepId: mail, blocks: [d("gmail", "reply")] })).toContain("czeka na zatwierdzenie");
    // commit i prompt nie idą konektorem: bez sprawdzania
    const t2 = await repo.createTask(owner, { title: "Prompt bez konektora", steps: [{ title: "Zrób X", tool: "code", needsApproval: true }] });
    expect(await call(client, "set_blocks", { stepId: t2.steps[0].id, blocks: [d("code", "other")] })).toContain("czeka na zatwierdzenie");
  });
  it("zgoda na szkic do Slacka bez konektora Slack na Macu: nie zatwierdza, rozmowa mówi czemu", async () => {
    const t = await repo.createTask(owner, { title: "Slack bez konektora", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", blocks: [{ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "Hej", status: "proposed" }] });
    await actions.approveStep(t.id, sid);
    const s = (await repo.getTask(owner, t.id))!.steps[0];
    expect(s.approvedAt).toBeNull(); expect(s.status).toBe("draft");
    expect((await repo.listChat(owner, t.id)).at(-1)?.text).toBe("Nie zatwierdziłem „Napisz na #dev”: Na Macu nie ma konektora Slack. Dodaj go w Claude Code, potem w menu Task Hub kliknij „Sprawdź teraz”.");
    await repo.upsertBridgeConnections(owner, "MacBook", [{ name: "clickup", ok: true }, { name: "claude.ai Slack", ok: true }]);
    await actions.approveStep(t.id, sid);
    expect((await repo.getTask(owner, t.id))!.steps[0].approvedAt).not.toBeNull();
    await sql()`delete from tasks where id = ${t.id}`;   // zatwierdzony szkic nie może zostać w bazie: inne pliki testów liczą szkice do wysłania
  });
  it("trzy nowe tickety na jednej liście zapisują się jako trzy szkice", async () => {
    const t = await repo.createTask(owner, { title: "Trzy story", steps: ["Podgląd ról", "Edycja roli", "Usuwanie roli"].map((x) => ({ title: `Utwórz story ${x} w ClickUpie`, tool: "clickup", needsApproval: true })) });
    for (const [i, s] of t.steps.entries()) expect(await call(client, "set_blocks", { stepId: s.id, blocks: [create(`[US] ${["Podgląd ról", "Edycja roli", "Usuwanie roli"][i]}`)] })).toContain("czeka na zatwierdzenie");
    expect(await call(client, "set_blocks", { stepId: t.steps[1].id, blocks: [create("[US] Podgląd ról")] })).toContain("Nie zapisałem");
  });
});
