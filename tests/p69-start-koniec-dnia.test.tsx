// Paczka 69 (zadanie „Start i koniec pracy”, krok 02): start i koniec dnia przy arkuszu wpisów czasu (span szkicu). Wariant C z kroku 01:
// wpisy mają od-do dowolnie i mogą na siebie zachodzić, suma czasów równa się czasowi od startu do końca, godziny wpisów mieszczą się w ramach.
import { describe, it, expect } from "vitest";
import { Block as BlockSchema, type Block } from "@/lib/schema";
import { spanCheck, parseClock } from "@/lib/sheet-month";
import { approvalSig, coerceAgentDrafts } from "@/lib/agent/approval";
import { draftsText } from "@/lib/agent/context";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetDraft } from "@/components/SheetDraft";

const sheet = [{ kind: "date" }, { kind: "text" }, { kind: "time" }, { kind: "time" }, { kind: "duration" }] as const;
const rows = [
  ["2026-11-02", "Analiza", "09:00", "09:30", "0:30"],
  ["2026-11-02", "Prototyp", "11:00", "13:30", "2:30"],
  ["2026-11-02", "Review", "11:00", "16:30", "5:30"],
];
const draft = (extra: Record<string, unknown> = {}): Block => BlockSchema.parse({
  type: "draft", target: { app: "pirxey-time", action: "create" }, body: "", columns: ["Data", "Opis", "Od", "Do", "Czas"],
  sheet: sheet.map((s) => ({ ...s })), rows, ...extra,
});

describe("start i koniec dnia przy arkuszu", () => {
  it("suma równa dniu i godziny w ramach: bez ostrzeżeń, nakładanie wpisów jest OK", () => {
    const c = spanCheck([...sheet], rows, { from: "9:00", to: "17:30" })!;
    expect(c).toMatchObject({ from: "09:00", to: "17:30", len: 510, total: 510, diff: 0, outside: [], reversed: false });
  });
  it("suma inna niż dzień i wpis poza ramami: różnica i numer wiersza", () => {
    const c = spanCheck([...sheet], rows, { from: "09:15", to: "16:00" })!;
    expect(c.len).toBe(405);
    expect(c.diff).toBe(105);
    expect(c.outside).toEqual([0, 2]);
  });
  it("koniec przed startem, brak godziny, brak ram", () => {
    expect(spanCheck([...sheet], rows, { from: "18:00", to: "9:00" })).toMatchObject({ reversed: true, len: null, diff: null, outside: [] });
    expect(spanCheck([...sheet], rows, { from: "09:00" })).toMatchObject({ len: null, total: 510, diff: null });
    expect(spanCheck([...sheet], rows, null)).toBeNull();
    expect(parseClock("1730")).toBe("17:30");
    expect(parseClock("24:00")).toBeNull();
  });
  it("szkic przyjmuje span HH:MM, odrzuca inną godzinę; span nie zmienia podpisu zgody", () => {
    const d = draft({ span: { from: "09:00", to: "17:30" } });
    expect(() => draft({ span: { from: "25:00" } })).toThrow();
    const step = { id: "s1", blocks: [d] };
    expect(approvalSig(step, d as never)).toBe(approvalSig({ id: "s1", blocks: [draft()] }, draft() as never));
  });
  it("agent przepisuje kartkę bez span: start i koniec od Piotra zostają", () => {
    const step = { id: "s1", blocks: [draft({ span: { from: "08:40", to: "17:10" } })] };
    const out = coerceAgentDrafts(step, [draft()]);
    expect((out[0] as { span?: unknown }).span).toEqual({ from: "08:40", to: "17:10" });
    const own = coerceAgentDrafts(step, [draft({ span: { from: "09:00", to: "17:00" } })]);
    expect((own[0] as { span?: unknown }).span).toEqual({ from: "09:00", to: "17:00" });
  });
  it("get_task pokazuje agentowi start, koniec i ostrzeżenie", () => {
    const ok = draftsText([{ id: "s1", title: "Zatwierdź wpisy czasu z 02.11", status: "draft", blocks: [draft({ span: { from: "09:00", to: "17:30" } })] }]);
    expect(ok).toContain("start i koniec pracy (tylko w Task Hub, nie wysyłaj): 09:00-17:30 (8:30); suma wierszy zgadza się");
    const bad = draftsText([{ id: "s1", title: "Zatwierdź wpisy czasu z 02.11", status: "draft", blocks: [draft({ span: { from: "09:15", to: "16:00" } })] }]);
    expect(bad).toContain("UWAGA: suma wierszy 8:30 różni się od długości dnia 6:45; wiersze z godziną poza ramami: 1, 3");
  });
  it("kartka: pola startu i końca nad tabelą, ostrzeżenie i zaznaczony wiersz", () => {
    const cols = ["Data", "Opis", "Od", "Do", "Czas"], sh = sheet.map((s) => ({ ...s }));
    const save = async () => true;
    const ok = renderToStaticMarkup(<SheetDraft columns={cols} sheet={sh} rows={rows} editable span={{ from: "09:00", to: "17:30" }} onSaveSpan={save} />);
    expect(ok).toContain("Start pracy");
    expect(ok).toContain("Wpisy zgadzają się z dniem");
    const bad = renderToStaticMarkup(<SheetDraft columns={cols} sheet={sh} rows={rows} editable span={{ from: "09:15", to: "16:00" }} onSaveSpan={save} />);
    expect(bad).toContain("o 1 h 45 min za dużo");
    expect(bad).toContain("2 wpisy mają godziny poza startem i końcem pracy");
    expect(bad.match(/sh-out/g)?.length).toBe(2);
    // arkusz bez czasu trwania i bez ram: nic nie dochodzi
    expect(renderToStaticMarkup(<SheetDraft columns={["Opis"]} sheet={[{ kind: "text" }]} rows={[["x"]]} editable onSaveSpan={save} />)).not.toContain("Start pracy");
  });
});
