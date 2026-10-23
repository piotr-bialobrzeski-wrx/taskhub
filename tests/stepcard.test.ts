// Karta kroku „Teraz · Co · Skąd”: podział klocków, zwijanie według stanu, raport bez powtórek, linki bez dubli. Czysta logika, bez bazy.
import { describe, it, expect } from "vitest";
import { approveLabel, decisionText, destHint, destOf, doneChat, draftPlace, foldsFor, keepOwnerAnswers, kindsOf, nowHeading, openQuestions, reportLines, resultLinks, sentWord, splitBlocks, stepKind, targetLink, tileDest, sameTarget, whoDid } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";
import { step } from "./helpers";

const changes: Block = { type: "changes", repo: "wlrx/custom-cookies", branch: "intake", preview: "file:///Users/osobiste/prototype.html#catalog", summary: "W menu po lewej jest moduł Catalog Items: 17 pozycji. Format drugiej części kodu to założenie do potwierdzenia.", files: [{ path: "a.js" }] } as Block;
const facts: Block = { type: "facts", facts: [{ label: "Format", value: "2-12" }] } as Block;

describe("karta kroku", () => {
  it("blok zmian to wynik, reszta to materiały; szkic obsługuje karta publikacji", () => {
    const { result, material } = splitBlocks([facts, changes, { type: "draft", body: "x", target: { app: "slack", where: "#k", action: "send" }, status: "proposed" } as Block]);
    expect(result).toHaveLength(1);
    expect(material.map((b) => b.type)).toEqual(["facts"]);
    expect(kindsOf([facts, changes])).toBe("fakty, zmiany w kodzie");   // nie surowy klucz „changes”
  });

  it("brief i materiały zwijają się po zrobieniu; przy szkicu brief ustępuje karcie publikacji", () => {
    expect(foldsFor("ready", null)).toEqual({ brief: true, material: true });
    expect(foldsFor("handoff", null)).toEqual({ brief: true, material: true });
    expect(foldsFor("draft", "proposed")).toEqual({ brief: false, material: true });
    expect(foldsFor("done", null)).toEqual({ brief: false, material: false });
    expect(foldsFor("done", "sent")).toEqual({ brief: false, material: false });
  });

  it("raport równy streszczeniu bloku zmian nie pokazuje się drugi raz; założenia wychodzą jako osobne linie", () => {
    const summary = (changes as { summary: string }).summary;
    expect(reportLines(summary, [summary])).toEqual([]);
    expect(reportLines(`${summary} Do potwierdzenia: numer kolejny zamiast numeru smaku.`, [summary])).toEqual([{ text: "Do potwierdzenia: numer kolejny zamiast numeru smaku.", confirm: true }]);
    expect(reportLines("Przeczytałem 12 maili.\nDo potwierdzenia: czy odpowiadać po angielsku.\nDo potwierdzenia: termin.", [])).toEqual([
      { text: "Przeczytałem 12 maili.", confirm: false }, { text: "Do potwierdzenia: czy odpowiadać po angielsku.", confirm: true }, { text: "Do potwierdzenia: termin.", confirm: true },
    ]);
    expect(reportLines(null, [summary])).toEqual([]);
  });

  it("linki do wyniku: podgląd http, potem link kroku; plik na Macu i ten sam adres nie dają przycisku", () => {
    expect(resultLinks({ tool: "code" }, { preview: "file:///Users/osobiste/x.html" }, "https://github.com/wlrx/custom-cookies")).toEqual([{ label: "Repozytorium", url: "https://github.com/wlrx/custom-cookies" }]);
    expect(resultLinks({ tool: "code" }, { preview: "https://custom-cookies.widelab.workers.dev/#catalog" }, "https://github.com/wlrx/custom-cookies")).toEqual([
      { label: "Otwórz podgląd", url: "https://custom-cookies.widelab.workers.dev/#catalog" }, { label: "Repozytorium", url: "https://github.com/wlrx/custom-cookies" },
    ]);
    expect(resultLinks({ tool: "code" }, { preview: "https://x.dev/" }, "https://x.dev/")).toEqual([{ label: "Otwórz podgląd", url: "https://x.dev/" }]);
    expect(resultLinks({ tool: "slack" }, null, "https://pirxey.slack.com/archives/C1")).toEqual([{ label: "Otwórz na Slacku", url: "https://pirxey.slack.com/archives/C1" }]);
    expect(resultLinks({ tool: "manual" }, null, null)).toEqual([]);
  });

  it("nagłówek „Teraz” mówi stan słowami", () => {
    expect(nowHeading("ready", null, 0, false)).toEqual({ title: "Do zrobienia", cls: "ready" });
    expect(nowHeading("blocked", null, 4, false).title).toBe("Czeka na 4 kroki");
    expect(nowHeading("blocked", null, 12, false).title).toBe("Czeka na 12 kroków");
    expect(nowHeading("blocked", null, 1, true).title).toBe("Czeka na inne zadanie");
    expect(nowHeading("handoff", null, 0, false)).toEqual({ title: "W pracy", cls: "handoff" });
    expect(nowHeading("draft", "proposed", 0, false)).toEqual({ title: "Do zatwierdzenia", cls: "draft" });
    expect(nowHeading("done", "sent", 0, false)).toEqual({ title: "Zrobione", cls: "done" });
  });
});

