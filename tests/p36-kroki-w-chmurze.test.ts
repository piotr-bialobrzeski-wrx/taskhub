// Paczka 36: krok „Zleć w projekcie: …” to krok agenta w chmurze (narzędzie „Claude w chmurze”), nie krok Piotra. W projekcie Task Hub
// rusza sam po swoich krokach, bez „Uruchom w chmurze”; „Wdróż na produkcję” zostaje krokiem Piotra i czeka na jego kliknięcie.
// „Zrobione” na kroku Piotra i „Uruchom w chmurze” puszczają dalej kroki w chmurze, które na nie czekają. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { isOwnerStep, normalizeTool, toolLabel, type Step } from "@/lib/schema";
import { stepLook } from "@/lib/canvas/vm";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const step = (o: Partial<Step>) => ({ id: "s", title: "Zleć w projekcie: analiza", tool: "cloud", status: "todo", dependsOn: [], blocks: null, cloud: null, ...o }) as unknown as Step;

describe("narzędzie Claude w chmurze", () => {
  it("to krok agenta z własną etykietą", () => {
    expect(toolLabel("cloud")).toBe("Claude w chmurze");
    expect(normalizeTool("Claude w chmurze")).toBe("cloud");
    expect(normalizeTool("chmura")).toBe("cloud");
    expect(isOwnerStep(step({}))).toBe(false);
  });
  it("kafelek: zlecony krok ruszy sam, niezlecony czeka na kliknięcie Piotra", () => {
    expect(stepLook(step({ cloud: { state: "auto", at: "x" } }), "blocked", false)).toEqual({ key: "plan-ag", label: "Ruszy samo" });
    expect(stepLook(step({}), "blocked", false)).toEqual({ key: "plan-me", label: "Będzie Twój ruch" });
    expect(stepLook(step({}), "ready", false)).toEqual({ key: "mine", label: "Uruchom w chmurze" });
    expect(stepLook(step({ cloud: { state: "queued", at: "x" } }), "ready", false).key).toBe("live");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("kroki w chmurze w bazie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", client = "", hub = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const steps = async (taskId: string) => (await repo.getTask(owner, taskId))!.steps;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
    hub = (await repo.createProject(owner, "Task Hub")).id;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("rozpisanie w Task Hub: kroki w chmurze są krokami agenta i ruszają same; wybór i wdrożenie są Piotra", async () => {
    const t = await repo.createTask(owner, { title: "Paczka poprawek", projectId: hub });
    await call("add_steps", { taskId: t.id, steps: [
      { title: "Zleć w projekcie: przyczyna błędu", tool: "manual" },
      { title: "Zleć w projekcie: prototypy", tool: "manual", dependsOn: ["n1"] },
      { title: "Wybierz wariant na prototypach", tool: "manual", dependsOn: ["n2"] },
      { title: "Zleć w projekcie: wprowadź wariant", tool: "cloud", dependsOn: ["n3"] },
      { title: "Wdróż na produkcję", tool: "manual", dependsOn: ["n4"] },
    ] });
    const all = await steps(t.id);
    expect(all.map((s) => s.tool)).toEqual(["cloud", "cloud", "manual", "cloud", "manual"]);
    expect(all[0].cloud?.state).toBe("queued");   // nic przed nim: od razu do chmury
    expect(all[1].cloud?.state).toBe("auto");
    expect(all[3].cloud?.state).toBe("auto");
    expect(all[4].cloud ?? null).toBeNull();
    const chat = await repo.listChat(owner, t.id, 50);
    expect(chat.some((m) => m.text.startsWith("Zlecone do chmury: „Zleć w projekcie: przyczyna błędu”. Claude"))).toBe(true);
  });

  it("poza Task Hub krok w chmurze czeka na kliknięcie; „Uruchom w chmurze” puszcza dalej kroki, które na niego czekają", async () => {
    const t = await repo.createTask(owner, { title: "Inny projekt", projectId: null, steps: [
      { title: "Zleć w projekcie: analiza", tool: "manual" },
      { title: "Zleć w projekcie: zmiana", tool: "manual", dependsOn: ["n1"] },
      { title: "Wdróż na produkcję", tool: "manual", dependsOn: ["n2"] },
    ] as never });
    let all = await steps(t.id);
    expect(all[0].cloud ?? null).toBeNull();
    await actions.runInCloud(t.id, all[0].id);
    all = await steps(t.id);
    expect(all[0].cloud?.state).toBe("queued");
    expect(all[1].cloud).toMatchObject({ state: "auto", from: all[0].id });
    expect(all[2].cloud ?? null).toBeNull();
  });

  it("„Zrobione” na kroku Piotra puszcza dalej kroki w chmurze, które na niego czekają", async () => {
    const t = await repo.createTask(owner, { title: "Wybór bez pytania", projectId: null, steps: [
      { title: "Wybierz wariant", tool: "manual" },
      { title: "Zleć w projekcie: wprowadź wariant", tool: "cloud", dependsOn: ["n1"] },
    ] as never });
    let all = await steps(t.id);
    await actions.doneWithTime(t.id, all[0].id, 5, "Wariant B");
    all = await steps(t.id);
    expect(all[0].status).toBe("done");
    expect(all[1].cloud).toMatchObject({ state: "queued", from: all[0].id });
    expect((await repo.listChat(owner, t.id, 50)).some((m) => m.text.includes("po Twoim kroku 01 „Wybierz wariant”"))).toBe(true);
  });
});
