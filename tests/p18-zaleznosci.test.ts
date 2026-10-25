// Paczka 18: update_step zmienia zależności istniejącego kroku (strzałki) przez konektor, z ochroną przed pętlą i krokami spoza zadania.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("update_step: dependsOn", async () => {
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
  const depsOf = async (taskId: string) => Object.fromEntries((await repo.getTask(owner, taskId))!.steps.map((s) => [s.title, s.dependsOn]));

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "test");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("zastępuje listę, [] zdejmuje wszystkie strzałki, bez dependsOn nic nie rusza", async () => {
    const t = await repo.createTask(owner, { title: "Paczka", steps: [{ title: "A" }, { title: "B", dependsOn: ["n1"] }, { title: "C", dependsOn: ["n1", "n2"] }, { title: "Wdróż", dependsOn: ["n1", "n2", "n3"] }] });
    const [a, b, c] = t.steps;
    expect(await call("update_step", { stepId: c.id, dependsOn: [] })).toContain("Zmieniono");
    expect(await call("update_step", { stepId: b.id, dependsOn: [] })).toContain("Zmieniono");
    expect(await call("update_step", { stepId: a.id, title: "A2" })).toContain("Zmieniono");
    const d = await depsOf(t.id);
    expect(d).toMatchObject({ A2: [], B: [], C: [] });
    expect([...d["Wdróż"]].sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("odmawia pętli, kroku spoza zadania i samego siebie, bez zmian", async () => {
    const t = await repo.createTask(owner, { title: "Pętla", steps: [{ title: "X" }, { title: "Y", dependsOn: ["n1"] }] });
    const other = await repo.createTask(owner, { title: "Inne", steps: [{ title: "Z" }] });
    const [x, y] = t.steps;
    expect(await call("update_step", { stepId: x.id, dependsOn: [y.id] })).toContain("pętlę");
    expect(await call("update_step", { stepId: x.id, dependsOn: [other.steps[0].id] })).toContain("nie pasują");
    expect(await call("update_step", { stepId: x.id, dependsOn: [x.id] })).toContain("nie pasują");
    expect(await depsOf(t.id)).toMatchObject({ X: [], Y: [x.id] });
  });
});