describe("dokąd idzie szkic (paczka 7, punkt 4)", () => {
  type D = Extract<Block, { type: "draft" }>;
  const d = (target: Partial<D["target"]> & { app: string }, extra: Partial<D> = {}): D => ({ type: "draft", target: { action: "send", ...target }, body: "x", status: "proposed", ...extra });
  const st = (tool: string, blocks: Block[] | null, extra: Record<string, unknown> = {}) => ({ tool, blocks, status: "draft", doneAt: null, link: null, title: "Krok", ...extra }) as never;
  const clickup = d({ app: "clickup", action: "create", where: "PirxeyOS / Full Backlog" }, { subject: "[US] Podgląd ról" });
  const changes: Block = { type: "changes", repo: "wlrx/app", branch: "feat", files: [{ path: "a.ts", diff: "+1" }] } as Block;
  it("destOf: rodzaj z pól szkicu; bez szkicu tylko plik na Macu", () => {
    expect(destOf(st("clickup", [clickup]))).toMatchObject({ kind: "send", app: "clickup", name: "ClickUp", in: "w ClickUpie", where: "PirxeyOS / Full Backlog", action: "create", subject: "[US] Podgląd ról" });
    expect(destOf(st("slack", [d({ app: "Slack", where: "#dev" })]))).toMatchObject({ kind: "send", app: "slack", in: "na Slacku" });
    expect(destOf(st("code", [changes, d({ app: "github", action: "commit", where: "wlrx/app, gałąź feat" })]))?.kind).toBe("commit");
    expect(destOf(st("code", [changes, d({ app: "github", action: "push", where: "wlrx/app" })]))?.kind).toBe("push");
    expect(destOf(st("code", [d({ app: "code", action: "other" })]))?.kind).toBe("prompt");
    expect(destOf(st("manual", [d({ app: "manual", action: "other" })]))?.kind).toBe("internal");
    expect(destOf(st("claude", [d({ app: "claude" })]))?.kind).toBe("internal");
    expect(destOf(st("claude", [d({ app: "plik", where: "robocze" })]))?.kind).toBe("file");
    expect(destOf(st("file", null))).toMatchObject({ kind: "file", name: "Plik na Macu", in: "na Macu" });
    expect(destOf(st("slack", null))).toBeNull();
    expect(destOf(st("notion", [d({ app: "notion" })]))).toMatchObject({ kind: "send", in: "· notion" });
  });
  it("przycisk: zawsze mówi, dokąd; szkic, który zostaje w zadaniu, to samo „Zatwierdź”", () => {
    const L = (x: Block[], tool = "clickup", rows = false) => approveLabel(destOf(st(tool, x)), { stays: false, rows });
    expect(L([clickup])).toBe("Zatwierdź i utwórz w ClickUpie");
    expect(L([d({ app: "clickup", action: "update" })])).toBe("Zatwierdź i zaktualizuj w ClickUpie");
    expect(L([d({ app: "slack", where: "#dev" })], "slack")).toBe("Zatwierdź i wyślij na Slacku");
    expect(L([d({ app: "gmail", action: "reply" })], "gmail")).toBe("Zatwierdź i wyślij mailem");
    expect(L([d({ app: "clickup", action: "comment" })])).toBe("Zatwierdź i dodaj komentarz w ClickUpie");
    expect(L([d({ app: "sheets", action: "update" }, { columns: ["A"], rows: [["1"]] })], "sheets", true)).toBe("Zatwierdź i dopisz w arkuszu Google");
    expect(L([d({ app: "Notion" })], "notion")).toBe("Zatwierdź i wyślij · Notion");
    expect(L([d({ app: "code", action: "other" })], "code")).toBe("Zatwierdź i uruchom");
    expect(L([changes, d({ app: "github", action: "commit" })], "code")).toBe("Zatwierdź i zapisz commit");
    expect(L([changes, d({ app: "github", action: "push" })], "code")).toBe("Zatwierdź i opublikuj na GitHubie");
    expect(L([d({ app: "claude" })], "claude")).toBe("Zatwierdź");
    expect(approveLabel(destOf(st("slack", [d({ app: "slack" })])), { stays: true, rows: false })).toBe("Zatwierdź");
  });
  it("linia pod przyciskiem, słowo po wysyłce, dolna linia kafelka i linia w rozmowie", () => {
    expect(destHint(destOf(st("clickup", [clickup])))).toBe("PirxeyOS / Full Backlog · utworzy nowy ticket");
    expect(destHint(destOf(st("slack", [d({ app: "slack", where: "#dev" })])))).toBe("#dev · wyśle wiadomość");
    expect(destHint(destOf(st("code", [changes, d({ app: "github", action: "commit", where: "wlrx/app" })])))).toBe("wlrx/app · commit na Macu, bez pusha");
    expect(destHint(destOf(st("claude", [d({ app: "claude" })])))).toBeNull();
    expect(sentWord(destOf(st("clickup", [clickup]))!)).toBe("Utworzono");
    expect(sentWord(destOf(st("slack", [d({ app: "slack" })]))!)).toBe("Wysłano");
    expect(sentWord(destOf(st("file", null))!)).toBe("Zapisano na Macu");
    expect(nowHeading("done", "sent", 0, false, destOf(st("clickup", [clickup])))).toEqual({ title: "Utworzono", cls: "done" });
    const sent = { ...clickup, status: "sent" as const };
    expect(tileDest(destOf(st("clickup", [clickup])), st("clickup", [clickup]))).toBe("ClickUp · PirxeyOS / Full Backlog");
    expect(tileDest(destOf(st("clickup", [sent])), st("clickup", [sent], { status: "done", doneAt: "2026-10-20T16:52:00Z" }))).toBe("W ClickUpie · Full Backlog · 18:52");
    expect(tileDest(destOf(st("file", null, { filePath: "~/x/us-access-roles-podglad.md" })), st("file", null, { status: "done", filePath: "~/x/us-access-roles-podglad.md" }))).toBe("Plik na Macu · us-access-roles-podglad.md");
    expect(tileDest(destOf(st("code", [changes, d({ app: "github", action: "commit" })])), st("code", [changes, d({ app: "github", action: "commit" })]))).toBe("Commit");
    expect(doneChat({ title: "Utwórz story", tool: "clickup", blocks: [sent] }, false)).toBe("Utworzyłem w ClickUpie: „[US] Podgląd ról” · PirxeyOS / Full Backlog.");
    expect(doneChat({ title: "Napisz na #dev", tool: "slack", blocks: [{ ...d({ app: "slack", where: "#dev" }), status: "sent" }] }, true)).toBe("Wysłałem na Slacku: „Napisz na #dev” · #dev. Zadanie ukończone.");
    expect(doneChat({ title: "Zapisz story", tool: "file", blocks: null, filePath: "~/r/2026-10-20-us.md" }, false)).toBe("Zapisałem plik na Macu: 2026-10-20-us.md.");
    expect(doneChat({ title: "Commit poprawki", tool: "code", blocks: [changes, { ...d({ app: "github", action: "commit" }), status: "sent" }] }, false)).toBe("Zapisałem commit na Macu: „Commit poprawki”.");
    expect(doneChat({ title: "Wypchnij", tool: "code", blocks: [changes, { ...d({ app: "github", action: "push" }), status: "sent" }] }, false)).toBe("Wypchnąłem na GitHub: „Wypchnij”.");
    expect(doneChat({ title: "Przeczytaj maile", tool: "gmail", blocks: null }, false)).toBe("Zrobione: „Przeczytaj maile”.");
  });
  it("draftPlace: kilka nowych ticketów na jednej liście to różne miejsca; ten sam tytuł dwa razy to dubel", () => {
    const list = "https://app.clickup.com/9005151854/v/l/li/901217157759";
    const mk = (id: string, subject: string) => ({ id, title: "Utwórz " + subject, tool: "clickup", status: "draft", blocks: [d({ app: "clickup", action: "create", where: "Full Backlog", url: list }, { subject })] }) as never;
    const steps = [mk("a", "[US] Podgląd ról"), mk("b", "[US] Edycja roli"), mk("c", "[US] Usuwanie roli")];
    expect(sameTarget(steps, "a", (steps[0] as { blocks: never }).blocks)).toEqual({ open: [], sent: [] });
    const dup = [mk("a", "[US] Podgląd ról"), mk("b", "[US] Podgląd ról")];
    expect(sameTarget(dup, "a", (dup[0] as { blocks: never }).blocks).open.map((x: { id: string }) => x.id)).toEqual(["b"]);
    expect(draftPlace(steps[0], (steps[0] as { blocks: never }).blocks)).toBe(list.toLowerCase() + " create [us] podgląd ról");
  });
});

