// Paczka 40, krok 05 zadania „Menu Ułóż z gotowymi układami kanwy”: grupowanie zlecone w czacie idzie tą samą drogą co menu „Ułóż”.
// group_canvas z preset liczy gotowy układ od razu w aplikacji; z groups (podział agenta) też daje grupy automatyczne, które kanwa
// układa w kształt ekranu i po których sama dopasowuje powiększenie.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("grupowanie z czatu w kształcie ekranu", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", tok = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from canvas_groups where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "klient");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("preset „według projektów”: od razu, stare grupy znikają, nowe są automatyczne", async () => {
    const sw = await repo.createProject(owner, "Shiftwow", 4);
    const a = await repo.createTask(owner, { title: "Retro", projectId: sw.id });
    const b = await repo.createTask(owner, { title: "Pieski" });
    await sql()`update tasks set project_id = null where id = ${b.id}`;
    const old = await repo.createGroup(owner, null, "Stara", [a.id, b.id]);
    const out = await call("group_canvas", { preset: "projects" });
    expect(out).toContain("Według projektów");
    const gs = await repo.listGroups(owner, null);
    expect(gs.some((g) => g.id === old.id)).toBe(false);
    expect(gs.map((g) => [g.name, g.auto])).toEqual([["Shiftwow", true], ["Bez projektu", true]]);
  });
  it("podział agenta (groups) dalej działa, grupy automatyczne; bez preset i groups kanwa bez zmian", async () => {
    const [t1] = (await repo.listTasks(owner)).map((t) => t.id);
    expect(await call("group_canvas", { groups: [{ name: "Dziś", taskIds: [t1] }] })).toContain("1 grup");
    expect((await repo.listGroups(owner, null)).map((g) => [g.name, g.auto])).toEqual([["Dziś", true]]);
    expect(await call("group_canvas", {})).toContain("kanwa bez zmian");
    expect((await repo.listGroups(owner, null)).length).toBe(1);
  });
});
