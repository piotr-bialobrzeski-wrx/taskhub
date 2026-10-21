// Paczka 9, punkt 2: decyzja Piotra nie ginie. get_task pokazuje kartki zrobionych kroków Piotra i kroków, od których zależą otwarte
// (agent nie widział tabeli poziomów z kroku „Wybierz strategię…”); zasada DECISION_RULE każe dać na kartce pytanie z opcjami;
// „Zrobione” kroku-wyboru bez pytania zapisuje, co Piotr wybrał, w wyniku kroku; krok z kodem bez repozytorium biegnie w katalogu roboczym.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block } from "@/lib/schema";
import { cardText, doneCardsFor } from "@/lib/agent/context";
import { DECISION_RULE } from "@/lib/agent/work";
import { bridgePrompt, bridgeWorkPrompt } from "@/lib/bridge";
import { DECISION_TITLE_RE } from "@/lib/schema";
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
  it("zrobione kroki Piotra bez decyzji (element listy, „Przeczytaj …”) nie wracają; odpowiedziane pytanie wraca mimo zwykłego tytułu", () => {
    const item = step({ id: "i", title: "Finish Later w onboardingu", tool: "manual", status: "done", blocks: [free] });
    const read = step({ id: "r", title: "Przeczytaj ofertę", tool: "manual", status: "done", blocks: [free] });
    const asked = step({ id: "q", title: "Oferta dla Kingi", tool: "manual", status: "done", blocks: [free, q("A")] });
    const open = step({ id: "o", title: "Wyślij", tool: "claude", status: "todo", dependsOn: ["i"], blocks: [free] });
    expect(doneCardsFor([item, read, asked]).map((s) => s.id)).toEqual(["q"]);
    // element listy wraca, gdy stoi na nim otwarty krok, i idzie przed decyzją bez zależnych
    expect(doneCardsFor([asked, item, read, open]).map((s) => s.id)).toEqual(["i", "q"]);
  });
  it("kartka zrobionego kroku Piotra mówi, czyja to decyzja, i niesie jego wpis z „Co wybrałeś?”; kartka Claude'a inaczej", () => {
    const mine = step({ id: "m", title: "Wybierz wariant", tool: "manual", status: "done", blocks: [table], output: "wariant B" });
    const his = step({ id: "h", title: "Analiza", tool: "claude", status: "done", blocks: [free], output: "gotowe" });
    const open = step({ id: "o", title: "Zapisz", tool: "claude", status: "todo", dependsOn: ["h"], blocks: [free] });
    const t = cardText([mine, his, open]);
    expect(t).toContain("KARTKA ZROBIONEGO KROKU m „Wybierz wariant” (zrobiony krok Piotra");
    expect(t).toContain("WYNIK (Co wybrałeś?): wariant B");
    expect(t).toContain("KARTKA ZROBIONEGO KROKU h „Analiza” (Twój zrobiony krok");
    expect(t).not.toContain("WYNIK (Co wybrałeś?): gotowe");
  });
  it("długa kartka zrobionego kroku jest ucięta krócej niż otwarta, z oznaczeniem; łączny limit pomija dalsze kartki", () => {
    const mk = (id: string, status: "todo" | "done") => step({ id, title: "Wybierz " + id, tool: "manual", status, blocks: [{ type: "free", markdown: "x".repeat(5000) } as Block] });
    expect(cardText([mk("a", "todo")]).length).toBeGreaterThan(5000);
    const d = cardText([mk("a", "done")]);
    expect(d.length).toBeLessThan(3300);
    expect(d).toContain("[ucięto po 3000 znakach; całość ma 5010]");
    expect(cardText([mk("a", "done")], 6000, 100).length).toBeLessThan(350);   // doneMax tnie tylko zrobione
    const many = cardText([mk("a", "done"), mk("b", "done"), mk("c", "done"), mk("d", "done")]);
    expect(many).toContain("KARTKA ZROBIONEGO KROKU a");
    expect(many).toContain("KARTKA ZROBIONEGO KROKU b");
    expect(many).not.toContain("KARTKA ZROBIONEGO KROKU c");   // 2 × (3000 + oznaczenie) mieści się w 9000, trzecia już nie
    expect(many).not.toContain("KARTKA ZROBIONEGO KROKU d");
    expect(many).toContain("(pominięto 2 kartek zrobionych kroków: limit 9000 znaków)");
  });
});