describe("targetLink: dokąd prowadzi krok przed wysyłką", () => {
  const draft = (target: Record<string, unknown>) => [{ type: "draft", target: { action: "update", ...target }, body: "x", status: "proposed" }] as never;
  it("adres podany przez agenta wygrywa", () => {
    expect(targetLink({ tool: "slack", title: "Odpisz" }, draft({ app: "slack", where: "#dev", url: "https://x.slack.com/archives/C1/p2" }))).toEqual({ label: "Otwórz na Slacku", url: "https://x.slack.com/archives/C1/p2" });
  });
  it("id ClickUp z pola dokąd albo z tytułu kroku", () => {
    expect(targetLink({ tool: "clickup", title: "Zaktualizuj story" }, draft({ app: "clickup", where: "869f2j817 Employees step - Add Employee flow (opis)" }))?.url).toBe("https://app.clickup.com/t/869f2j817");
    expect(targetLink({ tool: "clickup", title: "Dodaj komentarz w 869ewyvbg" }, null)?.url).toBe("https://app.clickup.com/t/869ewyvbg");
    expect(targetLink({ tool: "clickup", title: "Zaktualizuj story Employees step" }, draft({ app: "clickup", where: "lista Backlog" }))).toBeNull();
  });
  it("źródło z kartki z tej samej aplikacji", () => {
    const blocks = [{ type: "thread", source: { app: "slack", url: "https://x.slack.com/archives/C1/p9" }, messages: [] }] as never;
    expect(targetLink({ tool: "slack", title: "Odpisz Annie" }, blocks)?.url).toBe("https://x.slack.com/archives/C1/p9");
  });
  it("prompt i kod nie dostają przycisku", () => {
    expect(targetLink({ tool: "code", title: "Popraw 869abcdef" }, null)).toBeNull();
  });
});

