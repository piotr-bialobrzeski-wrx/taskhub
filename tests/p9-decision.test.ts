// Paczka 9, punkt 2: decyzja Piotra nie ginie. get_task pokazuje kartki zrobionych kroków Piotra i kroków, od których zależą otwarte
// (agent nie widział tabeli poziomów z kroku „Wybierz strategię…”); zasada DECISION_RULE każe dać na kartce pytanie z opcjami;
// „Zrobione” kroku-wyboru bez pytania zapisuje, co Piotr wybrał, w wyniku kroku; krok z kodem bez repozytorium biegnie w katalogu roboczym.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";
import { cardText, doneCardsFor } from "@/lib/agent/context";
import { DECISION_RULE } from "@/lib/agent/work";
import { bridgeWorkPrompt } from "@/lib/bridge";
import { DECISION_TITLE_RE } from "@/lib/stepcard";
import { step } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const table: Block = { type: "table", title: "Poziomy", columns: ["Poziom", "Model"], rows: [["Strategia", "Fable"], ["Wykonanie", "Sonnet"]] } as Block;
const q = (answer?: string): Block => ({ type: "question", text: "Która wersja?", options: [{ label: "A" }, { label: "B" }], ...(answer ? { answer } : {}) } as Block);
const free: Block = { type: "free", markdown: "treść" } as Block;
const draft: Block = { type: "draft", target: { app: "clickup", where: "x", action: "create" }, subject: "x", body: "y", status: "sent" } as Block;

describe("kartki zrobionych kroków w get_task", () => {
  const s1 = step({ id: "s1", title: "Wybierz strategię", tool: "manual", status: "done", blocks: [table, q("B")] });
  const s2 = step({ id: "s2", title: "Przeczytane tickety", tool: "clickup", status: "done", blocks: [free] });
  const s3 = step({ id: "s3", title: "Analiza", tool: "claude", status: "done", blocks: [free] });
  const s4 = step({ id: "s4", title: "Zapisz zasadę", tool: "claude", status: "todo", dependsOn: ["s1", "s3"], blocks: [free] });
  const s5 = step({ id: "s5", title: "Wyślij", tool: "manual", status: "done", blocks: [draft] });
  it("zrobiony krok Piotra i zrobiony krok, od którego zależy otwarty, są do wglądu; inne zrobione nie; same szkice nie", () => {
    expect(doneCardsFor([s1, s2, s3, s4, s5]).map((s) => s.id)).toEqual(["s1", "s3"]);
    const t = cardText([s1, s2, s3, s4, s5]);
    expect(t.indexOf("KARTKA KROKU s4")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("KARTKA KROKU s4")).toBeLessThan(t.indexOf("KARTKA ZROBIONEGO KROKU s1"));
    expect(t).toContain("KARTKA ZROBIONEGO KROKU s1 „Wybierz strategię”");
    expect(t).toContain("ODPOWIEDŹ PIOTRA: B");
    expect(t).toContain("Strategia | Fable");
    expect(t).toContain("KARTKA ZROBIONEGO KROKU s3");
    expect(t).not.toContain("KROKU s2");
    expect(t).not.toContain("KROKU s5");
  });
  it("bez pola tool (stare wywołania) liczą się tylko zależności", () => {
    const bare = [{ id: "a", title: "A", status: "done" as const, blocks: [free] }, { id: "b", title: "B", status: "todo" as const, blocks: [free], dependsOn: ["a"] }];
    expect(doneCardsFor(bare).map((s) => s.id)).toEqual(["a"]);
    expect(doneCardsFor([bare[0]])).toEqual([]);
  });
  it("długa kartka zrobionego kroku jest ucięta krócej niż otwarta", () => {
    const long = step({ id: "l", title: "L", tool: "manual", status: "done", blocks: [{ type: "free", markdown: "x".repeat(5000) } as Block] });
    expect(cardText([long]).length).toBeLessThan(3200);
  });
});

describe("zasada decyzji i krok z kodem bez repozytorium w promptach", () => {
  it("DECISION_RULE jest w prompcie mostka i mówi o pytaniu z opcjami na kartce kroku Piotra", () => {
    expect(DECISION_RULE).toContain("klocek question z opcjami");
    expect(DECISION_RULE).toContain("KARTKA ZROBIONEGO KROKU");
    expect(bridgeWorkPrompt()).toContain(DECISION_RULE);
  });
  it("krok z kodem bez zmian w repozytorium biegnie w katalogu roboczym; zmiana repozytorium nadal wymaga folderu", () => {
    const p = bridgeWorkPrompt();
    expect(p).toContain("rób w katalogu roboczym biegu");
    expect(p).toContain("Dodaj folder repozytorium w Ustawieniach aplikacji Task Hub na Macu (Foldery z kodem)");
  });
  it("tytuł kroku-wyboru", () => {
    expect(DECISION_TITLE_RE.test("Wybierz strategię doboru modelu")).toBe(true);
    expect(DECISION_TITLE_RE.test("Zdecyduj o wersji")).toBe(true);
    expect(DECISION_TITLE_RE.test("Wybierzmy się na spacer")).toBe(false);
    expect(DECISION_TITLE_RE.test("Przeczytaj ofertę")).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("decyzja w bazie i w konektorze", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const { doneWithTime } = await import("@/app/actions");
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
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  it("zadanie bez kroków dostaje w liście pracy zasadę decyzji", async () => {
    await repo.createTask(owner, { title: "Bez kroków", source: "x" });
    const w = await workSummary(owner, { audience: "client", peek: true });
    expect(w.text).toContain(DECISION_RULE);
  });
  it("„Zrobione” kroku-wyboru zapisuje wybór w wyniku kroku, a get_task pokazuje kartkę zrobionego kroku Piotra", async () => {
    const t = await repo.createTask(owner, { title: "Dobór modelu", steps: [
      { title: "Wybierz strategię doboru", tool: "manual", estMin: 15 },
      { title: "Zapisz zasadę", tool: "claude", dependsOn: ["n1"] },
    ].map((s, i) => ({ ...s, id: "n" + (i + 1) })) });
    const [pick, write] = t.steps;
    await repo.updateStep(pick.id, { blocks: [table] });
    await doneWithTime(t.id, pick.id, 10, "  wersja B z czterema poziomami  ");
    const after = (await repo.getTask(owner, t.id))!;
    expect(after.steps[0].status).toBe("done");
    expect(after.steps[0].output).toBe("wersja B z czterema poziomami");
    expect(after.steps[0].spentSec).toBe(600);
    const text = await call("get_task", { taskId: t.id });
    expect(text).toContain("wynik: wersja B z czterema poziomami");
    expect(text).toContain(`KARTKA ZROBIONEGO KROKU ${pick.id}`);
    expect(text).toContain("Strategia | Fable");
    expect(text).not.toContain(`KARTKA KROKU ${pick.id}`);
    expect(write.status).toBe("todo");
  });
});
