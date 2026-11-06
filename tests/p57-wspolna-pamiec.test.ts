// Paczka 57, krok 03: wspólna pamięć rozmów agenta. Wątki są osobne tylko na ekranie: get_task pokazuje całą rozmowę zadania z oznaczeniem wątku,
// a search_history i sekcja „wcześniejsze prośby i decyzje” dają agentowi to, co Piotr napisał i wybrał w innych zadaniach (z nazwą zadania i numerem kroku).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { hitScore, queryWords, rankHits, threadLabel, type HistoryHit } from "@/lib/agent/history";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe("pamięć rozmów: części bez bazy", () => {
  it("słowa zapytania i trafienia z odmianą", () => {
    expect(queryWords("Czat, wątek i KROK czat")).toEqual(["czat", "wątek", "krok"]);
    expect(hitScore("osobne wątki czatu kroków", queryWords("wątek czat kroki"))).toBe(3);
  });
  it("decyzja z kartki i wiadomość o niej liczą się raz; najpierw trafniejsze", () => {
    const base = { taskId: "t", taskTitle: "Zadanie", taskDone: false, stepTitle: "Zdecyduj", stepNo: 1, at: "2026-11-01T10:00:00Z" };
    const hits: HistoryHit[] = [
      { ...base, kind: "chat", stepId: "s1", text: "Decyzja w kroku „Zdecyduj”: czat po lewej" },
      { ...base, kind: "decision", stepId: "s1", text: "Gdzie czat? → czat po lewej" },
      { ...base, kind: "chat", stepId: null, text: "czat ma być szeroki po lewej", at: "2026-11-02T10:00:00Z" },
      { ...base, kind: "chat", stepId: null, text: "coś innego" },
    ];
    const r = rankHits(hits, queryWords("czat lewej"), 10);
    expect(r.map((h) => h.kind + ":" + h.text.slice(0, 12))).toEqual(["chat:czat ma być ", "decision:Gdzie czat? "]);
  });
  it("oznaczenie wątku", () => {
    const steps = [{ id: "a", title: "Pierwszy" }, { id: "b", title: "Drugi" }];
    expect(threadLabel(null, steps)).toBe(" w wątku zadania");
    expect(threadLabel("b", steps)).toBe(" w wątku kroku 02 [b] „Drugi”");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("wspólna pamięć rozmów agenta", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("get_task: cała rozmowa z oznaczeniem wątku i decyzje z innych zadań projektu; search_history znajduje prośbę z nazwą zadania i krokiem", async () => {
    const p = await repo.createProject(owner, "Pamięć test");
    const old = await repo.createTask(owner, { title: "Układ karty kroku", projectId: p.id, steps: [{ title: "Zdecyduj, gdzie czat", tool: "manual" }, { title: "Zbuduj czat", tool: "cloud" }] });
    const [dec, build] = old.steps;
    await sql()`update steps set blocks = ${sql().json([{ type: "question", text: "Gdzie stoi czat w karcie kroku?", options: [{ label: "Po lewej" }, { label: "Na dole" }], answer: "Po lewej" }] as never)} where id = ${dec.id}`;
    await repo.addChat(owner, old.id, "user", "Panel czatu ma mieć stałą szerokość 360 px", { stepId: build.id });
    await repo.addChat(owner, old.id, "user", "Inna sprawa bez związku");

    const cur = await repo.createTask(owner, { title: "Nowy układ karty", projectId: p.id, steps: [{ title: "Pierwszy", tool: "manual" }, { title: "Drugi", tool: "manual" }] });
    await repo.addChat(owner, cur.id, "user", "ogólnie o zadaniu");
    await repo.addChat(owner, cur.id, "agent", "Zrobione w drugim", { stepId: cur.steps[1].id });

    const g = await call("get_task", { taskId: cur.id });
    expect(g).toContain("Piotr (");
    expect(g).toMatch(/Piotr \([^)]+\) w wątku zadania NOWE \[/);
    expect(g).toMatch(/Agent \([^)]+\) w wątku kroku 02 \[[^\]]+\] „Drugi”: Zrobione w drugim/);
    expect(g).toContain("WCZEŚNIEJSZE PROŚBY I DECYZJE PIOTRA W INNYCH ZADANIACH TEGO PROJEKTU");
    expect(g).toContain(`zadanie „Układ karty kroku” [${old.id}], krok 01 „Zdecyduj, gdzie czat”`);
    expect(g).toContain("decyzja na kartce: Gdzie stoi czat w karcie kroku? → Po lewej");
    expect(g).toContain("krok 02 „Zbuduj czat”");

    const s = await call("search_history", { query: "szerokość czatu", excludeTaskId: cur.id });
    expect(s.split("\n")[1]).toContain("Panel czatu ma mieć stałą szerokość 360 px");
    expect(s).toContain(`krok 02 „Zbuduj czat” [${build.id}]`);
    expect(s).not.toContain("Inna sprawa");
    expect(await call("search_history", { query: "zupełnie nieznane słowa" })).toContain("Nic nie znalazłem");
    // znaki LIKE w zapytaniu nie działają jak wzorzec
    expect(await call("search_history", { query: "%%% ___" })).toContain("Nic nie znalazłem");
  });
});