describe("szkic zamknięty bez zatwierdzenia", () => {
  it("nagłówek nie mówi „Zrobione”, tylko że nic nie poleciało", () => {
    expect(nowHeading("done", "unsent", 0, false).title).toBe("Zamknięty bez wysyłki");
  });
});

describe("sameTarget: dwa kroki, które wysłałyby to samo", () => {
  const step = (id: string, status: string, where: string, action: string, draft = "proposed") => ({ id, title: "Krok " + id, tool: "clickup", status, blocks: [{ type: "draft", target: { app: "clickup", where, action }, body: "x", status: draft }] }) as never;
  it("ten sam ticket i komentarz: drugi otwarty i już wysłany", () => {
    const steps = [step("a", "draft", "869dxk3h9 AI data analysis (komentarz)", "comment"), step("b", "todo", "869dxk3h9 AI data analysis: Employees", "reply"), step("c", "done", "869dxk3h9", "comment", "sent")];
    const r = sameTarget(steps, "a", (steps[0] as { blocks: never }).blocks);
    expect(r.open.map((x) => x.id)).toEqual(["b"]);
    expect(r.sent.map((x) => x.id)).toEqual(["c"]);
  });
  it("opis i komentarz w tym samym tickecie to różne czynności", () => {
    const steps = [step("a", "draft", "869dxk3h9", "update"), step("b", "draft", "869dxk3h9", "comment")];
    expect(sameTarget(steps, "a", (steps[0] as { blocks: never }).blocks).open).toEqual([]);
  });
});