describe("zasada decyzji i krok z kodem bez repozytorium w promptach", () => {
  it("DECISION_RULE jest w prompcie mostka i mówi o pytaniu z opcjami na kartce kroku Piotra", () => {
    expect(DECISION_RULE).toContain("klocek question z opcjami");
    expect(DECISION_RULE).toContain("KARTKA ZROBIONEGO KROKU");
    expect(bridgeWorkPrompt()).toContain(DECISION_RULE);
    expect(DECISION_RULE).toContain("Co wybrałeś?");
    expect(bridgePrompt()).not.toContain(DECISION_RULE);   // mostek v1 bez zmian
  });
  it("krok z kodem bez zmian w repozytorium biegnie w katalogu roboczym; zmiana repozytorium nadal wymaga folderu", () => {
    const p = bridgeWorkPrompt();
    expect(p).toContain("rób w katalogu roboczym biegu");
    expect(p).toContain("Dodaj folder repozytorium w Ustawieniach aplikacji Task Hub na Macu (Foldery z kodem)");
    expect(p).toContain("gdy Bash nie jest w tym biegu dostępny, oddaj krok przez leave_step");   // starsza aplikacja (0.1.7, 0.1.8) bez Basha
    expect(p).not.toContain("Bash widzi tylko ten katalog");   // zakres Basha mówi dopisek aplikacji na Macu, zależny od folderów
    expect(bridgePrompt()).not.toContain("rób w katalogu roboczym biegu");
  });
  it("tytuł kroku-wyboru", () => {
    expect(DECISION_TITLE_RE.test("Wybierz strategię doboru modelu")).toBe(true);
    expect(DECISION_TITLE_RE.test("Zdecyduj o wersji")).toBe(true);
    expect(DECISION_TITLE_RE.test("Zdecyduj, którą wersję wdrożyć")).toBe(true);
    expect(DECISION_TITLE_RE.test("Ustal: zakres MVP")).toBe(true);
    expect(DECISION_TITLE_RE.test("Zatwierdź wariant")).toBe(true);
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
    expect(text).toContain("WYNIK (Co wybrałeś?): wersja B z czterema poziomami");
    expect(after.steps[1].status).toBe("todo");
    expect(write.id).toBe(after.steps[1].id);
  });
  it("set_blocks nie zmienia kartki zrobionego kroku Piotra z jego odpowiedzią; inne zrobione kroki zapisuje", async () => {
    const t = await repo.createTask(owner, { title: "Decyzje", steps: [
      { title: "Oferta", tool: "manual", estMin: 5 },
      { title: "Analiza", tool: "claude" },
    ] });
    const [mine, his] = t.steps;
    await repo.updateStep(mine.id, { blocks: [table, q("B")], status: "done", doneBy: "owner" });
    await repo.updateStep(his.id, { blocks: [free], status: "done", doneBy: "agent" });
    expect(await call("set_blocks", { stepId: mine.id, blocks: [free] })).toContain("Nie zapisałem: to zrobiony krok Piotra z jego decyzją");
    expect(await call("set_blocks", { stepId: his.id, blocks: [free, table] })).not.toContain("Nie zapisałem");
    const after = (await repo.getTask(owner, t.id))!;
    expect(after.steps[0].blocks?.map((b) => b.type)).toEqual(["table", "question"]);
    expect(after.steps[1].blocks?.map((b) => b.type)).toEqual(["free", "table"]);
  });
  it("wynik z „Co wybrałeś?”: ucięty do 2000 znaków, same spacje i brak wpisu nie ruszają wcześniejszego wyniku", async () => {
    const t = await repo.createTask(owner, { title: "W", steps: [{ title: "Wybierz a", tool: "manual", estMin: 5 }, { title: "Ustal b", tool: "manual", estMin: 5 }, { title: "Zadzwoń", tool: "manual", estMin: 5 }] });
    await repo.updateStep(t.steps[1].id, { output: "stary" });
    await doneWithTime(t.id, t.steps[0].id, null, "y".repeat(2500));
    await doneWithTime(t.id, t.steps[1].id, null, "   ");
    await doneWithTime(t.id, t.steps[2].id, 5);
    const a = (await repo.getTask(owner, t.id))!;
    expect(a.steps[0].output?.length).toBe(2000);
    expect(a.steps[1].output).toBe("stary");
    expect(a.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    const text = await call("get_task", { taskId: t.id });
    expect(text).toContain("wynik: " + "y".repeat(2000));
    expect(text).not.toContain("y".repeat(2000) + "…");   // decyzja Piotra w całości, bez ucięcia
  });
});
