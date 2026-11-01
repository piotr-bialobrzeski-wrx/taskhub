// Paczka 32: (1) decyzja Piotra na kartce jest zgodą także na kroki „Zleć w projekcie”, zaplanowane przed decyzją (wcześniej tylko na dopisane po niej);
// „Wdróż na produkcję” zawsze czeka na kliknięcie. (2) łańcuch zadań: agent zakłada zadanie „po zadaniu X” (create_task / update_task after),
// takie zadanie czeka: kafelek „Czeka na inne zadanie”, pole „Przy okazji”, agent go nie bierze. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block, Step } from "@/lib/schema";
import { stepsAfterDecision } from "@/lib/stepcard";
import { chainLoops, taskLook } from "@/lib/canvas/vm";
import { laneOf } from "@/lib/canvas/lanes";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const st = (id: string, title: string, dependsOn: string[] = [], status: Step["status"] = "todo", tool = "manual") => ({ id, title, tool, status, dependsOn });

describe("kroki po decyzji (bez bazy)", () => {
  it("bierze zaplanowane kroki „Zleć w projekcie” po decyzji, także w ciągu; bez wdrożenia i kroków niezwiązanych", () => {
    const steps = [
      st("d", "Zdecyduj wariant losowania", [], "done"),
      st("a", "Zleć w projekcie: wdrożenie losowania", ["d"]),
      st("b", "Zleć w projekcie: poprawki po wdrożeniu", ["a"]),
      st("x", "Zleć w projekcie: przegląd zaległości", []),
      st("w", "Wdróż na produkcję", ["a", "b"]),
      st("m", "Sprawdź wynik na telefonie", ["d"]),
    ];
    expect(stepsAfterDecision(steps, "d", "Task Hub").sort()).toEqual(["a", "b"]);
  });
  it("zrobionych ani zleconych dalej nie rusza", () => {
    expect(stepsAfterDecision([st("d", "Zdecyduj", [], "done"), st("a", "Zleć w projekcie: x", ["d"], "done")], "d")).toEqual([]);
  });
});

describe("łańcuch zadań (bez bazy)", () => {
  it("wykrywa koło zależności", () => {
    const all = [{ id: "A", dependsOn: [] }, { id: "B", dependsOn: ["A"] }, { id: "C", dependsOn: ["B"] }];
    expect(chainLoops(all, "A", ["C"])).toBe(true);
    expect(chainLoops(all, "A", ["A"])).toBe(true);
    expect(chainLoops(all, "C", ["A"])).toBe(false);
  });
  it("zadanie, które czeka, nie jest pilne i ma własną etykietę", () => {
    expect(laneOf({ lane: "pilne-szybkie", eff: 5, remainMin: 5, hasSteps: true, waiting: true })).toBe("przy-okazji");
    expect(laneOf({ lane: null, eff: 5, remainMin: 5, hasSteps: true })).toBe("pilne-szybkie");
    const t = { steps: [] } as unknown as Parameters<typeof taskLook>[0];
    expect(taskLook(t, "blocked", [{ key: "mine", label: "Zrób" }], false, 1)).toEqual({ key: "plan-ag", label: "Czeka na inne zadanie" });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("decyzja i łańcuch w bazie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", client = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const q: Block = { type: "question", text: "Który wariant losowania?", options: [{ label: "A" }, { label: "B" }], recommended: 0 };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("odpowiedź na kartce decyzji zleca do chmury kroki zaplanowane wcześniej; wdrożenie czeka", async () => {
    const t = await repo.createTask(owner, { title: "Losowanie zadań", projectId: null, steps: [
      { title: "Zdecyduj wariant losowania", tool: "manual" },
      { title: "Zleć w projekcie: wdrożenie losowania", tool: "manual", dependsOn: ["n1"] },
      { title: "Zleć w projekcie: poprawki po wdrożeniu", tool: "manual", dependsOn: ["n2"] },
      { title: "Wdróż na produkcję", tool: "manual", dependsOn: ["n3"] },
    ] });
    const [dec] = t.steps;
    await repo.updateStep(dec.id, { blocks: [q] });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec.id, index: "0", q: "Który wariant losowania?", option: "A" }));
    const all = (await repo.getTask(owner, t.id))!.steps;
    expect(all[0].status).toBe("done");
    expect(all[1].cloud).toMatchObject({ state: "queued", from: dec.id });
    expect(all[2].cloud).toMatchObject({ state: "auto", from: dec.id });
    expect(all[3].cloud ?? null).toBeNull();
    expect((await repo.listChat(owner, t.id, 50)).some((m) => m.text.includes("po Twoim kroku 01"))).toBe(true);
  });

  it("create_task i update_task z after łączą zadania; zły id i koło są odrzucane", async () => {
    const a = await repo.createTask(owner, { title: "Sprawdź warunki promocji", projectId: null, steps: [{ title: "Zdecyduj, czy zakładasz konto", tool: "manual" }] });
    const out = await call("create_task", { title: "Załóż konto i wpłać środki", after: [a.id], steps: [{ title: "Załóż konto", tool: "manual" }] });
    const bId = JSON.parse(out).taskId as string;
    expect((await repo.getTask(owner, bId))!.dependsOn).toEqual([a.id]);
    expect(await call("update_task", { taskId: a.id, after: [bId] })).toContain("czekałyby na siebie");
    expect(await call("create_task", { title: "Zamknij konto", after: ["00000000-0000-0000-0000-000000000000"] })).toContain("nie ma zadań");
    expect(await call("update_task", { taskId: bId, after: [] })).toBe("Zmieniono.");
    expect((await repo.getTask(owner, bId))!.dependsOn).toEqual([]);
  });
});