// paczka 7, punkt 1: rodzaj kroku decyduje o przyciskach; odpowiedź Piotra na kartce zamyka jego krok-decyzję, a agent nie może jej podrobić
describe("rodzaj kroku", () => {
  const q: Block = { type: "question", text: "Co scalić?", options: [{ label: "A" }, { label: "B" }] };
  const draft = { type: "draft", target: { app: "slack", action: "send" }, body: "x", status: "proposed" } as Block;
  it("szkic → zgoda (także na kroku Piotra); krok Claude'a → agent; krok Piotra z pytaniem → decyzja; „Przeczytaj / Przejrzyj / Zapoznaj się” → czytanie; inny → poza aplikacją", () => {
    expect(stepKind(step({ tool: "manual", blocks: [draft] }))).toBe("approval");
    expect(stepKind(step({ tool: "code", title: "Napraw test" }))).toBe("agent");
    expect(stepKind(step({ tool: "manual", title: "Zdecyduj o wersji", blocks: [q] }))).toBe("decision");
    expect(stepKind(step({ tool: "manual", title: "Przeczytaj raport duplikatów" }))).toBe("reading");
    expect(stepKind(step({ tool: "manual", title: "Zapoznaj się z raportem" }))).toBe("reading");
    expect(stepKind(step({ tool: "manual", title: "Przejrzyj wątek" }))).toBe("reading");
    expect(stepKind(step({ tool: "manual", title: "Przeczytajcie to" }))).toBe("offline");   // całe słowo, nie przedrostek
    expect(stepKind(step({ tool: "manual", title: "Zadzwoń do Kingi" }))).toBe("offline");
    expect(stepKind(step({ tool: "claude", title: "Przeczytaj wątek #dev" }))).toBe("agent");
  });
  it("otwarte pytania, tekst decyzji w wyniku kroku, kto zrobił", () => {
    const a = { ...q, answer: "A" } as Block, b = { type: "question", text: "Którą wersję?", options: [{ label: "v1" }, { label: "v2" }], answer: "v2" } as Block;
    expect(openQuestions({ blocks: [q, a] })).toEqual([q]);
    expect(openQuestions({ blocks: null })).toEqual([]);
    expect(decisionText({ blocks: [a] })).toBe("Decyzja: A");
    expect(decisionText({ blocks: [{ type: "text", body: "x" }, a, b] })).toBe("Decyzje: „Co scalić?”: A; „Którą wersję?”: v2");
    expect(decisionText({ blocks: [q] })).toBe("");
    expect(whoDid(step({ tool: "manual" }))).toBe("Ty"); expect(whoDid(step({ tool: "code" }))).toBe("Claude"); expect(whoDid(step({ tool: "code", doneBy: "owner" }))).toBe("Ty");
  });
  it("odpowiedzi na kartce tylko od Piotra: agent nie dopisze ani nie zdejmie odpowiedzi, inne pytanie wchodzi bez odpowiedzi", () => {
    const stored: Block[] = [{ ...q, answer: "A", prev: "B" } as Block];
    expect(keepOwnerAnswers(stored, [{ ...q, answer: "B" } as Block])).toEqual([{ ...q, answer: "A", prev: "B" }]);
    expect(keepOwnerAnswers(stored, [q])).toEqual([{ ...q, answer: "A", prev: "B" }]);
    expect(keepOwnerAnswers(null, [{ ...q, answer: "A" } as Block])).toEqual([q]);
    expect(keepOwnerAnswers(stored, [{ ...q, text: "Inne?", answer: "A" } as Block])).toEqual([{ ...q, text: "Inne?" }]);
    expect(keepOwnerAnswers(stored, [{ type: "text", body: "x" }])).toEqual([{ type: "text", body: "x" }]);
  });
});

