// Paczka 69 (zadanie „Czytelna kartka kroku decyzji”, wersja B „Wybór na liście”): kontekst nad pytaniem, lista do zaznaczenia z propozycją
// agenta i przyciskiem z liczbą, zapis zaznaczonych pozycji tylko od Piotra, „Plik na Macu” tylko przy prawdziwym pliku, uproszczone szczegóły.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockView, SrcHead } from "@/components/BlockRenderer";
import { PickList } from "@/components/PickList";
import { QuestionBlock, type Block } from "@/lib/schema";
import { keepOwnerAnswers, pickedAnswer } from "@/lib/stepcard";

const DB = !!process.env.TEST_DATABASE_URL;
const list = {
  type: "question" as const, pick: "many" as const,
  context: "Klient odrzucił na warsztatach 5 karteczek (kart funkcji z roadmapy). Pasuje do nich 7 otwartych ticketów w ClickUpie.",
  text: "Które tickety zamknąć w ClickUpie?",
  options: [
    { label: "Duplicate Schedule Bug", note: "Story, zgłosiła Crystal Arnold.", on: true },
    { label: "Manager - Schedule", note: "Pusty epik z 2024.", flag: "niepewne" },
  ],
  submit: "Zamknij zaznaczone", none: "Nie zamykaj nic", why: "Polecam bez pustego epiku.",
};

describe("lista do zaznaczenia", () => {
  it("schemat przyjmuje kontekst, listę do 30 pozycji, propozycję i znacznik", () => {
    const q = QuestionBlock.parse({ ...list, options: Array.from({ length: 30 }, (_, i) => ({ label: "T" + i, on: i < 3 })) });
    expect(q.options).toHaveLength(30);
    expect(QuestionBlock.safeParse({ ...list, options: Array.from({ length: 31 }, (_, i) => ({ label: "T" + i })) }).success).toBe(false);
    expect(QuestionBlock.parse(list).context).toContain("karteczek");
  });
  it("formularz: kontekst nad pytaniem, propozycja zaznaczona, przycisk mówi czynność i liczbę, drugi to odpowiedź „nic”", () => {
    const html = renderToStaticMarkup(<BlockView b={list} form={{ taskId: "t", stepId: "s" }} index={0} />);
    expect(html.indexOf("q-ctx")).toBeLessThan(html.indexOf("<p>Które tickety"));
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("Zamknij zaznaczone (1)");
    expect(html).toMatch(/<button[^>]*name="go"[^>]*value="pick"|<button[^>]*value="pick"[^>]*name="go"/);
    expect(html).toMatch(/<button[^>]*value="Nie zamykaj nic"[^>]*name="option"/);
    expect(html).toContain("niepewne");
    expect(html).not.toContain("Albo odpowiedz własnymi słowami");
  });
  it("po „Zmień odpowiedź” zaznaczone są pozycje wybrane przez Piotra, nie propozycja", () => {
    const html = renderToStaticMarkup(<PickList options={list.options} initial={["Manager - Schedule"]} submit="Zamknij zaznaczone" />);
    expect(html).toContain("Zamknij zaznaczone (1)");
    expect(html.slice(html.indexOf("Manager - Schedule") - 200, html.indexOf("Manager - Schedule"))).toContain('checked=""');
  });
  it("po odpowiedzi: lista z ptaszkami przy zaznaczonych i krótka odpowiedź", () => {
    const html = renderToStaticMarkup(<BlockView b={{ ...list, answer: pickedAnswer(list, ["Manager - Schedule"]), picked: ["Manager - Schedule"] }} form={{ taskId: "t", stepId: "s" }} index={0} />);
    expect(html).not.toContain("<form");
    expect(html).toContain("Odpowiedź: Zamknij zaznaczone (1)");
    expect(html.match(/class="on"/g)).toHaveLength(1);
  });
  it("odpowiedź dla agenta: czynność, liczba i pozycje; bez zaznaczenia odpowiedź „nic”", () => {
    expect(pickedAnswer(list, ["A", "B"])).toBe("Zamknij zaznaczone (2): A; B");
    expect(pickedAnswer(list, [])).toBe("Nie zamykaj nic");
    expect(pickedAnswer({}, [])).toBe("Nic z listy");
  });
  it("zaznaczenia są tylko Piotra: agent ich nie dopisze, a nowa wersja kartki ich nie zgubi", () => {
    const was: Block[] = [{ ...list, answer: "Nie zamykaj nic", picked: [] }];
    const [a] = keepOwnerAnswers(null, [{ ...list, picked: ["Duplicate Schedule Bug"] }]);
    expect(a).not.toHaveProperty("picked");
    const [b] = keepOwnerAnswers(was, [{ ...list }]);
    expect(b).toMatchObject({ answer: "Nie zamykaj nic", picked: [] });
  });
  it("zwykłe pytanie też pokazuje kontekst nad treścią", () => {
    const html = renderToStaticMarkup(<BlockView b={{ type: "question", context: "Skąd sprawa.", text: "Który?", options: [{ label: "A" }, { label: "B" }] }} form={{ taskId: "t", stepId: "s" }} index={0} />);
    expect(html.indexOf("Skąd sprawa.")).toBeLessThan(html.indexOf("<p>Który?"));
  });
});

describe("„Plik na Macu” tylko przy prawdziwym pliku", () => {
  it("tabela Claude'a z app file bez ścieżki: bez etykiety aplikacji; z plikiem: z etykietą", () => {
    expect(renderToStaticMarkup(<SrcHead s={{ app: "file" }} title="Tickety" />)).not.toContain("Plik na Macu");
    expect(renderToStaticMarkup(<SrcHead s={{ app: "file", ref: "~/Documents/mapa.csv" }} title="Tickety" />)).toContain("Plik na Macu");
    expect(renderToStaticMarkup(<SrcHead s={{ app: "file" }} />)).toBe("");
  });
});

describe.skipIf(!DB)("lista do zaznaczenia w bazie", async () => {
  const repo = await import("@/lib/repo");
  it("zapis odpowiedzi trzyma tylko pozycje z listy; zwykła odpowiedź zdejmuje zaznaczenia", async () => {
    const owner = (await repo.ensureOwner()).id;
    const t = await repo.createTask(owner, { title: "Lista p69", steps: [{ title: "Wybierz tickety", tool: "manual" }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { blocks: [list] });
    expect(await repo.answerBlockQuestion(sid, 0, "Zamknij zaznaczone (1): Duplicate Schedule Bug", list.text, ["Duplicate Schedule Bug", "Obcy"])).toBe(list.text);
    let b = (await repo.getTask(owner, t.id))!.steps[0].blocks?.[0];
    expect(b).toMatchObject({ answer: "Zamknij zaznaczone (1): Duplicate Schedule Bug", picked: ["Duplicate Schedule Bug"] });
    await repo.answerBlockQuestion(sid, 0, "inaczej", list.text);
    b = (await repo.getTask(owner, t.id))!.steps[0].blocks?.[0];
    expect(b).not.toHaveProperty("picked");
  });
});
