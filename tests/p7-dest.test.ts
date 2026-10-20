// Paczka 7, punkt 4: linia w rozmowie po wysyłce mówi, co i dokąd poszło; kilka ticketów na jednej liście to osobne kroki.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("cel wysyłki w rozmowie i w szkicach", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
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
  it("trzy nowe tickety na jednej liście zapisują się jako trzy szkice", async () => {
    const t = await repo.createTask(owner, { title: "Trzy story", steps: ["Podgląd ról", "Edycja roli", "Usuwanie roli"].map((x) => ({ title: `Utwórz story ${x} w ClickUpie`, tool: "clickup", needsApproval: true })) });
    for (const [i, s] of t.steps.entries()) expect(await call(client, "set_blocks", { stepId: s.id, blocks: [create(`[US] ${["Podgląd ról", "Edycja roli", "Usuwanie roli"][i]}`)] })).toContain("czeka na zatwierdzenie");
    expect(await call(client, "set_blocks", { stepId: t.steps[1].id, blocks: [create("[US] Podgląd ról")] })).toContain("Nie zapisałem");
  });
});
