// Karta kroku „Teraz · Co · Skąd”: podział klocków, zwijanie według stanu, raport bez powtórek, linki bez dubli. Czysta logika, bez bazy.
import { describe, it, expect } from "vitest";
import { foldsFor, kindsOf, nowHeading, reportLines, resultLinks, splitBlocks, targetLink, sameTarget } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";

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
    expect(resultLinks({ tool: "slack" }, null, "https://pirxey.slack.com/archives/C1")).toEqual([{ label: "Otwórz w Slack", url: "https://pirxey.slack.com/archives/C1" }]);
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

describe("targetLink: dokąd prowadzi krok przed wysyłką", () => {
  const draft = (target: Record<string, unknown>) => [{ type: "draft", target: { action: "update", ...target }, body: "x", status: "proposed" }] as never;
  it("adres podany przez agenta wygrywa", () => {
    expect(targetLink({ tool: "slack", title: "Odpisz" }, draft({ app: "slack", where: "#dev", url: "https://x.slack.com/archives/C1/p2" }))).toEqual({ label: "Otwórz w Slack", url: "https://x.slack.com/archives/C1/p2" });
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
