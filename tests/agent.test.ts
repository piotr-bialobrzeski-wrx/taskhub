// Agent z udawanym dostawcą: czat zakłada zadanie, przełączanie dostawców, hand-off, kontekst z zasadami.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Ai, AiError } from "@/lib/ai";
import { FakeProvider, project, step, task } from "./helpers";
import { handoffPrompt } from "@/lib/agent/handoff";
import { contextText } from "@/lib/agent/context";
import { z } from "zod";

describe("warstwa modelu niezależna od dostawcy", () => {
  it("wybrany dostawca dostaje schemat, a gdy zawiedzie przejściowo, odpowiada drugi", async () => {
    const a = new FakeProvider("anthropic", [], new AiError("przeciążenie", "anthropic", true));
    const b = new FakeProvider("openai", [{ ok: true }]);
    process.env.OPENAI_API_KEY = "x"; // drugi dostawca „skonfigurowany”
    const ai = new Ai("anthropic", { anthropic: a, openai: b });
    const r = await ai.json({ system: "s", prompt: "p", schema: z.object({ ok: z.boolean() }) });
    expect(r.ok).toBe(true);
    expect(a.calls).toHaveLength(1); expect(b.calls).toHaveLength(1);
    delete process.env.OPENAI_API_KEY;
  });
  it("błąd nieprzejściowy nie jest maskowany", async () => {
    const a = new FakeProvider("anthropic", [], new AiError("zły klucz", "anthropic", false));
    const ai = new Ai("anthropic", { anthropic: a });
    await expect(ai.json({ system: "s", prompt: "p", schema: z.object({}) })).rejects.toThrow("zły klucz");
  });
});

describe("prompt hand-off i kontekst", () => {
  it("prompt do Claude ma cel, zasady, wyniki wcześniejszych kroków i instrukcję complete_step", () => {
    const s1 = step({ title: "Zebrać wymagania", status: "done", output: "Lista: A, B" });
    const s2 = step({ title: "Zbudować prototyp", tool: "claudeapp", dependsOn: [s1.id] });
    const t = task({ title: "Prototyp sklepu", summary: "Pokazać klientowi", steps: [s1, s2], projectId: "p1" });
    const p = handoffPrompt(t, s2, [{ id: "r", scope: "project", projectId: "p1", tool: null, title: "Język", body: "Po angielsku", visibility: "private" }], { appUrl: "https://hub.example" });
    expect(p).toContain("Pokazać klientowi");
    expect(p).toContain("Po angielsku");
    expect(p).toContain("Lista: A, B");
    expect(p).toContain(`complete_step dla kroku ${s2.id}`);
    expect(p).toContain(`https://hub.example/tasks/${t.id}?step=${s2.id}`);
  });
  it("kontekst kanwy wypisuje zadania z priorytetem efektywnym, w zadaniu dodaje zasady narzędzi", () => {
    const t = task({ title: "Mail do Ani", level: 3, steps: [step({ tool: "gmail" })] , projectId: "p1" });
    const rules = [{ id: "1", scope: "tool" as const, projectId: null, tool: "gmail", title: "Mail", body: "Podpis: Piotr", visibility: "private" as const }];
    const board = contextText({ tasks: [t], projects: [project({ weight: 5 })], rules, samples: [] });
    expect(board).toContain("Mail do Ani");
    expect(board).toContain("efektywny 4");
    expect(board).not.toContain("Podpis: Piotr");
    const inside = contextText({ tasks: [t], projects: [project()], rules, samples: [], currentTaskId: t.id });
    expect(inside).toContain("Podpis: Piotr");
  });
});

const DB = !!process.env.TEST_DATABASE_URL;
describe.skipIf(!DB)("czat z agentem na bazie", async () => {
  const repo = await import("@/lib/repo");
  const { runChat } = await import("@/lib/agent/chat");
  const { sql } = await import("@/lib/db");
  let owner = "";
  beforeAll(async () => { owner = (await repo.ensureOwner()).id; await sql()`delete from tasks where owner_id = ${owner}`; await sql()`delete from canvas_groups where owner_id = ${owner}`; });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("wiadomość na kanwie tworzy zadanie z krokami i projektem; w zadaniu dodaje kroki i fakty", async () => {
    const fake = new FakeProvider("anthropic", [{
      reply: "Założyłem zadanie.",
      actions: [{ type: "create_task", title: "Odpisać Ani o cateringu", level: 4, project: "Warsztaty", due: null, steps: [
        { id: "n1", title: "Sprawdzić budżet", tool: "clickup", est: 15 },
        { id: "n2", title: "Odpisać Ani", tool: "slack", needsApproval: true, dependsOn: ["n1"], est: 15 },
      ] }],
    }]);
    const ai = new Ai("anthropic", { anthropic: fake });
    const r = await runChat("Ania pyta o catering na czwartek", { ai, ownerId: owner, taskId: null });
    expect(r.done[0].label).toContain("Odpisać Ani");
    const t = (await repo.listTasks(owner)).find((x) => x.title === "Odpisać Ani o cateringu")!;
    expect(t.steps).toHaveLength(2);
    expect(t.steps[1].dependsOn).toEqual([t.steps[0].id]);
    expect((await repo.findProjectByName(owner, "Warsztaty"))?.id).toBe(t.projectId);
    expect(fake.calls[0].prompt).toContain("MIEJSCE: główna kanwa");

    fake.push({ reply: "Dodałem.", actions: [
      { type: "add_steps", steps: [{ id: "n1", title: "Potwierdzić termin", tool: "calendar" }] },
      { type: "set_facts", stepId: t.steps[1].id, facts: [{ label: "Adresat", value: "Ania", pinned: false, hidden: false }] },
    ] });
    await runChat("dodaj krok z kalendarzem; adresat to Ania", { ai, ownerId: owner, taskId: t.id });
    const t2 = (await repo.getTask(owner, t.id))!;
    expect(t2.steps.map((s) => s.title)).toContain("Potwierdzić termin");
    expect((await repo.listFacts({ stepId: t.steps[1].id }))[0]).toMatchObject({ label: "Adresat", source: { app: "manual" } });
    const hist = await repo.listChat(owner, t.id);
    expect(hist.map((m) => m.role)).toEqual(["user", "agent"]);
  });

  it("„mam 1,5 h” tworzy grupę na kanwie tylko z istniejących zadań", async () => {
    const t = (await repo.listTasks(owner))[0];
    const fake = new FakeProvider("anthropic", [{ reply: "Na 1,5 h", actions: [{ type: "create_group", name: "Na 1,5 h", taskIds: [t.id, "nieistniejace"] }] }]);
    await runChat("mam 1,5 h", { ai: new Ai("anthropic", { anthropic: fake }), ownerId: owner, taskId: null });
    const g = await repo.listGroups(owner, null);
    expect(g[0]).toMatchObject({ name: "Na 1,5 h", members: [t.id] });
  });
});