describe("krok „Zleć w projekcie” (paczka 12, punkt 3)", async () => {
  const { isProjectStep, projectPrompt } = await import("@/lib/stepcard");
  it("krok Piotra z tytułem „Zleć w projekcie” robi projekt w chmurze; inne kroki nie", () => {
    expect(isProjectStep({ tool: "manual", title: "Zleć w projekcie: dobór modelu w biegu" })).toBe(true);
    expect(isProjectStep({ tool: "manual", title: "zleć w projekcie dobór modelu" })).toBe(true);
    expect(isProjectStep({ tool: "code", title: "Zleć w projekcie: dobór modelu" })).toBe(false);   // krok agenta: nie
    expect(isProjectStep({ tool: "manual", title: "Zleć w projekcie" })).toBe(true);
    expect(isProjectStep({ tool: "manual", title: "Zleć w projektach: x" })).toBe(false);
    expect(stepKind(step({ tool: "manual", title: "Zleć w projekcie: dobór modelu" }))).toBe("offline");   // „Zrobione” jak przy kroku poza aplikacją
  });
  it("polecenie: czynność bez przedrostka, brief, adres zadania, numer kroku i co zrobić na końcu", () => {
    const a = step({ id: "a", title: "Przeczytaj notatkę" }), b = step({ id: "b", tool: "manual", title: "Zleć w projekcie: dobór modelu w biegu", detail: "Poziom kroku w bazie i --model w mostku." });
    const p = projectPrompt({ id: "t1", title: "Dobór modelu", steps: [a, b] }, b, "https://th.example");
    expect(p.split("\n\n")).toEqual([
      "Zrób krok z Task Hub: dobór modelu w biegu.",
      "Poziom kroku w bazie i --model w mostku.",
      "Zadanie „Dobór modelu” (https://th.example/tasks/t1), krok 02. Pełną treść, wcześniejsze kroki i decyzje przeczytaj przez get_task. Po skończeniu zamknij ten krok (complete_step) z wynikiem: co zmieniłeś i gdzie to jest.",
    ]);
  });
});
