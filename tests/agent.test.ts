// Agent z udawanym dostawcą: czat zakłada zadanie, przełączanie dostawców, hand-off, kontekst z zasadami.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Ai, AiError } from "@/lib/ai";
import { FakeProvider, project, rule, step, task } from "./helpers";
import { handoffPrompt } from "@/lib/agent/handoff";
import { cardText, contextText, draftsText, procedureMatches, rulesText } from "@/lib/agent/context";
import { z } from "zod";
import type { Connection } from "@/lib/schema";

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
    const p = handoffPrompt(t, s2, [rule({ scope: "project", projectId: "p1", title: "Język", body: "Po angielsku" })], { appUrl: "https://hub.example" });
    expect(p).toContain("Pokazać klientowi");
    expect(p).toContain("Po angielsku");
    expect(p).toContain("Lista: A, B");
    expect(p).toContain(`complete_step dla kroku ${s2.id}`);
    expect(p).toContain(`https://hub.example/tasks/${t.id}?step=${s2.id}`);
  });
  it("kontekst kanwy wypisuje zadania z priorytetem efektywnym, w zadaniu dodaje zasady narzędzi", () => {
    const t = task({ title: "Mail do Ani", level: 3, steps: [step({ tool: "gmail" })] , projectId: "p1" });
    const rules = [rule({ scope: "tool", tool: "gmail", title: "Mail", body: "Podpis: Piotr" })];
    const board = contextText({ tasks: [t], projects: [project({ weight: 5 })], rules, samples: [] });
    expect(board).toContain("Mail do Ani");
    expect(board).toContain("efektywny 4");
    expect(board).not.toContain("Podpis: Piotr");
    const inside = contextText({ tasks: [t], projects: [project()], rules, samples: [], currentTaskId: t.id });
    expect(inside).toContain("Podpis: Piotr");
  });
  it("zasady w trzech sekcjach: profil i zasady zawsze, procedura w całości tylko gdy pasuje wyzwalacz, inaczej skrót w spisie", () => {
    const rules = [
      rule({ kind: "profile", scope: "project", projectId: "p1", title: "Shiftwow", body: "Język: angielski\nKlient: Shiftwow" }),
      rule({ kind: "rule", title: "Formatowanie", body: "Bez myślników." }),
      rule({ kind: "procedure", title: "User story", summary: "Jak pisać story w ClickUp.", trigger: "story, user story", body: "Tytuł story od czasownika..." }),
      rule({ kind: "procedure", scope: "tool", tool: "slack", title: "Wątek na Slacku", summary: "Jak odpowiadać w wątku.", trigger: "slack", body: "Krótko, w wątku, bez emoji." }),
      rule({ kind: "procedure", title: "Przegląd", summary: "Co sprawdzać przy przeglądzie.", trigger: "przegląd", body: "Sprawdź listę i terminy." }),
    ];
    const t = rulesText(rules, "p1", ["clickup"], { text: "Napisać user story dla logowania" });
    expect(t.indexOf("PROFIL")).toBeLessThan(t.indexOf("ZASADY PRACY"));
    expect(t.indexOf("ZASADY PRACY")).toBeLessThan(t.indexOf("PROCEDURY"));
    expect(t).toContain("Klient: Shiftwow");
    expect(t).toContain("Bez myślników.");
    expect(t).toContain("Tytuł story od czasownika");           // pasuje po słowie z tekstu kroku
    expect(t).not.toContain("Krótko, w wątku");                   // narzędzie slack nie jest w krokach: nie ma jej wcale (zakres)
    expect(t).toContain("- Przegląd: Co sprawdzać przy przeglądzie. [gdy: przegląd]"); // tylko skrót
    expect(t).not.toContain("Sprawdź listę i terminy.");
    const s = rulesText(rules, null, ["slack"], { topic: ["przeglad"] });  // temat bez polskich znaków też pasuje
    expect(s).toContain("Krótko, w wątku, bez emoji.");
    expect(s).toContain("Sprawdź listę i terminy.");
    expect(s).not.toContain("Klient: Shiftwow");                  // profil innego projektu nie wchodzi
    expect(procedureMatches(rules[2], [], { topic: ["user story"] })).toBe(true);   // temat zawarty w tytule
    expect(procedureMatches(rules[2], [], { text: "Odpisać na maila" })).toBe(false);
  });
  it("zasady firmy wchodzą tylko do zadań jej projektów; kontekst podaje firmę i sferę, projekt bez firmy jest prywatny", () => {
    const rules = [rule({ kind: "profile", scope: "company", companyId: "c1", title: "Firma: Pirxey", body: "Dwa brandy: Pirxey i Widelab" }), rule({ title: "Ogólna", body: "Krótko." })];
    expect(rulesText(rules, "p1", [], { companyId: "c1" })).toContain("Dwa brandy");
    expect(rulesText(rules, "p1", [], { companyId: null })).not.toContain("Dwa brandy");
    const companies = [{ id: "c1", name: "Pirxey", sphere: "work" as const, note: null, endedAt: null }];
    const t = task({ projectId: "p1" });
    const ctx = contextText({ tasks: [t], projects: [project({ companyId: "c1" })], companies, rules, samples: [], currentTaskId: t.id });
    expect(ctx).toContain("Projekt 3/5 (Pirxey)");
    expect(ctx).toContain("sfera zawodowa");
    expect(ctx).toContain("Dwa brandy");
    const priv = contextText({ tasks: [t], projects: [project()], companies, rules, samples: [], currentTaskId: t.id });
    expect(priv).toContain("Projekt 3/5 (prywatny)");
    expect(priv).toContain("sfera prywatna");
    expect(priv).not.toContain("Dwa brandy");
  });
  it("połączenia w kontekście: zadanie widzi tylko swoją sferę, krok podaje wskazane połączenie, wygasłe jest oznaczone", () => {
    const companies = [{ id: "c1", name: "Pirxey", sphere: "work" as const, note: null, endedAt: null }];
    const conn = (p: Partial<Connection>): Connection => ({ id: "k1", app: "slack", label: "Slack Pirxey", account: null, companyId: "c1", sphere: "work", provider: "claude-code", kind: "mcp", state: "active", source: "bridge", host: "Mac", url: null, meta: {}, seenAt: null, ...p });
    const connections = [conn({}), conn({ id: "k2", label: "Gmail prywatny", app: "gmail", companyId: null, sphere: "private", provider: "claude", state: "expired" }), conn({ id: "k3", label: "Poczta domowa", app: "gmail", account: "ja@dom.pl", companyId: null, sphere: "private", provider: "claude" })];
    const t = task({ projectId: "p1", steps: [step({ tool: "slack", connectionId: "k1" })] });
    const ctx = contextText({ tasks: [t], projects: [project({ companyId: "c1" })], companies, connections, rules: [], samples: [], currentTaskId: t.id });
    expect(ctx).toContain("POŁĄCZENIA");
    expect(ctx).toContain("Slack Pirxey | Pirxey | Claude Code na komputerze");
    expect(ctx).not.toContain("Gmail prywatny");
    expect(ctx).toContain("| połączenie: Slack Pirxey");
    const priv = contextText({ tasks: [t], projects: [project()], companies, connections, rules: [], samples: [], currentTaskId: t.id });
    expect(priv).toContain("Gmail prywatny | prywatne | Claude | WYGASŁO");
    expect(priv).toContain("Poczta domowa (E-mail) ja@dom.pl | prywatne | Claude");
    expect(priv).not.toContain("Slack Pirxey |");
    const all = contextText({ tasks: [t], projects: [project()], companies, connections, rules: [], samples: [] });
    expect(all).toContain("Slack Pirxey");
    expect(all).toContain("Gmail prywatny");
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
    await repo.createProject(owner, "Warsztaty");   // od paczki 8 agent nie zakłada projektów: nazwa musi być z listy (także odmieniona)
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

describe("treść zadania w kontekście", () => {
  it("idzie w całości; dopiero ponad 50 tys. znaków jest ucięta z jawnym dopiskiem", () => {
    const long = "wymaganie ".repeat(600).trim();   // 6 tys. znaków: dawniej cięte do 800
    const t = task({ source: long });
    expect(contextText({ tasks: [t], projects: [project()], rules: [], samples: [], currentTaskId: t.id })).toContain(long);
    const t2 = task({ source: "x".repeat(60_000) });
    const ctx = contextText({ tasks: [t2], projects: [project()], rules: [], samples: [], currentTaskId: t2.id });
    expect(ctx).toContain("[ucięto po 50000 znakach; całość ma 60000 znaków]");
    expect(ctx).not.toContain("x".repeat(50_001));
  });
});


describe("get_task: szkice kroków w pełnej treści", () => {
  const draft = (status: "proposed" | "approved" | "sent", extra: Record<string, unknown> = {}) => ({ type: "draft" as const, target: { app: "slack", where: "#releases", action: "send" as const }, body: "Linia 1\n\n- punkt **pogrubiony**\n" + "x".repeat(3000), status, ...extra });
  it("zatwierdzony szkic kroku w drodze do wysyłki: pełna treść bez skracania i polecenie wysyłki", () => {
    const out = draftsText([{ id: "s1", title: "Wyślij release notes", status: "handoff", blocks: [draft("approved", { subject: "Nowa wersja" })] }]);
    expect(out).toContain("SZKIC KROKU s1 „Wyślij release notes” (ZATWIERDZONY: wyślij dokładnie tę treść)");
    expect(out).toContain("- dokąd: slack · #releases · akcja send");
    expect(out).toContain("- temat: Nowa wersja");
    expect(out).toContain("---\nLinia 1\n\n- punkt **pogrubiony**\n" + "x".repeat(3000) + "\n---");
  });
  it("szkic czekający, odłożony, nieaktualny i wysłany są oznaczone, żeby ich nie wysłać; kroki bez szkicu nic nie dodają", () => {
    const out = draftsText([
      { id: "a", title: "A", status: "draft", blocks: [draft("proposed")] },
      { id: "b", title: "B", status: "todo", blocks: [draft("approved")] },
      { id: "c", title: "C", status: "todo", blocks: [draft("proposed", { stale: true })] },
      { id: "d", title: "D", status: "done", blocks: [draft("sent")] },
      { id: "e", title: "E", status: "todo", blocks: [{ type: "text", text: "notatka" } as never] },
    ]);
    expect(out).toContain("SZKIC KROKU a „A” (czeka na zatwierdzenie Piotra: nie wysyłaj)");
    expect(out).toContain("SZKIC KROKU b „B” (zatwierdzony, ale krok nie czeka na wysyłkę: nie wysyłaj)");
    expect(out).toContain("SZKIC KROKU c „C” (NIEAKTUALNY: przygotuj od nowa, nie wysyłaj)");
    expect(out).toContain("SZKIC KROKU d „D” (wysłany)");
    expect(out).not.toContain("SZKIC KROKU e");
    expect(draftsText([{ id: "z", title: "Z", status: "todo", blocks: null as never }])).toBe("");
  });
});

describe("get_task: kartka niezrobionego kroku", () => {
  it("klocki w kolejności z numerami, odpowiedź Piotra na pytanie widoczna, szkic tylko jako odnośnik; zrobione kroki pominięte", () => {
    const out = cardText([
      { id: "s1", title: "Wybierz strategię", status: "todo", blocks: [
        { type: "table", title: "Poziomy", columns: ["Poziom", "Model"], rows: [["Strategia", "Opus"]] },
        { type: "question", text: "Kto nadaje poziom?", options: [{ label: "Agent" }, { label: "Reguły" }], answer: "Agent, ale z wyjątkiem" },
        { type: "draft", target: { app: "slack", action: "send" }, body: "x", status: "proposed" },
      ] },
      { id: "s2", title: "Zrobiony", status: "done", blocks: [{ type: "text", body: "stare" }] },
    ]);
    expect(out).toContain("KARTKA KROKU s1 „Wybierz strategię”:");
    expect(out).toContain("[0] table „Poziomy” (Poziom | Model):\n  Strategia | Opus");
    expect(out).toContain("[1] question: Kto nadaje poziom? | opcje: Agent / Reguły | ODPOWIEDŹ PIOTRA: Agent, ale z wyjątkiem");
    expect(out).toContain("[2] draft (pełna treść w SZKIC KROKU)");
    expect(out).not.toContain("Zrobiony");
  });
});
